// واجهة موعد السداد: الشريط في صفحة التاجر، ورقة اختيار الموعد (أزرار سريعة أو تاريخ)، ولافتة التنبيه.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, input } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { addDays, dateKey, dueStatus, dueText, isDateKey } from '../../domain/dues.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

/** «الخميس، 26 تشرين الثاني» */
export function dueDateText(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
}

const QUICK = [['بعد أسبوع', 7], ['بعد أسبوعين', 14], ['بعد شهر', 30]];

/**
 * حقل اختيار الموعد داخل ورقة: أزرار سريعة + تاريخ محدد + «بلا موعد». value() يرجع 'YYYY-MM-DD' أو null.
 */
export function duePicker(initial = null) {
  let value = isDateKey(initial) ? initial : null;
  const chips = h('div', { class: 'chips due-chips' });
  const date = input({ type: 'date', dir: 'ltr', min: dateKey(), value: value || '', 'aria-label': 'تاريخ السداد' });
  const label = h('div', { class: 'field-hint due-picked' });
  const paint = () => {
    fill(chips,
      h('button', { class: `chip ${value === null ? 'on' : ''}`, type: 'button', onclick: () => { value = null; date.value = ''; paint(); } }, 'بلا موعد'),
      ...QUICK.map(([text, n]) => { const k = addDays(n); return h('button', { class: `chip ${value === k ? 'on' : ''}`, type: 'button', onclick: () => { value = k; date.value = k; paint(); } }, text); }));
    label.textContent = value ? `الموعد: ${dueDateText(value)} — ${dueText(dueStatus(value))}` : 'أو اختر تاريخًا:';
  };
  date.addEventListener('change', () => { value = isDateKey(date.value) ? date.value : null; paint(); });
  paint();
  return { el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'موعد السداد (ننبّهك قبله)'), chips, label, date), value: () => value };
}

/** ورقة «موعد السداد» للتاجر. onSaved بعد الحفظ. */
export function dueSheet(supplier, { title = null, onSaved = () => {} } = {}) {
  const picker = duePicker(app.dues.get(supplier.id));
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const v = picker.value();
        await app.dues.set(supplier.id, v);
        feedback.ok(); close();
        toast(v ? `موعد السداد: ${dueDateText(v)} — ننبّهك قبله` : 'أُلغي موعد السداد', { kind: 'ok', ms: 3500 });
        onSaved(v);
      } catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    h('p', { class: 'muted' }, 'متى وعدت أن تدفع له؟ ننبّهك قبل الموعد بثلاثة أيام، ويوم الموعد، وكل يوم بعده حتى تدفع أو تؤجّل.'),
    picker.el,
    button('حفظ الموعد', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
  ), { title: title || `موعد السداد لـ ${supplier.name}` });
}

/** شريط الموعد تحت رصيد التاجر: يعرض الموعد وحالته، والضغط يغيّره. null إن لم يكن عليك له شيء. */
export function dueStrip(supplier, onChange) {
  if (!(supplier.balance > 0)) return null;
  const due = app.dues.get(supplier.id);
  const open = () => dueSheet(supplier, { onSaved: onChange });
  if (!due) {
    return h('button', { class: 'due-strip due-none', type: 'button', onclick: open },
      icon('calendar', 22), h('span', { class: 'row-main' }, h('strong', null, 'حدّد موعد السداد'), h('span', null, 'ننبّهك قبل الموعد حتى لا يفوتك')), icon('chevron', 18));
  }
  const st = dueStatus(due);
  return h('button', { class: `due-strip due-${st.state}`, type: 'button', onclick: open },
    icon(st.state === 'overdue' ? 'alert' : 'calendar', 22),
    h('span', { class: 'row-main' }, h('strong', null, 'موعد السداد: ', dueText(st)), h('span', null, dueDateText(due))),
    h('span', { class: 'due-change' }, 'تغيير'));
}

/** وسم صغير في صف التاجر بالقائمة. */
export function dueTag(status) {
  return h('span', { class: `due-tag due-${status.state}` }, status.state === 'later' ? `السداد ${dueText(status)}` : status.state === 'overdue' ? dueText(status) : `السداد ${dueText(status)}`);
}

/** لافتة الرئيسية وقسم التجار: تظهر حين يقترب موعد أو يفوت. */
export function dueBanner({ inList = false } = {}) {
  const box = h('div');
  const paint = () => {
    const a = app.dues && app.dues.alerts;
    const s = a ? app.dues.summary(a) : null;
    if (!s || (inList && a.items.length < 1)) { fill(box); return; }
    const go = () => (s.supplierId ? navigate(`/suppliers/view?id=${s.supplierId}`) : navigate('/suppliers'));
    fill(box, h('button', { class: `lic-banner ${a.overdue ? 'lic-bad' : 'lic-warn'}`, type: 'button', onclick: go },
      icon(a.overdue ? 'alert' : 'calendar', 26),
      h('span', { class: 'row-main' }, h('strong', null, s.title), h('span', null, num(s.sub))),
      h('span', { class: 'lic-cta' }, s.supplierId ? 'افتح' : 'عرض')));
  };
  paint();
  const off = app.bus.on('dues', paint);
  if (app.dues) app.dues.refresh().then(paint).catch(() => {});
  return { el: box, off };
}
