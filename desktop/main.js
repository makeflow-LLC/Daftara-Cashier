// دفترة كاشير للحاسوب (ويندوز): نفس ملفات التطبيق داخل نافذة Electron، تعمل بلا إنترنت.
// القارئ (USB) يكتب الباركود كلوحة مفاتيح، فلا حاجة لكاميرا.
//
// الحماية (مع أكواد الاشتراك الموقّعة وتحقق الخادم):
//  - الملفات تُحمَّل من app.asar فقط، وويندوز يتحقق من بصمته المحفوظة داخل البرنامج نفسه
//    (Electron fuses: EnableEmbeddedAsarIntegrityValidation + OnlyLoadAppFromAsar): تعديل الكود يوقف التشغيل.
//  - لا أدوات مطوّر في النسخة المثبّتة، ولا تشغيل كـ Node، ولا تمرير خيارات تصحيح.
'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const WWW = path.join(__dirname, 'www');
const ORIGIN = 'app://cashier';

// أصل ثابت (app://cashier) بدل file://: وحدات ES تعمل، وقاعدة البيانات (IndexedDB) ثابتة بين التحديثات
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// النسخة المثبّتة لا تقبل أدوات التصحيح عن بُعد (منها يُعبث بالصفحة وبالتفعيل)
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'js-flags'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

/* ---------- رقم الجهاز: بصمة MachineGuid في ويندوز (تبقى بعد إعادة التثبيت) ---------- */
function deviceKey() {
  let id = null;
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(out);
      if (m) id = 'win-' + m[1].toLowerCase();
    } catch (e) { /* ننزل إلى الرقم المحفوظ */ }
  }
  if (!id) {
    const file = path.join(app.getPath('userData'), 'device-id');
    try { id = fs.readFileSync(file, 'utf8').trim(); } catch (e) { /* أول تشغيل */ }
    if (!id) {
      id = 'pc-' + crypto.randomUUID();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, id);
    }
  }
  return crypto.createHash('sha256').update('cashier|' + id).digest('hex').slice(0, 32);
}

/* ---------- تاريخ أول تشغيل (بداية التجربة) ---------- */
function installedAt() {
  const file = path.join(app.getPath('userData'), 'installed-at');
  try { const t = Number(fs.readFileSync(file, 'utf8')); if (t > 0) return t; } catch (e) { /* أول تشغيل */ }
  const t = Date.now();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(t));
  return t;
}

ipcMain.handle('info', () => ({
  deviceKey: deviceKey(),
  installedAt: installedAt(),
  version: app.getVersion(),
  os: process.platform,
}));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 420,
    minHeight: 600,
    title: 'دفترة كاشير',
    backgroundColor: '#f3f2f2',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  win.maximize();

  // الروابط الخارجية (واتساب) تُفتح في المتصفح أو تطبيق واتساب، والنافذة لا تغادر التطبيق
  const external = (url) => /^(https?|mailto|tel|whatsapp):/i.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith(ORIGIN)) return;
    ev.preventDefault();
    if (external(url)) shell.openExternal(url);
  });
  // لا كاميرا ولا ميكروفون ولا إشعارات: لا نحتاج أي إذن
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));

  win.loadURL(ORIGIN + '/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // يقدّم ملفات www فقط، ولا يخرج منها أبدًا
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW + path.sep)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
