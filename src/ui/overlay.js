// الطبقات فوق الشاشة: إشعار قصير مع «تراجع» (بدل نوافذ التأكيد)، وورقة سفلية (bottom sheet).
import { h, clear } from './dom.js';
import { icon } from './icons.js';

let toastEl = null;
let toastTimer = null;

/**
 * toast('حُذف الصنف', { undo: () => …, kind: 'ok'|'error'|'info', ms })
 * مع undo: زر «تراجع» ظاهر 5 ثوانٍ؛ الضغط عليه يلغي العملية.
 */
export function toast(message, { undo = null, kind = 'info', ms } = {}) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  clearTimeout(toastTimer);
  clear(toastEl);
  toastEl.className = `toast toast-${kind}`;
  toastEl.append(
    icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 20),
    h('span', { class: 'toast-msg' }, message),
  );
  if (undo) {
    toastEl.append(h('button', {
      class: 'toast-undo', type: 'button',
      onclick: () => { hideToast(); undo(); },
    }, icon('undo', 18), 'تراجع'));
  }
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hideToast, ms ?? (undo ? 5000 : 2600));
}

export function hideToast() {
  if (toastEl) toastEl.classList.remove('show');
}

const sheets = [];

/**
 * يفتح ورقة سفلية. content: عنصر DOM أو دالة (close) => عنصر.
 * يرجع { close, el }. زر الرجوع في أندرويد يغلق آخر ورقة مفتوحة.
 */
export function openSheet(content, { title = null, onClose = null } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const wrap = h('div', { class: 'sheet-wrap' }, backdrop, panel);
  let closed = false;
  const api = {
    el: panel,
    close() {
      if (closed) return;
      closed = true;
      const i = sheets.indexOf(api);
      if (i >= 0) sheets.splice(i, 1);
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 180);
      if (onClose) onClose();
    },
  };
  panel.append(h('div', { class: 'sheet-handle' }));
  if (title) {
    panel.append(h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => api.close() }, icon('x')),
    ));
  }
  panel.append(typeof content === 'function' ? content(api.close) : content);
  backdrop.addEventListener('click', () => api.close());
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  sheets.push(api);
  return api;
}

/** يغلق كل الأوراق (عند الانتقال لشاشة أخرى). */
export function closeAllSheets() {
  while (sheets.length) sheets[sheets.length - 1].close();
}

/** يغلق آخر ورقة مفتوحة؛ يرجع true إن وُجدت (لزر الرجوع). */
export function closeTopSheet() {
  const s = sheets[sheets.length - 1];
  if (!s) return false;
  s.close();
  return true;
}
