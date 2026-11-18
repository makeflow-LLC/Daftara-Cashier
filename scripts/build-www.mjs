// يجمع ملفات التطبيق في مجلد واحد نظيف (www) يغلّفه Capacitor في تطبيق أندرويد.
// ويكتب www/config.js من متغيرات البيئة — لا عنوان خادم ولا مفاتيح في الكود:
//   SUPABASE_URL, SUPABASE_ANON_KEY   (بدونهما: التطبيق كامل على الجهاز، والمزامنة متوقفة)
//   VERSION_CODE                      رقم البناء (GitHub Actions)
//   APP_FLAVOR                        direct | play | desktop | web (أو الوسيط الثاني)
//   VERSION_NAME                      رقم الإصدار للزبائن (من وسم الإصدار v1.0.0)
//   node scripts/build-www.mjs <المجلد> [flavor]
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRIES = ['index.html', 'styles', 'src', 'vendor', 'icons', 'fonts'];

if (!process.argv[2]) { console.error('usage: build-www.mjs <dir>'); process.exit(1); }
const out = resolve(process.argv[2]);
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const e of ENTRIES) cpSync(e, `${out}/${e}`, { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = parseInt(process.env.VERSION_CODE || '0', 10) || 0;
const cfg = {
  supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  flavor: process.argv[3] || process.env.APP_FLAVOR || 'direct',
  version: (process.env.VERSION_NAME || '').replace(/^v/, '') || `${pkg.version || '0.1.0'}${build ? `.${build}` : ''}`,
  release: !!process.env.VERSION_NAME,
  build,
};
writeFileSync(`${out}/config.js`, `window.CASHIER_CONFIG = ${JSON.stringify(cfg)};\n`);
if (cfg.flavor === 'web') buildWeb(out, cfg);
console.log(`www ready in ${out} — sync ${cfg.supabaseUrl ? 'ON' : 'OFF (no SUPABASE_URL)'}, version ${cfg.version}`);

// نسخة الويب (آيفون وأي متصفح): قارئ باركود ZXing للكاميرا، ملف التثبيت (manifest)، أيقونات آيفون،
// وعامل الخدمة sw.js الذي يخزّن كل الملفات فيعمل التطبيق بلا إنترنت بعد أول فتح.
function buildWeb(dir, c) {
  // كتالوج المحل للزبائن (رابط واتساب): نفس الإعداد config.js ونفس وحدات src/domain
  cpSync('shop.html', `${dir}/shop.html`);
  const z = 'node_modules/zxing-wasm/dist';
  mkdirSync(`${dir}/vendor/zxing`, { recursive: true });
  cpSync(`${z}/iife/reader/index.js`, `${dir}/vendor/zxing/zxing_reader.js`);
  cpSync(`${z}/reader/zxing_reader.wasm`, `${dir}/vendor/zxing/zxing_reader.wasm`);

  writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify({
    name: 'دفترة كاشير', short_name: 'دفترة كاشير', lang: 'ar', dir: 'rtl',
    description: 'نقطة بيع ومخزون وفواتير للمحلات الصغيرة — تعمل بلا إنترنت.',
    start_url: './', scope: './', display: 'standalone', orientation: 'any',
    background_color: '#0e7a51', theme_color: '#0e7a51',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }, null, 2));

  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icons/icon-180.png">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="apple-mobile-web-app-title" content="دفترة كاشير">',
  ].join('\n');
  const html = readFileSync(`${dir}/index.html`, 'utf8').replace('</head>', `${head}\n</head>`);
  writeFileSync(`${dir}/index.html`, html);

  // Apache (Hostinger): نوع ملف wasm، وعامل الخدمة لا يُخزَّن أبدًا (فتصل التحديثات)
  writeFileSync(`${dir}/.htaccess`, [
    '# دفترة كاشير — نسخة الويب (يبنيها scripts/build-www.mjs)',
    'DirectoryIndex index.html',
    'AddType application/wasm .wasm',
    'AddType application/manifest+json .webmanifest',
    '<IfModule mod_headers.c>',
    '  Header set Cache-Control "no-cache"',
    '  Header set X-Content-Type-Options "nosniff"',
    '  Header set Referrer-Policy "no-referrer"',
    '  Header set Permissions-Policy "camera=(self)"',
    '</IfModule>',
    '',
  ].join('\n'));

  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  const precache = ['./', ...files.filter((f) => f !== '.htaccess' && f !== 'sw.js').sort()];
  writeFileSync(`${dir}/sw.js`, `// يُبنى تلقائيًا (scripts/build-www.mjs) — لا تعدّله هنا.
// يخزّن ملفات التطبيق عند التثبيت فيفتح بلا إنترنت. النسخة الجديدة تستبدل القديمة وتمسح مخزنها.
const CACHE = 'cashier-${c.version}-${c.build}-${Date.now().toString(36)}';
const FILES = ${JSON.stringify(precache)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cashier-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // المزامنة (Supabase) والصور: من الشبكة مباشرة
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
`);
  console.log(`web: ${precache.length} files precached, ZXing camera reader included`);
}
