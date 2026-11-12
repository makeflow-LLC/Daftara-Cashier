// أيقونات SVG داخل الكود (بلا ملفات ولا خطوط أيقونات): خفيفة وتعمل بلا إنترنت.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10.5 8v8M14 8v8M17 8v8"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  more: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  back: '<path d="m9 5 7 7-7 7"/>',
  chevron: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 8.6 4.5 4.5 0 0 1 17.5 18H7Z"/>',
  cloudOff: '<path d="M7 18a5 5 0 0 1-.6-9.96M10 6.3A6 6 0 0 1 18 8.6 4.5 4.5 0 0 1 20.4 16M17.5 18H7"/><path d="M3 3l18 18"/>',
  cloudUp: '<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 8.6 4.5 4.5 0 0 1 17.5 18H7Z"/><path d="M12 15v-5M9.5 12.5 12 10l2.5 2.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.4L20 16M20 20v-4h-4"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3H5l2.4 12h11.1l2-8.5H6"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="8" r="1.5"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  camera: '<path d="M4 7h3l2-2.5h6L17 7h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  basket: '<path d="M3 10h18l-2 10H5L3 10Z"/><path d="m8 10 3.5-6M16 10l-3.5-6M9 14v3M15 14v3"/>',
  shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0Z"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 8v3M10 8v4.5M14 8v3M18 8v4.5"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  pill: '<path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7Z"/><path d="m8.5 8.5 7 7"/>',
  store: '<path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v9h14v-9"/><path d="M10 21v-5h4v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z"/><circle cx="16" cy="14.5" r="1.2"/>',
};

export function icon(name, size = 24, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.info}</svg>`;
  return span;
}

export const ICONS = Object.keys(P);
