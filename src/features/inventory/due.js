// واجهة موعد الدفع للتاجر: الشارة في القائمة، الشريط في صفحة التاجر، وورقة «متى تدفع له؟»
// (أزرار سريعة أو تاريخ، وملاحظة مثل «شيك»). التخزين والتذكير في core/dues.js.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, input, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { addDays, dueStatus, dueText, isDay } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';

/** «الخميس، 26 تشرين الثاني» */
export function dueDateText(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
}

const QUICK = [['بعد أسبوع', 7], ['بعد أسبوعين', 14], ['بعد شهر', 30]];
const DUE_CLASS = { overdue: 'due-bad', today: 'due-bad', soon: 'due-warn', later: 'due-ok' };

/** يحفظ موعد الدفع لتاجر (date = null يمسحه). */
export function setSupplierDue(id, date, note = null) {
  return app.dues.set(id, date || null, note);
}

/** شارة الموعد: «متأخر 3 أيام» / «غدًا» … */
export function dueBadge(id) {
  const d = app.dues.get(id);
  if (!d) return null;
  const st = dueStatus(d.date, localDay());
  return h('span', { class: `due-badge ${DUE_CLASS[st.state]}` }, icon('alert', 13), dueText(st.days));
}

/** حقل اختيار الموعد داخل ورقة: أزرار سريعة + تاريخ + «بلا موعد». value() يرجع 'YYYY-MM-DD' أو null. */
export function duePicker(initial = null) {
  let value = isDay(initial) ? initial : null;
  const chips = h('div', { class: 'chips due-chips' });
  const date = input({ type: 'date', dir: 'ltr', min: localDay(), value: value || '', 'aria-label': 'تاريخ الدفع' });
  const label = h('div', { class: 'field-hint due-picked' });
  const paint = () => {
    fill(chips,
      h('button', { class: `chip ${value === null ? 'on' : ''}`, type: 'button', onclick: () => { value = null; date.value = ''; paint(); } }, 'بلا موعد'),
      ...QUICK.map(([text, n]) => { const k = addDays(localDay(), n); return h('button', { class: `chip ${value === k ? 'on' : ''}`, type: 'button', onclick: () => { value = k; date.value = k; paint(); } }, text); }));
    label.textContent = value ? `الموعد: ${dueDateText(value)} — ${dueText(dueStatus(value, localDay()).days)}` : 'أو اختر تاريخًا:';
  };
  date.addEventListener('change', () => { value = isDay(date.value) ? date.value : null; paint(); });
  paint();
  return { el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'موعد الدفع (نذكّرك قبله)'), chips, label, date), value: () => value };
}

/** ورقة «متى تدفع له؟». onDone بعد الحفظ. */
export function dueSheet(s, onDone = null, { title = null } = {}) {
  const cur = app.dues.get(s.id);
  const picker = duePicker(cur ? cur.date : null);
  const note = input({ maxlength: 60, value: cur?.note || '', placeholder: 'شيك، دفعة أولى… (اختياري)' });
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const v = picker.value();
        await setSupplierDue(s.id, v, note.value);
        feedback.ok(); close();
        toast(v ? `سنذكّرك بالدفع لـ ${s.name} ${dueText(dueStatus(v, localDay()).days)}` : 'أُلغي موعد الدفع', { kind: 'ok', ms: 3500 });
        if (onDone) onDone(v);
      } catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    h('p', { class: 'muted' }, 'نذكّرك قبل الموعد بثلاثة أيام، ويوم الموعد، وكل يوم بعده حتى تدفع أو تؤجّل.'),
    picker.el, field('ملاحظة', note),
    button('حفظ الموعد', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
  ), { title: title || `متى تدفع لـ ${s.name}؟` });
}

/** شريط الموعد تحت رصيد التاجر: يعرض الموعد وحالته وملاحظته، والضغط يغيّره. null إن لم يكن عليك له شيء. */
export function dueStrip(s, onChange) {
  if (!(s.balance > 0)) return null;
  const due = app.dues.get(s.id);
  const open = () => dueSheet(s, onChange);
  if (!due) {
    return h('button', { class: 'due-strip due-none', type: 'button', onclick: open },
      icon('calendar', 22), h('span', { class: 'row-main' }, h('strong', null, 'حدّد موعد الدفع'), h('span', null, 'نذكّرك قبل الموعد حتى لا يفوتك')), icon('chevron', 18));
  }
  const st = dueStatus(due.date, localDay());
  return h('button', { class: `due-strip due-${st.state}`, type: 'button', onclick: open },
    icon(st.state === 'overdue' ? 'alert' : 'calendar', 22),
    h('span', { class: 'row-main' }, h('strong', null, 'موعد الدفع: ', dueText(st.days)), h('span', null, dueDateText(due.date), due.note ? ` · ${due.note}` : '')),
    h('span', { class: 'due-change' }, 'تغيير'));
}
