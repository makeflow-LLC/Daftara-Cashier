// الإضافة السريعة بالمسح: الكاميرا تبقى مفتوحة. باركود جديد ← ورقة صغيرة (الاسم والسعر وصورة اختيارية)
// ← حفظ ← عودة فورية للمسح. باركود مسجّل ← تنبيه قصير ونكمل. الاسم يُقترح من الكتالوج المشترك إن وُجد.
import { packToPiece, upsertPack } from '../../domain/product.js';
import { uuid } from '../../core/ids.js';
import { parseQty } from '../../domain/units.js';
import { h, num, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { field, input, button } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { openScanner } from '../../ui/scanner.js';
import { parseMoney, formatMoney } from '../../domain/currency.js';
import { formatQty, unit } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { compressImage, pickImage } from '../../core/media.js';

export function renderRapidAdd(el) {
  let added = 0;
  const countEl = num('0');
  const lastEl = h('div', { class: 'rapid-last muted small' }, 'امسح أول صنف');
  const panel = h('div', { class: 'rapid-panel' },
    h('div', { class: 'rapid-count' }, icon('box', 20), h('span', null, 'أُضيف '), countEl, h('span', null, ' صنف')),
    lastEl,
  );

  el.append(h('div', { class: 'page' }, h('p', { class: 'muted' }, 'الماسح مغلق.'),
    button('افتح الماسح من جديد', { icon: 'scan', onclick: start }),
    button('رجوع للأصناف', { kind: 'outline', onclick: () => navigate('/products', { replace: true }) })));

  let scanner = null;
  function start() {
    scanner = openScanner({
      title: 'إضافة سريعة',
      panel,
      onCode,
      onClose: () => { scanner = null; if (location.hash.startsWith('#/products/rapid')) navigate('/products', { replace: true }); },
    });
  }

  async function onCode(code) {
    const hit = await app.products.findByCode(code);
    if (hit) {
      const p = await app.products.get(hit.product.id);
      lastEl.textContent = `موجود: ${p.name} — المخزون ${formatQty(p.qty)} ${unit(p.unit).short}`;
      toast(`«${p.name}» مسجّل من قبل`);
      return;
    }
    return newProductSheet(code);
  }

  function newProductSheet(code) {
    return new Promise((resolve) => {
      const name = input({ maxlength: 120, placeholder: 'اسم الصنف', enterkeyhint: 'next' });
      const price = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0.00', enterkeyhint: 'done' });
      const hint = h('div', { class: 'field-hint' });
      // السعر لقطعة أم لكرتونة/دستة (التاجر يكتب غالبًا سعر الكرتونة)
      let mode = 'piece';
      const count = input({ dir: 'ltr', inputmode: 'numeric', placeholder: 'كم قطعة؟' });
      const priceLabel = h('span', { class: 'field-label' }, 'سعر بيع القطعة');
      const countBox = h('label', { class: 'field', hidden: true }, h('span', { class: 'field-label' }, 'كم قطعة فيها؟'), count);
      const modes = h('div', { class: 'chips price-mode' });
      const paintModes = () => {
        fill(modes, ...[['piece', 'قطعة'], ['كرتونة', 'كرتونة'], ['دستة', 'دستة']].map(([id, label]) => h('button', {
          class: `chip ${mode === id ? 'on' : ''}`, type: 'button', tabindex: '-1', // الانتقال بالكيبورد: الاسم ← السعر مباشرة
          onclick: () => { mode = id; if (id === 'دستة' && !count.value) count.value = '12'; paintModes(); (id === 'piece' ? price : (count.value ? price : count)).focus(); },
        }, label)));
        countBox.hidden = mode === 'piece';
        priceLabel.textContent = mode === 'piece' ? 'سعر بيع القطعة' : `سعر بيع ال${mode}`;
      };
      paintModes();
      let photo = null;
      const photoBtn = app.feature('images') ? h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: takePhoto }, icon('camera', 20), h('span', null, 'صورة (اختياري)')) : null;
      let saving = false;

      async function takePhoto() {
        await scanner?.suspendCamera();
        const file = await pickImage({ camera: true });
        await scanner?.resumeCamera();
        scanner?.pause(); // الورقة ما زالت مفتوحة
        if (!file) return;
        try {
          photo = await compressImage(file);
          photoBtn.style.backgroundImage = `url("${URL.createObjectURL(photo.thumb)}")`;
          photoBtn.classList.add('has-photo');
          photoBtn.lastChild.textContent = 'تغيير الصورة';
        } catch { toast('تعذّرت قراءة الصورة', { kind: 'error' }); }
      }

      const sheet = openSheet((close) => h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (saving) return;
          const sell = parseMoney(price.value || '', app.shop?.base_currency || 'ILS');
          if (!name.value.trim()) { feedback.error(); name.focus(); hint.textContent = 'اكتب اسم الصنف'; return; }
          if (sell === null || sell < 0) { feedback.error(); price.focus(); hint.textContent = 'اكتب سعر البيع'; return; }
          saving = true;
          try {
            let sellP = sell, packs = null;
            if (mode !== 'piece') {
              const n = parseQty(count.value || '');
              if (!(n > 1000)) { saving = false; feedback.error(); count.focus(); hint.textContent = `اكتب كم قطعة في ال${mode}`; return; }
              sellP = packToPiece({ count: n, sell }).sell;
              packs = upsertPack([], { name: mode, count: n, sell, makeId: uuid });
            }
            const { product } = await app.products.save({ name: name.value, barcode: code, sell_price: sellP, cost_price: 0 }, { packs });
            if (photo) await app.media.addProductImage(product.id, photo);
            added++;
            countEl.textContent = String(added);
            lastEl.textContent = `آخر صنف: ${product.name} — ${formatMoney(sell)}`;
            feedback.ok();
            close();
          } catch (err) {
            saving = false;
            feedback.error();
            hint.textContent = err.errors ? Object.values(err.errors)[0] : 'تعذّر الحفظ';
          }
        },
      },
        h('div', { class: 'rapid-code' }, icon('scan', 18), num(code)),
        field('الاسم', name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'السعر الذي ستكتبه لـ'), modes),
        countBox,
        h('label', { class: 'field' }, priceLabel, price),
        hint,
        photoBtn,
        button('حفظ وامسح التالي', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      ), { title: 'صنف جديد', onClose: () => resolve() });

      setTimeout(() => name.focus(), 150);
      // اسم مقترح من الكتالوج المشترك (لا ننتظره: نكتب فوقه إن وصل والحقل فارغ)
      hint.textContent = '';
      app.catalogLookup(code).then((n) => {
        if (n && !name.value.trim() && sheet.el.isConnected) {
          name.value = n;
          hint.textContent = 'الاسم من الكتالوج المشترك — عدّله إن شئت';
          price.focus();
        }
      });
    });
  }

  start();
  return () => { if (scanner) scanner.close(); };
}
