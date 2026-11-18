// إعداد طابعة الفواتير لهذا الجهاز: أندرويد ← اختر طابعة بلوتوث مقترنة، عرض الورق، طباعة تلقائية، وتجربة.
// الحاسوب والمتصفح ← نافذة الطباعة (أي طابعة في النظام، ومنها طابعات الفواتير USB).
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, switchRow, emptyState } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { printer } from '../../core/printer.js';

export async function renderPrinterSettings(el) {
  const body = h('div');
  el.append(header('طابعة الفواتير', { back: true }), h('div', { class: 'page' }, body));
  let devices = null;

  async function paint() {
    const s = await printer.settings();
    const paper = h('div', { class: 'chips' }, ...[58, 80].map((w) => h('button', { class: `chip ${s.paper === w ? 'on' : ''}`, type: 'button', onclick: async () => { await printer.save({ paper: w }); paint(); } }, `${w} ملم`)));
    fill(body,
      printer.bluetooth
        ? h('div', { class: `acc-card ${s.address ? 'acc-ok' : 'acc-info'}` }, h('span', { class: 'acc-ic' }, icon('printer', 30)),
          h('div', null, h('strong', null, s.address ? `الطابعة: ${s.name}` : 'لم تختر طابعة بعد'),
            h('span', null, 'طابعة حرارية بلوتوث (58 أو 80 ملم). اقرنها أولًا من إعدادات بلوتوث في الجوال — الرمز غالبًا 0000 أو 1234.')))
        : h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('printer', 30)),
          h('div', null, h('strong', null, 'الطباعة من نافذة الطباعة'), h('span', null, 'اختر طابعة الفواتير (USB أو شبكة) المعرّفة في الجهاز مرة واحدة، ثم «اطبع» من الفاتورة.'))),
      printer.bluetooth ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'الطابعات المقترنة'), deviceList(s)) : null,
      printer.bluetooth ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'عرض الورق'), paper) : null,
      h('div', { class: 'list section' },
        switchRow({ title: 'اطبع كل فاتورة بيع تلقائيًا', sub: 'بعد الدفع مباشرة، بلا ضغطة', checked: s.auto, onchange: (on) => printer.save({ auto: on }) })),
      button('اطبع ورقة تجربة', { block: true, size: 'lg', icon: 'printer', onclick: test }));
  }

  function deviceList(s) {
    if (devices === null) return button('اعرض الطابعات المقترنة', { kind: 'outline', icon: 'refresh', block: true, onclick: load });
    if (!devices.length) return emptyState('printer', 'لا أجهزة مقترنة', 'شغّل الطابعة، واقرنها من إعدادات بلوتوث في الجوال، ثم ارجع هنا.', button('حدّث القائمة', { kind: 'outline', onclick: load }));
    const pick = async (d) => { await printer.save({ address: d.address, name: d.name }); feedback.ok(); paint(); };
    return h('div', { class: 'list' }, ...devices.map((d) => h('button', { class: `row row-tap ${d.address === s.address ? 'row-on' : ''}`, type: 'button', onclick: () => pick(d) },
      h('span', { class: 'row-ic' }, icon(d.address === s.address ? 'check' : 'printer', 20)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, d.name), h('span', { class: 'row-sub num' }, d.address)))));
  }

  async function load() {
    try { devices = await printer.paired(); } catch (e) { feedback.error(); toast(e.message, { kind: 'error', ms: 4500 }); devices = null; }
    paint();
  }
  async function test() {
    try { await printer.test(); feedback.ok(); } catch (e) { feedback.error(); toast(e.message, { kind: 'error', ms: 4500 }); }
  }
  paint();
}
