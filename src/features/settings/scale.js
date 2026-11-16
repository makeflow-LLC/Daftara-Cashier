// الإعدادات ← ميزان الباركود: الميزان يطبع ملصقًا فيه رقم الصنف والوزن (أو السعر)، وشاشة البيع تقرؤه.
// مطفأ حتى يشغّله صاحب المحل. الشكل الافتراضي هو الأشهر: 2X + رقم صنف 5 أرقام + وزن بالغرام 5 أرقام.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, section, switchRow, field, input } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { scaleSettings, parsePrefixes, parseScaleBarcode, sampleScaleBarcode, scaleQuantity } from '../../domain/scale.js';
import { normalizeBarcode } from '../../domain/product.js';
import { formatQty, lineAmount, unit as unitOf } from '../../domain/units.js';
import { formatMoney } from '../../domain/currency.js';

export function renderScaleSettings(el) {
  let s = scaleSettings(app.shop?.settings?.scale);
  const base = app.shop?.base_currency || 'ILS';
  const body = h('div');
  el.append(header('ميزان الباركود', { back: true }), h('div', { class: 'page' }, body));

  async function save(patch) {
    s = scaleSettings({ ...s, ...patch });
    await app.updateShopSettings({ scale: s });
    paint();
  }

  const prefixes = input({ value: s.prefixes, dir: 'ltr', inputmode: 'numeric', placeholder: '20-29' });
  prefixes.addEventListener('change', () => {
    const v = prefixes.value.trim();
    if (!parsePrefixes(v)) { feedback.error(); toast('اكتب البداية أرقامًا: 20-29 أو 21,22', { kind: 'error' }); prefixes.value = s.prefixes; return; }
    save({ prefixes: v });
  });

  const test = input({ dir: 'ltr', inputmode: 'numeric', placeholder: 'امسح ملصقًا أو اكتب أرقامه', enterkeyhint: 'done' });
  const testOut = h('div', { class: 'field-hint' });
  async function runTest() {
    const code = normalizeBarcode(test.value);
    if (!code) { fill(testOut); return; }
    const parsed = parseScaleBarcode(code, { ...s, enabled: true });
    if (!parsed) { fill(testOut, h('span', { class: 'neg' }, 'ليس ملصق ميزان بهذه الإعدادات (13 رقمًا، يبدأ بالبداية المكتوبة، ورقم التحقق صحيح).')); return; }
    const p = await app.products.findByScaleCode(parsed.code);
    const what = parsed.mode === 'weight' ? `الوزن ${formatQty(parsed.value)} كيلو` : `السعر ${formatMoney(parsed.value, base)}`;
    if (!p) { fill(testOut, `رقم الصنف ${parsed.code} · ${what} — `, h('b', null, 'لا صنف بهذا الرقم بعد')); return; }
    const q = scaleQuantity(p, parsed);
    fill(testOut, h('b', null, p.name), ` · ${what}`, q ? h('span', null, ' ← ', num(formatQty(q.qty)), ` ${unitOf(p.unit).short || ''} = `, num(formatMoney(lineAmount(p.sell_price, q.qty) - q.discount, base))) : ' (الصنف بلا سعر)');
  }
  test.addEventListener('input', runTest);
  test.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } });

  function chips(options, current, onpick) {
    return h('div', { class: 'chips' }, ...options.map(([v, label]) =>
      h('button', { class: `chip ${current === v ? 'on' : ''}`, type: 'button', onclick: () => { feedback.tap(); onpick(v); } }, label)));
  }

  function layoutText() {
    const prefs = parsePrefixes(s.prefixes);
    const pl = prefs ? prefs[prefs.length - 1].length : 2;
    const vl = 12 - pl - s.codeLength;
    return h('div', { class: 'scale-layout', dir: 'ltr' },
      h('span', { class: 'sl-p' }, 'P'.repeat(pl)), h('span', { class: 'sl-c' }, 'C'.repeat(s.codeLength)),
      h('span', { class: 'sl-v' }, 'V'.repeat(Math.max(vl, 0))), h('span', { class: 'sl-k' }, 'K'));
  }

  function paint() {
    const sample = sampleScaleBarcode(s);
    fill(body,
      h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('scan', 30)),
        h('div', null, h('strong', null, 'امسح ملصق الميزان مباشرة'),
          h('span', null, 'تزن الخضار أو اللحمة على الميزان فيطبع ملصقًا. عند مسحه في شاشة البيع يُضاف الصنف بوزنه وسعره تلقائيًا.'))),
      h('div', { class: 'list' }, switchRow({
        title: 'قراءة باركود الميزان', sub: s.enabled ? 'مفعّلة' : 'مطفأة', checked: s.enabled,
        onchange: (on) => { save({ enabled: on }); toast(on ? 'شُغّلت قراءة ملصقات الميزان' : 'أُطفئت قراءة ملصقات الميزان'); },
      })),
      s.enabled ? h('div', null,
        section('شكل الملصق (كما في إعداد الميزان)',
          field('بداية الباركود', prefixes, 'غالبًا 20 إلى 29. يمكن كتابة أكثر من بداية: 21,22'),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'عدد أرقام رقم الصنف'),
            chips([[4, '4'], [5, '5 (الأشهر)'], [6, '6']], s.codeLength, (v) => save({ codeLength: v }))),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'الملصق يحمل'),
            chips([['weight', 'الوزن (بالغرام)'], ['price', 'السعر (بالأغورة)']], s.mode, (v) => save({ mode: v }))),
          layoutText(),
          h('p', { class: 'muted small' }, 'P بداية · C رقم الصنف · V ', s.mode === 'weight' ? 'الوزن' : 'السعر', ' · K رقم التحقق',
            sample ? h('span', null, ' — مثال: ', h('b', { class: 'num', dir: 'ltr' }, sample), s.mode === 'weight' ? ' = الصنف 123 بوزن 0.750 كيلو' : ' = الصنف 123 بسعر 12.50') : null)),
        section('جرّب ملصقًا', field('الباركود', test), testOut),
        section('بعدها',
          h('p', { class: 'muted' }, 'افتح كل صنف يُوزن ← «خيارات إضافية» ← «رقم الصنف في الميزان» واكتب نفس الرقم المبرمج في الميزان. اجعل وحدته «كيلو» وسعره سعر الكيلو.')),
      ) : null,
    );
  }
  paint();
}
