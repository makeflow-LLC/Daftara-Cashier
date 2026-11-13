// صورة مصغّرة للصنف تُحمَّل حين تظهر على الشاشة فقط (قوائم طويلة على جوال رخيص).
// إن لم تكن على الجهاز (أُضيفت من جوال آخر) تنزل المصغّرة (~10KB) حين يتوفر الإنترنت.
import { h } from '../../ui/dom.js';
import { app } from '../../core/app.js';

let observer = null;

function load(el) {
  const id = el.dataset.pid;
  (async () => {
    const img = await app.media.firstImage(id);
    if (!img) return;
    let url = await app.media.url(img.id);
    if (!url && app.mediaSync && navigator.onLine !== false && (await app.mediaSync.fetch(img))) url = await app.media.url(img.id);
    if (url && el.isConnected) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add('has-img');
    }
  })();
}

/** صورة الصنف، أو الحرف الأول من اسمه إن لم تكن له صورة. */
export function productThumb(product, size = 48) {
  const el = h('span', { class: 'thumb', style: { width: `${size}px`, height: `${size}px` }, dataset: { pid: product.id }, 'aria-hidden': 'true' },
    (product.name || '؟').trim().charAt(0));
  if (!app.feature('images')) return el;
  if (!observer && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); load(e.target); }
    }, { rootMargin: '200px' });
  }
  if (observer) observer.observe(el); else load(el);
  return el;
}
