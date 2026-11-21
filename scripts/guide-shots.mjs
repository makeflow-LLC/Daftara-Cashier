// يلتقط صور الدليل المصوّر (guide/*.webp) من التطبيق نفسه ببيانات محل تجريبي.
//   npm run guide:shots            كل الصور
//   npm run guide:shots -- sale    صورة واحدة أو أكثر بالاسم
// يحتاج Playwright مع Chromium (غير مذكور في package.json حتى لا يثقل التثبيت): npm i --no-save playwright
// كل اسم هنا يقابل shots في مواضيع src/domain/guide.js — صورة جديدة = سطر في SHOTS ثم أعد تشغيل هذا الملف.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// name: اسم الملف. path: الشاشة ({customer} وغيره من البيانات التجريبية). before: يُنفَّذ داخل الصفحة قبل فتحها.
// steps: ضغطات بعد الفتح ({ text } نص الزر، { click } محدِّد CSS).
const cart = async () => {
  const { app } = await import('/src/core/app.js');
  const { makeLine } = await import('/src/domain/cart.js');
  const all = await app.products.list();
  const pick = (n, qty) => { const p = all.find((x) => x.name.startsWith(n)); return makeLine(p, { qty: qty * 1000, avgCost: p.cost_price }); };
  await app.sales.saveCurrent({ lines: [pick('حليب', 2), pick('تونة', 3), pick('خبز', 4), pick('سائل جلي', 1)], discount: null });
};
const SHOTS = [
  { name: 'home', path: '/' }, { name: 'more', path: '/more' },
  { name: 'sale', path: '/sale', before: cart },
  { name: 'sale-pay', path: '/sale', before: cart, steps: [{ click: '.paybar .btn-primary' }] },
  { name: 'sale-receipt', path: '/sale', before: cart, steps: [{ click: '.paybar .btn-primary' }, { click: '.sheet .pay-method' }] },
  { name: 'returns', path: '/sale/returns' }, { name: 'invoices', path: '/invoices' }, { name: 'wallets', path: '/settings/wallets' },
  { name: 'offers', path: '/offers' }, { name: 'products', path: '/products' }, { name: 'product-form', path: '/products/edit?id={product}' },
  { name: 'categories', path: '/settings/categories' }, { name: 'tools', path: '/tools' }, { name: 'import', path: '/tools/import' },
  { name: 'prices', path: '/tools/prices' }, { name: 'labels', path: '/tools/labels', steps: [{ text: 'كل الأصناف' }] },
  { name: 'customers', path: '/customers' }, { name: 'customer', path: '/customers/view?id={customer}' }, { name: 'remind', path: '/customers/remind' },
  { name: 'suppliers', path: '/suppliers' }, { name: 'supplier', path: '/suppliers/view?id={supplier}' },
  { name: 'inventory', path: '/inventory' }, { name: 'purchase', path: '/inventory/purchase' }, { name: 'count', path: '/inventory/count' },
  { name: 'warehouses', path: '/inventory/warehouses' }, { name: 'warehouse', path: '/inventory/warehouse?id={warehouse}' },
  { name: 'transfer', path: '/inventory/transfer?from={warehouse}' },
  { name: 'cash', path: '/cash' }, { name: 'expenses', path: '/expenses' }, { name: 'payroll', path: '/payroll' },
  { name: 'reports', path: '/reports' }, { name: 'daily', path: '/reports/daily', wait: 1500 },
  { name: 'staff', path: '/settings/staff' }, { name: 'chat', path: '/chat' }, { name: 'subscribe', path: '/subscribe' },
  { name: 'settings', path: '/settings' }, { name: 'shop', path: '/settings/shop' }, { name: 'features', path: '/settings/features' },
  { name: 'currencies', path: '/settings/currencies' }, { name: 'payments', path: '/settings/payments' }, { name: 'printer', path: '/settings/printer' },
  { name: 'scale', path: '/settings/scale' }, { name: 'appearance', path: '/settings/appearance' }, { name: 'about', path: '/settings/about' },
  { name: 'help-sheet', path: '/customers', steps: [{ click: '.topbar .help-btn' }] },
];
const only = process.argv.slice(2);
const PORT = 8097;
const OUT = resolve(root, process.env.SHOTS_DIR || 'guide');
const RAW = !!process.env.SHOTS_RAW; // PNG كامل الدقة للمراجعة بدل WebP

execFileSync(process.execPath, ['scripts/build-www.mjs', 'www'], { stdio: 'inherit', env: { ...process.env, SUPABASE_URL: '', VERSION_NAME: process.env.VERSION_NAME || 'v1.4.0' } });
const server = spawn(process.execPath, ['scripts/serve.mjs', 'www', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
// SHOTS_VIEW=1366x768 يصوّر بمقاس شاشة حاسوب (للمراجعة، مع SHOTS_RAW=1 و SHOTS_DIR)؛ الافتراضي جوال
const view = (process.env.SHOTS_VIEW || '').split('x').map(Number);
const desktop = view.length === 2 && view[0] > 0 && view[1] > 0;
const context = await browser.newContext(desktop
  ? { viewport: { width: view[0], height: view[1] }, deviceScaleFactor: 1, locale: 'ar', timezoneId: 'Asia/Gaza' }
  : { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, locale: 'ar', timezoneId: 'Asia/Gaza', hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
const base = `http://localhost:${PORT}/`;
const idle = (ms = 450) => page.waitForTimeout(ms);

try {
  // الإعداد الأول: نصوّره ثم ننشئ المحل
  await page.goto(base);
  await page.waitForSelector('#shop-name');
  await page.fill('#shop-name', 'سوبرماركت الأمل');
  await page.fill('#shop-phone', '0599123456');
  await idle();
  if (!only.length || only.includes('setup')) await shoot('setup');
  await page.click('button[type=submit]');
  await page.click('[data-type=grocery]');
  await page.waitForSelector('.tabbar', { state: 'attached' });
  ids = await page.evaluate(seed);
  await page.reload();
  await page.waitForSelector('.tabbar', { state: 'attached' });

  // SHOTS_HOOK=ملف.mjs: فحص آلي على نفس البيانات التجريبية بدل التصوير (export default async (page, ids) => …)
  if (process.env.SHOTS_HOOK) { await (await import(resolve(process.env.SHOTS_HOOK))).default(page, ids); SHOTS.length = 0; }
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue;
    if (s.before) await page.evaluate(s.before);
    await page.evaluate(() => { location.hash = '#/more'; }); // من صفحة أخرى دائمًا، فتُرسم الشاشة من جديد
    await idle(150);
    const path = s.path.replace(/\{(\w+)\}/g, (_, k) => ids[k] || '');
    await page.evaluate((p) => { location.hash = `#${p}`; }, path);
    await idle(s.wait || 650);
    for (const step of s.steps || []) {
      if (step.click) await page.locator(step.click).first().click();
      if (step.text) await page.getByText(step.text, { exact: !!step.exact }).first().click();
      await idle(step.wait || 450);
    }
    await page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.classList.remove('show'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    await idle(200);
    if (process.env.SHOTS_EVAL) console.log(s.name, JSON.stringify(await page.evaluate(process.env.SHOTS_EVAL)));
    await shoot(s.name);
    // نغلق أي ورقة أو سلة مفتوحة قبل الصورة التالية
    await page.evaluate(async () => { const { closeAllSheets } = await import('/src/ui/overlay.js'); closeAllSheets(); });
  }
} finally {
  await browser.close();
  server.kill();
}

var ids; // معرّفات من البيانات التجريبية (زبون، تاجر، مخزن) لمسارات مثل /customers/view?id={customer}

async function shoot(name) {
  mkdirSync(OUT, { recursive: true });
  if (RAW) { await page.screenshot({ path: `${OUT}/${name}.png`, scale: 'css' }); console.log('shot', name); return; }
  const png = await page.screenshot({ type: 'png' });
  // WebP بعرض 540 بكسل: واضحة على الجوال وخفيفة (نحو 20 ك.ب للصورة)
  const b64 = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 540; c.height = Math.round(img.height * 540 / img.width);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.7).split(',')[1];
  }, png.toString('base64'));
  writeFileSync(`${OUT}/${name}.webp`, Buffer.from(b64, 'base64'));
  console.log('shot', name);
}

// ---------- بيانات المحل التجريبي (تعمل داخل الصفحة، بنفس وحدات التطبيق) ----------
async function seed() {
  const { app } = await import('/src/core/app.js');
  const { makeLine } = await import('/src/domain/cart.js');
  const cats = {};
  for (const n of ['ألبان', 'مشروبات', 'معلبات', 'منظفات', 'خضار وفواكه']) cats[n] = (await app.products.addCategory(n)).id;
  const P = {};
  const add = async (name, sell, cost, qty, cat, extra = {}, packs = null) => {
    const { product } = await app.products.save({ name, sell_price: sell, cost_price: cost, category_id: cats[cat], ...extra }, { qty: qty * 1000, packs });
    P[name] = await app.products.get(product.id);
  };
  await add('حليب طازج 1 لتر', 600, 480, 24, 'ألبان', { barcode: '7290000066318' });
  await add('لبنة 500 غم', 900, 720, 12, 'ألبان', { barcode: '7290004131074' });
  await add('جبنة بيضاء', 1400, 1100, 3, 'ألبان', { barcode: '7290011017866', low_stock: 5000 });
  await add('عصير برتقال 1 لتر', 500, 380, 30, 'مشروبات', { barcode: '6253004800101' }, [{ name: 'كرتونة', factor: 12000, sell_price: 5500, barcode: '16253004800108' }]);
  await add('مياه معدنية 1.5 لتر', 200, 130, 60, 'مشروبات', { barcode: '6253004800217' });
  await add('كولا 330 مل', 300, 210, 48, 'مشروبات', { barcode: '5449000000996' });
  await add('شاي 100 كيس', 1200, 950, 9, 'مشروبات', { barcode: '8901030865278' });
  await add('تونة 160 غم', 700, 540, 40, 'معلبات', { barcode: '8850511321013' });
  await add('حمص حب 400 غم', 350, 250, 0, 'معلبات', { barcode: '6253001100212' });
  await add('فول مدمس', 300, 220, 18, 'معلبات', { barcode: '6253001100311' });
  await add('سائل جلي 750 مل', 800, 600, 14, 'منظفات', { barcode: '7290000288185' });
  await add('مسحوق غسيل 2 كغم', 2500, 2000, 7, 'منظفات', { barcode: '5413149891234' });
  await add('خبز', 300, 250, 40, 'خضار وفواكه', { is_quick: true });
  await add('بندورة', 400, 280, 25, 'خضار وفواكه', { is_quick: true, unit: 'kg' });
  await add('خيار', 350, 240, 18, 'خضار وفواكه', { is_quick: true, unit: 'kg' });
  await add('بيض (طبق)', 1600, 1350, 10, 'ألبان', { is_quick: true });

  const methods = await app.sales.paymentMethods();
  const cash = methods.find((m) => m.kind === 'cash');
  const bank = methods.find((m) => m.kind !== 'cash' && m.kind !== 'credit');
  await app.cash.open(30000);
  const c1 = await app.customers.create({ name: 'أبو أحمد', phone: '0599111222' });
  const c2 = await app.customers.create({ name: 'أم علي', phone: '0598333444' });
  const c3 = await app.customers.create({ name: 'محمود النجار', phone: '0597555666' });
  const sell = async (items, pay = null, customerId = null) => {
    const lines = items.map(([n, q]) => makeLine(P[n], { qty: q * 1000, avgCost: P[n].cost_price }));
    const total = lines.reduce((a, l) => a + Math.round(l.unit_price * l.qty / 1000), 0);
    return app.sales.checkout({ lines, customerId, payments: [pay || { kind: 'cash', method_id: cash.id, amount: total }] });
  };
  await sell([['حليب طازج 1 لتر', 2], ['خبز', 3], ['تونة 160 غم', 2]]);
  await sell([['عصير برتقال 1 لتر', 3], ['كولا 330 مل', 6]]);
  await sell([['مسحوق غسيل 2 كغم', 1], ['سائل جلي 750 مل', 1], ['شاي 100 كيس', 1]], { kind: 'credit', amount: 4500 }, c1.id);
  await sell([['بندورة', 2], ['خيار', 1], ['بيض (طبق)', 1]]);
  await sell([['لبنة 500 غم', 2], ['جبنة بيضاء', 1]], { kind: 'credit', amount: 3200 }, c2.id);
  await sell([['مياه معدنية 1.5 لتر', 6], ['فول مدمس', 2]]);
  await sell([['مسحوق غسيل 2 كغم', 2], ['شاي 100 كيس', 2], ['تونة 160 غم', 6], ['عصير برتقال 1 لتر', 6]]);
  await sell([['حليب طازج 1 لتر', 4], ['لبنة 500 غم', 3], ['بيض (طبق)', 2], ['خبز', 6], ['كولا 330 مل', 12]]);
  await sell([['سائل جلي 750 مل', 3], ['مياه معدنية 1.5 لتر', 12], ['بندورة', 3], ['خيار', 2]]);
  await app.customers.addDebt(c1.id, 12000, 'دين قديم من الدفتر');
  await app.customers.recordPayment(c1.id, 5000);
  await app.customers.addDebt(c3.id, 8500, 'بضاعة متفرقة');

  const s1 = await app.inventory.saveSupplier({ name: 'شركة الجنيدي للألبان', phone: '0599700800', opening: 185000 });
  const s2 = await app.inventory.saveSupplier({ name: 'مؤسسة النور للتوزيع', phone: '0598900100', opening: 64000 });
  await app.inventory.paySupplier(s1.id, 50000, { method: bank });
  await app.inventory.savePurchase({ supplierId: s2.id, paid: 'credit', lines: [
    { product_id: P['تونة 160 غم'].id, name: 'تونة 160 غم', qty: 24000, factor: 1000, unit_cost: 540 },
    { product_id: P['فول مدمس'].id, name: 'فول مدمس', qty: 12000, factor: 1000, unit_cost: 220 },
  ] });

  await app.expenses.save({ category: 'electricity', amount: 4500, method: cash, note: 'شحن عدّاد' });
  await app.expenses.save({ category: 'internet', amount: 3000, method: null });
  await app.expenses.save({ category: 'transport', amount: 1500, method: cash });

  const wh = await app.inventory.saveWarehouse({ name: 'مخزن البيت' });
  await app.inventory.setWarehouseQty(wh.id, P['مياه معدنية 1.5 لتر'].id, 120000);
  await app.inventory.setWarehouseQty(wh.id, P['كولا 330 مل'].id, 96000);
  await app.inventory.setWarehouseQty(wh.id, P['تونة 160 غم'].id, 48000);

  const today = new Date().toISOString().slice(0, 10);
  await app.updateShopSettings({
    offers: [
      { id: 'o1', type: 'bundle', target: { kind: 'product', id: P['كولا 330 مل'].id }, qty: 3, price: 800, from: null, to: null, active: true },
      { id: 'o2', type: 'percent', target: { kind: 'category', id: cats['منظفات'] }, percent: 1000, from: today, to: null, active: true },
    ],
    payroll: { employees: [
      { id: 'e1', name: 'خالد', salary: 180000, payDay: 31, staffId: null, since: `${today.slice(0, 7)}-01`, active: true },
      { id: 'e2', name: 'سامر', salary: 150000, payDay: 31, staffId: null, since: `${today.slice(0, 7)}-01`, active: true },
    ] },
  });
  await app.chat.send(app.chat.GROUP, 'صباح الخير، وصلت بضاعة الألبان — رتّبوها في الثلاجة.');
  return { customer: c1.id, supplier: s1.id, warehouse: wh.id, product: P['حليب طازج 1 لتر'].id };
}
