// تنقّل بسيط بالـ hash (#/sale). كل وحدة تسجّل شاشاتها؛ الشاشة دالة ترسم داخل عنصر وترجع دالة تنظيف.
import { clear } from '../ui/dom.js';

const routes = new Map();
let view = null;
let cleanup = null;
let current = null;
const listeners = new Set();
let guard = null;

/** fn(route, path) → مسار بديل أو null. يُستعمل لوضع القراءة فقط (الترخيص). */
export function setGuard(fn) {
  guard = fn;
}

/** route: { path: '/sale', render(el, params) → cleanup?, tab: 'home'|…, chrome: true|false } */
export function addRoute(route) {
  routes.set(route.path, route);
}

export function mount(el) {
  view = el;
  window.addEventListener('hashchange', render);
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) return render();
  if (replace) { history.replaceState(null, '', target); render(); }
  else location.hash = target;
}

export function currentRoute() {
  return current;
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function parse() {
  const raw = (location.hash || '#/').slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
}

export async function render() {
  const { path, params } = parse();
  const route = routes.get(path) || routes.get('/');
  const redirect = guard ? guard(route, path) : null;
  if (redirect && redirect !== path) { navigate(redirect, { replace: true }); return; }
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  current = route;
  clear(view);
  view.scrollTop = 0;
  for (const fn of listeners) fn(route);
  const r = await route.render(view, params);
  if (typeof r === 'function') cleanup = r;
}
