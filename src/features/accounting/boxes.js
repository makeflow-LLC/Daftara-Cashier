// الصناديق: كل مكان فيه مال المحل برصيده — الدرج، البنك والمحافظ (طرق الدفع بالتحويل)، وصناديقك الإضافية (خزنة، حساب بنك).
// صندوق جديد برصيده الآن، تحويل بين صندوقين بضغطتين، وحركة كل صندوق بضغطة عليه.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, emptyState } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { transferSheet } from './vouchers.js';
import { amountInput } from './common.js';

const KIND_ICON = { drawer: 'cash', cash: 'safe', bank: 'bank' };

/** ورقة صندوق جديد أو تعديل اسمه ونوعه. */
export function boxSheet(box = null, onSaved = null) {
  const name = input({ maxlength: 40, placeholder: 'مثال: الخزنة، بنك فلسطين', value: box ? box.name : '' });
  const opening = amountInput();
  let kind = box ? box.kind : 'cash';
  const kinds = h('div', { class: 'chips' });
  const paint = () => fill(kinds,
    h('button', { class: `chip ${kind === 'cash' ? 'on' : ''}`, type: 'button', onclick: () => { kind = 'cash'; paint(); } }, icon('safe', 16), 'نقد (خزنة، صندوق ثانٍ)'),
    h('button', { class: `chip ${kind === 'bank' ? 'on' : ''}`, type: 'button', onclick: () => { kind = 'bank'; paint(); } }, icon('bank', 16), 'حساب بنك'));
  paint();
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const saved = await app.accounting.saveBox({ id: box ? box.id : null, name: name.value, kind, opening: box ? 0 : opening.get() });
        feedback.ok(); close();
        toast(box ? 'عُدّل الصندوق' : `أُضيف «${saved.name}»`, { kind: 'ok' });
        if (onSaved) onSaved(saved);
      } catch (err) { busy = false; feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); name.focus(); }
    },
  },
    field('اسم الصندوق', name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'نوعه'), kinds),
    box ? null : field('كم فيه الآن؟', opening.el, 'اتركه فارغًا إن كان فارغًا. هذا رصيد البداية، لا يُحسب ربحًا.'),
    button(box ? 'حفظ' : 'أضف الصندوق', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    box && app.can('delete') ? h('button', {
      class: 'btn btn-text btn-block btn-danger-text', type: 'button',
      onclick: async () => {
        try {
          await app.accounting.closeBox(box.id);
          feedback.ok(); close();
          toast(`أُغلق «${box.name}»`, { undo: async () => { await app.accounting.reopenBox(box.id); if (onSaved) onSaved(); } });
          if (onSaved) onSaved();
        } catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الإغلاق', { kind: 'error', ms: 4000 }); }
      },
    }, icon('trash', 20), h('span', null, 'أغلق هذا الصندوق')) : null,
  ), { title: box ? 'تعديل الصندوق' : 'صندوق جديد' });
  if (!box) setTimeout(() => name.focus(), 150);
}

export function renderBoxes(el) {
  const top = h('div');
  const list = h('div');
  const canWrite = app.can('cash');
  el.append(header('الصناديق', { back: true }), h('div', { class: 'page split' }, top, list));

  async function load() {
    const money0 = await app.accounting.money();
    const total = money0.reduce((a, m) => a + m.balance, 0);
    const boxes = app.accounting.boxes();
    fill(top,
      h('div', { class: 'balance-card clear' },
        h('div', { class: 'hero-label' }, 'مجموع ما في الصناديق والبنوك'),
        h('div', { class: 'hero-value' }, money(total)),
        h('div', { class: 'hero-mini-label' }, `${money0.length} ${money0.length > 10 ? 'صندوقًا' : 'صناديق'}`)),
      canWrite ? h('div', { class: 'big-actions' },
        h('button', { class: 'big-btn pay', type: 'button', onclick: () => transferSheet({ onSaved: load }) }, icon('swap', 26), h('span', null, 'حوّل بين صندوقين')),
        h('button', { class: 'big-btn debt box-add', type: 'button', onclick: () => boxSheet(null, load) }, icon('plus', 26), h('span', null, 'صندوق جديد'))) : null,
    );
    const item = (m) => {
      const box = m.custom ? boxes.find((b) => b.id === m.id) : null;
      // رصيد سالب = خرج منه أكثر مما سُجّل أنه دخله (غالبًا مال كان فيه قبل استعمال التطبيق): يُصحَّح برقم واحد
      const sub = m.kind === 'drawer' ? 'نقد البيع — يُغلق من «الصندوق»' : m.balance < 0 ? 'الرصيد لا يطابق؟ اضغط ثم «صحّح الرصيد»' : m.custom ? (m.kind === 'bank' ? 'حساب بنك' : 'صندوق نقد') : 'طريقة دفع (تحويل)';
      return h('div', { class: 'row row-split' },
        h('button', { class: 'row-tap row-body', type: 'button', onclick: () => navigate(`/accounting/ledger?account=${encodeURIComponent(m.key)}`) },
          h('span', { class: 'row-ic' }, icon(KIND_ICON[m.kind] || 'bank', 22)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, m.name), h('span', { class: 'row-sub' }, sub)),
          h('span', { class: `row-end strong ${m.balance < 0 ? 'owed' : ''}` }, money(m.balance))),
        box && canWrite ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `تعديل ${m.name}`, onclick: () => boxSheet(box, load) }, icon('edit', 20)) : null);
    };
    fill(list,
      h('h2', { class: 'section-title' }, 'كل صندوق ورصيده'),
      h('div', { class: 'list' }, ...money0.map(item)),
      money0.length <= 1 ? emptyState('safe', 'عندك خزنة أو حساب بنك؟', 'أضفها صندوقًا، ثم حوّل إليها النقد من الدرج آخر اليوم — فيعرف التطبيق أين مالك كله.') : null,
      h('p', { class: 'muted small' }, 'البنك والمحافظ هنا هي طرق الدفع بالتحويل (الإعدادات ← طرق الدفع). رصيدها ما دخلها بالبيع والدفعات ناقص ما خرج منها. اضغط أي صندوق لترى حركته.'),
    );
  }

  load();
  const off = bus.on('data', load);
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
