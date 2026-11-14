// اختبار دخان لنسخة الحاسوب، على جزأين:
//  1) البرنامج نفسه (electron . بنفس ملفات www): الإعداد الأول، رقم الجهاز من ويندوز، قارئ باركود USB، تجربة 30 يومًا.
//  2) المثبَّت المحصَّن (exe): يبدأ ويفتح قاعدة بياناته (فحص سلامة app.asar نجح)، ويرفض أدوات التصحيح عن بُعد.
//     أداة الاختبار نفسها لا تستطيع التحكم بالنسخة المحصَّنة — وهذا المقصود.
//   node test/smoke.mjs [مسار "Daftara Cashier.exe"]
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const exe = process.argv[2];
const opts = { args: ['.'] };

let app = await electron.launch(opts);
const userData = await app.evaluate(({ app }) => app.getPath('userData'));
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
app = await electron.launch(opts);
const fail = (msg) => { console.error('::error::' + msg); process.exitCode = 1; };
try {
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1280, height: 760 }).catch(() => {});
  await win.waitForSelector('#shop-name', { state: 'visible', timeout: 30000 });
  console.log('setup screen shown');

  const info = await win.evaluate(async () => {
    const { app } = await import('/src/core/app.js');
    await app.createShop({ name: 'Shop PC', phone: '', shopType: 'grocery' });
    await app.products.save({ name: 'Sugar', barcode: '6291003000017', sell_price: 500, cost_price: 400 }, { qty: 10000 });
    return { flavor: app.info.flavor, device: app.license.device, status: app.license.state.status, days: app.license.state.daysLeft, deviceKey: app.info.deviceKey };
  });
  console.log('info:', JSON.stringify({ ...info, deviceKey: info.deviceKey ? 'set' : null }));
  if (info.flavor !== 'desktop') fail('not running as desktop');
  if (!info.deviceKey) fail('no device key from Windows');
  if (!/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/.test(info.device)) fail('device code missing');
  if (info.status !== 'trial' || info.days !== 30) fail('trial is not 30 days');

  await win.evaluate(() => { location.hash = '#/sale'; location.reload(); });
  await win.waitForSelector('input[type=search]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(800);
  // قارئ USB: أرقام سريعة ثم Enter، والمؤشر خارج خانة البحث
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.type('6291003000017', { delay: 5 });
  await win.keyboard.press('Enter');
  await win.waitForTimeout(800);
  const cart = await win.textContent('body');
  if (!cart.includes('Sugar')) fail('USB barcode scan did not add the product');
  else console.log('USB scan added the product to the cart');

  await win.screenshot({ path: 'desktop-screenshot.png' });
  if (errors.length) fail('page errors: ' + errors.join(' | '));
} catch (e) {
  fail(String(e && e.stack || e));
} finally {
  await app.close();
}

async function packaged() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  const userData = path.join(appData, 'Daftara Cashier');
  fs.rmSync(userData, { recursive: true, force: true });
  const run = (args) => spawn(exe, args, { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // أدوات التصحيح: يجب أن يخرج فورًا
  const dbg = run(['--remote-debugging-port=9333']);
  const code = await new Promise((r) => { dbg.on('exit', (c) => r(c)); setTimeout(() => r('still running'), 15000); });
  if (code === 'still running') { dbg.kill(); fail('installed app accepted --remote-debugging-port'); } else console.log('debug switch refused, exit code', code);
  // تشغيل عادي: يفتح قاعدة بياناته خلال 40 ثانية ويبقى يعمل
  const p = run([]);
  let exited = null;
  p.on('exit', (c) => { exited = c; });
  let db = false;
  for (let i = 0; i < 40 && !db && exited === null; i++) {
    await sleep(1000);
    const dir = path.join(userData, 'IndexedDB');
    db = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith('app_cashier'));
  }
  if (exited !== null) fail('installed app exited with code ' + exited + ' (ASAR integrity?)');
  else if (!db) fail('installed app did not open its database');
  else console.log('installed app started and opened its database');
  p.kill();
}
if (exe) await packaged();
if (!process.exitCode) console.log('desktop smoke test passed');
