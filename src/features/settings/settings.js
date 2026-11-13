// الإعدادات: بيانات المحل، الميزات، العملات، طرق الدفع، المزامنة، المظهر.
import { h, num, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, section, row, switchRow, field, input, button, card } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback, configureFeedback } from '../../ui/feedback.js';
import { FEATURES, SHOP_TYPES } from '../../domain/features.js';
import { CURRENCIES, EXTRA_CURRENCIES, parseRate } from '../../domain/currency.js';
import { formatDecimal, normalizeDigits, parseDecimal } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { pickImage } from '../../core/media.js';

const go = (p) => () => navigate(p);

export function renderSettings(el) {
  const f = app.features;
  el.append(
    header('الإعدادات'),
    h('div', { class: 'page' },
      section(null, h('div', { class: 'list' },
        row({ icon: 'receipt', title: 'الفواتير', sub: 'كل فواتير البيع والشراء والمرتجع، وإرسالها واتساب', onclick: go('/invoices') }),
        row({ icon: 'box', title: 'المخزون', sub: 'شراء، جرد، تالف، تنبيهات وطلب بضاعة', onclick: go('/inventory') }),
        row({ icon: 'truck', title: 'الموردون', sub: 'ما عليك لكل مورّد', onclick: go('/suppliers') }),
      )),
      section(null, h('div', { class: 'list' },
        row({ icon: 'store', title: 'بيانات المحل', sub: app.shop?.name, onclick: go('/settings/shop') }),
        row({ icon: 'sliders', title: 'الميزات', sub: `${SHOP_TYPES[app.shop?.shop_type]?.name || ''} — شغّل وأطفئ ما تحتاجه`, onclick: go('/settings/features') }),
        row({ icon: 'tag', title: 'التصنيفات', sub: 'ألبان، معلبات، منظفات…', onclick: go('/settings/categories') }),
        f.multiCurrency ? row({ icon: 'coins', title: 'العملات وأسعار الصرف', onclick: go('/settings/currencies') }) : null,
        row({ icon: 'wallet', title: 'طرق الدفع', sub: 'نقدًا، تحويل، محافظ، آجل', onclick: go('/settings/payments') }),
      )),
      section(null, h('div', { class: 'list' },
        row({ icon: 'cloud', title: 'المزامنة والنسخ', sub: 'حالة رفع بياناتك', onclick: go('/settings/sync') }),
        row({ icon: 'sun', title: 'المظهر والأصوات', onclick: go('/settings/appearance') }),
        row({ icon: 'info', title: 'عن التطبيق', end: num(app.info.version), onclick: go('/settings/about') }),
      )),
    ),
  );
}

export function renderShopProfile(el) {
  const s = app.shop;
  const name = input({ value: s.name, maxlength: 60 });
  const phone = input({ value: s.phone || '', type: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: 20 });
  const address = input({ value: s.address || '', maxlength: 120 });
  const logoTile = h('button', { class: 'img-tile img-add logo-tile', type: 'button', onclick: pickLogo }, icon('camera', 26), h('span', null, 'اختر الشعار'));
  app.media.logoUrl().then((u) => { if (u) { logoTile.style.backgroundImage = `url("${u}")`; logoTile.classList.add('has-photo'); } });
  async function pickLogo() {
    const file = await pickImage({ camera: false });
    if (!file) return;
    try {
      const path = await app.media.setLogo(file);
      await app.store.patch('shops', s.id, { logo_path: path });
      await app.loadShop();
      const u = await app.media.logoUrl();
      logoTile.style.backgroundImage = `url("${u}")`;
      logoTile.classList.add('has-photo');
      feedback.ok();
    } catch { feedback.error(); toast('تعذّرت قراءة الصورة', { kind: 'error' }); }
  }
  async function save(e) {
    e.preventDefault();
    if (!name.value.trim()) { feedback.error(); toast('اسم المحل مطلوب', { kind: 'error' }); return; }
    await app.store.patch('shops', s.id, {
      name: name.value.trim(),
      phone: normalizeDigits(phone.value).replace(/[^\d+]/g, '') || null,
      address: address.value.trim() || null,
    });
    await app.loadShop();
    feedback.ok();
    toast('حُفظ', { kind: 'ok' });
    history.back();
  }
  el.append(
    header('بيانات المحل', { back: true }),
    h('form', { class: 'page', onsubmit: save },
      field('اسم المحل', name),
      field('رقم الجوال', phone, 'يظهر على الفواتير، ويُرسل منه واتساب'),
      field('العنوان', address),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'الشعار (يظهر على الفواتير)'), logoTile),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ),
  );
}

export function renderFeatures(el) {
  const list = h('div', { class: 'list' });
  function paint() {
    fill(list, ...Object.entries(FEATURES).map(([key, def]) =>
      switchRow({
        title: def.name, sub: def.hint, checked: app.features[key],
        onchange: (on) => setFeature(key, on),
      })));
  }
  async function setFeature(key, on) {
    const before = { ...app.features };
    await app.updateShopSettings({ features: { ...app.features, [key]: on } });
    feedback.tap();
    toast(`${FEATURES[key].name}: ${on ? 'شُغّلت' : 'أُطفئت'}`, {
      undo: async () => { await app.updateShopSettings({ features: before }); paint(); },
    });
  }
  paint();
  el.append(
    header('الميزات', { back: true }),
    h('div', { class: 'page' },
      h('p', { class: 'muted' }, 'الميزة المطفأة تختفي تمامًا من التطبيق. يمكنك تشغيلها في أي وقت.'),
      list,
      section('نوع المحل', h('div', { class: 'chips' }, ...Object.entries(SHOP_TYPES).map(([k, t]) =>
        h('button', {
          class: `chip ${app.shop.shop_type === k ? 'on' : ''}`, type: 'button',
          onclick: async () => {
            await app.store.patch('shops', app.shop.id, { shop_type: k });
            await app.loadShop();
            toast(`نوع المحل: ${t.name}`);
            fill(el); renderFeatures(el);
          },
        }, icon(t.icon, 18), t.name)))),
    ),
  );
}

export function renderCurrencies(el) {
  const rates = { ...(app.shop.settings?.rates || {}) };
  const base = CURRENCIES[app.shop.base_currency || 'ILS'];
  const inputs = {};
  el.append(
    header('العملات', { back: true }),
    h('form', { class: 'page', onsubmit: save },
      h('p', { class: 'muted' }, `العملة الأساسية: ${base.name} (${base.symbol}). كل الحسابات والتقارير بها.`),
      ...EXTRA_CURRENCIES.map((code) => {
        const c = CURRENCIES[code];
        inputs[code] = input({ inputmode: 'decimal', dir: 'ltr', placeholder: '0.00', value: rates[code] ? formatDecimal(rates[code], 6, { trim: true, group: false }) : '' });
        return field(`سعر 1 ${c.name} (${c.symbol}) بالـ${base.name}`, inputs[code]);
      }),
      button('حفظ الأسعار', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ),
  );
  async function save(e) {
    e.preventDefault();
    const next = {};
    for (const code of EXTRA_CURRENCIES) {
      const v = inputs[code].value.trim();
      if (!v) { next[code] = null; continue; }
      const r = parseRate(v);
      if (!r) { feedback.error(); toast(`سعر ${CURRENCIES[code].name} غير صحيح`, { kind: 'error' }); return; }
      next[code] = r;
    }
    await app.updateShopSettings({ rates: next, ratesUpdatedAt: new Date().toISOString() });
    feedback.ok();
    toast('حُفظت أسعار الصرف', { kind: 'ok' });
    history.back();
  }
}

export function renderPayments(el) {
  const list = h('div', { class: 'list' });
  const kinds = { cash: 'نقدًا', transfer: 'تحويل / محفظة', credit: 'آجل (دين على الزبون)' };
  async function paint() {
    const methods = (await app.db.payment_methods.orderBy('sort').toArray()).filter((m) => !m.deleted);
    fill(list, ...methods.map((m) => row({
      icon: m.kind === 'cash' ? 'cash' : m.kind === 'credit' ? 'user' : 'wallet',
      title: m.name,
      sub: `${kinds[m.kind]}${m.active ? '' : ' — موقوفة'}`,
      tone: m.active ? '' : 'muted',
      onclick: () => edit(m),
    })));
  }
  function edit(m) {
    const isNew = !m;
    m = m || { name: '', kind: 'transfer', fee_bp: 0, active: true, sort: 99 };
    const name = input({ value: m.name, maxlength: 40, placeholder: 'مثال: بنك فلسطين، جوال باي' });
    let kind = m.kind;
    let active = m.active;
    const kindChips = h('div', { class: 'chips' });
    const paintKinds = () => fill(kindChips, ...Object.entries(kinds).map(([k, label]) =>
      h('button', { class: `chip ${kind === k ? 'on' : ''}`, type: 'button', onclick: () => { kind = k; paintKinds(); } }, label)));
    paintKinds();
    const sheet = openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim()) { feedback.error(); toast('اكتب اسم طريقة الدفع', { kind: 'error' }); return; }
        await app.store.put('payment_methods', { ...m, name: name.value.trim(), kind, fee_bp: 0, active });
        feedback.ok();
        close();
        paint();
      },
    },
      field('الاسم', name),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'النوع'), kindChips),
      isNew ? null : switchRow({ title: 'مفعّلة', checked: active, onchange: (v) => { active = v; } }),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ), { title: isNew ? 'طريقة دفع جديدة' : 'تعديل طريقة الدفع' });
    setTimeout(() => (isNew ? name.focus() : null), 200);
    return sheet;
  }
  paint();
  el.append(
    header('طرق الدفع', { back: true }),
    h('div', { class: 'page' },
      list,
      button('أضف طريقة دفع', { kind: 'outline', icon: 'plus', block: true, onclick: () => edit(null) }),
    ),
  );
}

export function renderSync(el) {
  const box = h('div');
  const states = {
    disabled: ['cloudOff', 'المزامنة غير مفعّلة في هذه النسخة', 'بياناتك محفوظة على هذا الجوال فقط.'],
    offline: ['cloudOff', 'لا يوجد إنترنت', 'كل شيء محفوظ على الجوال، ويُرفع وحده حين يعود الإنترنت.'],
    syncing: ['refresh', 'جارٍ الرفع…', ''],
    synced: ['cloud', 'بياناتك محفوظة على الخادم', ''],
    idle: ['cloud', 'جاهز', ''],
    error: ['alert', 'تعذّرت المزامنة', 'سنحاول مجددًا تلقائيًا.'],
  };
  function paint(s) {
    const [ic, title, sub] = states[s.state] || states.idle;
    fill(box, card(
      h('div', { class: `sync-card sync-${s.state}` }, icon(ic, 32), h('div', null, h('strong', null, title), sub ? h('p', { class: 'muted' }, sub) : null)),
      h('div', { class: 'list' },
        row({ title: 'بانتظار الرفع', end: num(String(s.pending || 0)) }),
        row({ title: 'آخر مزامنة', end: s.lastSyncAt ? num(new Date(s.lastSyncAt).toLocaleString('en-GB', { hour12: false })) : 'لم تتم بعد' }),
        row({ title: 'حرف هذا الجهاز في أرقام الفواتير', end: num(app.ctx.prefix) }),
      ),
      s.error && s.state === 'error' ? h('p', { class: 'muted small', dir: 'ltr' }, s.error) : null,
      s.state !== 'disabled' ? button('زامن الآن', { kind: 'outline', icon: 'refresh', block: true, onclick: () => app.sync.run() }) : null,
    ));
  }
  el.append(
    header('المزامنة', { back: true }),
    h('div', { class: 'page' }, box,
      h('p', { class: 'muted small' }, 'التطبيق يعمل كاملًا بلا إنترنت. المزامنة تعمل بصمت في الخلفية ولا توقفك عن البيع أبدًا.')),
  );
  app.sync.refreshPending();
  paint(app.sync.status);
  return bus.on('sync', paint);
}

export function renderAppearance(el) {
  const prefs = readPrefs();
  const themes = { auto: 'تلقائي (حسب الجوال)', light: 'فاتح', dark: 'ليلي' };
  const chips = h('div', { class: 'chips' });
  const paintChips = () => fill(chips, ...Object.entries(themes).map(([k, label]) =>
    h('button', { class: `chip ${prefs.theme === k ? 'on' : ''}`, type: 'button', onclick: () => { prefs.theme = k; savePrefs(prefs); applyTheme(k); paintChips(); } }, label)));
  paintChips();
  el.append(
    header('المظهر والأصوات', { back: true }),
    h('div', { class: 'page' },
      section('المظهر', chips),
      section('شاشة البيع', h('div', { class: 'list' },
        switchRow({ title: 'إظهار الربح أثناء البيع', sub: 'مطفأ: لا يرى الزبون ربحك. الربح يظهر دائمًا في الرئيسية والتقارير.', checked: prefs.saleProfit === true, onchange: (v) => { prefs.saleProfit = v; savePrefs(prefs); } }),
      )),
      section('عند المسح', h('div', { class: 'list' },
        switchRow({ title: 'صوت', checked: prefs.sound, onchange: (v) => { prefs.sound = v; savePrefs(prefs); configureFeedback({ sound: v }); feedback.ok(); } }),
        switchRow({ title: 'اهتزاز', checked: prefs.vibrate, onchange: (v) => { prefs.vibrate = v; savePrefs(prefs); configureFeedback({ vibrate: v }); feedback.ok(); } }),
      )),
    ),
  );
}

export function renderAbout(el) {
  el.append(
    header('عن التطبيق', { back: true }),
    h('div', { class: 'page' },
      card(h('div', { class: 'list' },
        row({ title: 'دفترة كاشير', end: num(app.info.version) }),
        row({ title: 'النسخة', end: app.info.flavor === 'play' ? 'Google Play' : app.info.flavor === 'direct' ? 'تثبيت مباشر' : 'تجريبية' }),
        row({ title: 'رقم البناء', end: num(String(app.info.build)) }),
      )),
      h('p', { class: 'made-by' }, 'أحد منتجات ', h('b', null, 'MakeFlow')),
    ),
  );
}

// ---------- تفضيلات هذا الجهاز (ليست بيانات المحل، لا تُزامن) ----------
const PREFS_KEY = 'cashier-prefs';
export function readPrefs() {
  try { return { theme: 'auto', sound: true, vibrate: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { theme: 'auto', sound: true, vibrate: true }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* وضع خاص */ }
}
export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

