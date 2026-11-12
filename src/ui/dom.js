// أدوات DOM صغيرة بدل أي إطار عمل: التطبيق خفيف ويفتح بسرعة على الجوالات الرخيصة.

/**
 * h('button', { class: 'btn', onclick: fn }, 'نص', child)
 * الخصائص: class, style (نص أو كائن), dataset, on* للأحداث، html (نص HTML موثوق من التطبيق فقط)، والباقي سمات.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** رقم بخط الأرقام وفي عزل LTR حتى لا تنقلب الإشارة في الواجهة العربية. */
export function num(text, cls = '') {
  return h('span', { class: `num ${cls}`.trim(), dir: 'ltr' }, text);
}
