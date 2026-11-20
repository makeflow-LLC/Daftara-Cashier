// المحادثة الداخلية والتعميمات: أهل المحل يتراسلون من أجهزتهم (للجميع أو لشخص)، وصاحب المحل يكتب تعميمًا
// يصل الجميع ويرى من قرأه. الرسائل تُحفظ على الجهاز وتصل مع المزامنة (تعمل بلا إنترنت وتُرسل حين يعود).
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { GROUP, MAX_BODY } from '../../domain/chat.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';

const two = (n) => String(n).padStart(2, '0');
function timeText(iso) {
  const d = new Date(iso);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return localDay(d) === localDay() ? hm : `${two(d.getDate())}/${two(d.getMonth() + 1)} ${hm}`;
}

/** مزامنة أسرع والشاشة مفتوحة (الرسائل تصل خلال ثوانٍ لا دقيقة ونصف). */
function fastSync() {
  const t = setInterval(() => { if (app.scheduler && !document.hidden) app.scheduler.now(); }, 8000);
  if (app.scheduler) app.scheduler.now();
  return () => clearInterval(t);
}

export function renderChat(el, params) {
  if (!app.chat.me()) { navigate('/', { replace: true }); return undefined; }
  return params.with ? renderThread(el, params.with) : renderLists(el, params.tab === 'ann' ? 'ann' : 'chat');
}

// ============ القائمتان: المحادثات والتعميمات ============
function renderLists(el, startTab) {
  let tab = startTab;
  const tabs = h('div', { class: 'seg' });
  const body = h('div');
  el.append(header('المحادثة والتعميمات', { back: true }), h('div', { class: 'page' }, tabs, body));

  async function load() {
    const u = await app.chat.unread();
    const seg = (key, label, n) => h('button', { class: `seg-btn ${tab === key ? 'on' : ''}`, type: 'button', onclick: () => { tab = key; history.replaceState(null, '', `#/chat${key === 'ann' ? '?tab=ann' : ''}`); load(); } },
      label, n ? h('span', { class: 'badge' }, String(n)) : null);
    fill(tabs, seg('chat', 'المحادثات', u.chats), seg('ann', 'التعميمات', u.announcements));
    if (tab === 'chat') await paintChats(); else await paintAnnouncements();
  }

  async function paintChats() {
    const threads = await app.chat.threads();
    const online = app.config.syncEnabled;
    fill(body,
      online ? null : h('p', { class: 'muted small' }, 'المزامنة غير مفعّلة في هذه النسخة: الرسائل تبقى على هذا الجهاز.'),
      h('div', { class: 'list' }, ...threads.map((t) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/chat?with=${encodeURIComponent(t.key)}`) },
        t.key === GROUP ? h('span', { class: 'row-ic' }, icon('users', 22)) : h('span', { class: 'avatar' }, t.name.trim().charAt(0)),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, t.name),
          h('span', { class: 'row-sub' }, t.last ? `${t.last.from_id === app.chat.me().id ? 'أنت' : (t.last.from_name || '')}: ${t.last.body.replace(/\s+/g, ' ').slice(0, 60)}` : (t.key === GROUP ? 'رسالة يراها كل من في المحل' : 'رسالة خاصة بينكما'))),
        t.unread ? h('span', { class: 'badge' }, String(t.unread)) : (t.last ? h('span', { class: 'row-end muted small' }, num(timeText(t.last.created_at))) : icon('chevron', 20, 'row-go'))))),
      threads.length === 1 && !app.staff ? h('p', { class: 'muted small' }, 'لمراسلة موظف بعينه: فعّل «الموظفون» من المزيد وأضف موظفيك، فيظهر كل واحد هنا باسمه.') : null,
    );
  }

  async function paintAnnouncements() {
    const list = await app.chat.announcements();
    const canWrite = app.chat.canAnnounce();
    const others = app.chat.people().length;
    fill(body,
      canWrite ? button('تعميم جديد', { block: true, size: 'lg', icon: 'megaphone', onclick: compose }) : null,
      list.length ? h('div', { class: 'section' }, ...list.map((a) => h('div', { class: `card announce ${a.readByMe ? '' : 'unread'}` },
        h('div', { class: 'announce-head' }, icon('megaphone', 20), h('strong', null, a.from_name || 'صاحب المحل'),
          a.readByMe ? null : h('span', { class: 'pill pill-bad' }, 'جديد'),
          h('span', { class: 'muted small announce-time' }, num(timeText(a.created_at)))),
        h('div', { class: 'announce-body' }, a.body),
        a.mine || canWrite ? h('div', { class: 'muted small' }, a.readers.length
          ? `قرأه ${a.readers.length}${others ? ` من ${others}` : ''}: ${a.readers.map((r) => r.name).join('، ')}`
          : 'لم يقرأه أحد بعد') : null)))
        : emptyState('megaphone', 'لا تعميمات بعد', canWrite ? 'اكتب تعميمًا يصل كل موظفيك على أجهزتهم (مواعيد الدوام، سعر جديد، تنبيه…)، وترى من قرأه.' : 'تعميمات صاحب المحل تظهر هنا.'),
    );
    // فتح القائمة = قراءة ما فيها: يُسجَّل لصاحب التعميم
    if (list.some((a) => !a.readByMe)) setTimeout(() => app.chat.ack(list).catch(() => {}), 1200);
  }

  function compose() {
    const text = h('textarea', { class: 'input chat-area', rows: 5, maxlength: MAX_BODY, placeholder: 'اكتب التعميم: يصل كل أهل المحل' });
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!text.value.trim()) { feedback.error(); text.focus(); return; }
        busy = true;
        try { await app.chat.announce(text.value); feedback.ok(); close(); toast('أُرسل التعميم', { kind: 'ok' }); load(); }
        catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر الإرسال', { kind: 'error' }); }
      },
    }, text, button('أرسل التعميم للجميع', { type: 'submit', block: true, size: 'lg', icon: 'send' })), { title: 'تعميم جديد' });
    setTimeout(() => text.focus(), 150);
  }

  load();
  const stop = fastSync();
  const off = bus.on('data', (e) => { if (e.tables.includes('messages')) load(); });
  const offChat = bus.on('chat', load);
  return () => { stop(); off(); offChat(); };
}

// ============ محادثة واحدة ============
function renderThread(el, key) {
  const me = app.chat.me();
  const person = key === GROUP ? null : app.chat.people().find((p) => p.id === key);
  const title = key === GROUP ? 'كل أهل المحل' : (person ? person.name : 'محادثة');
  const list = h('div', { class: 'chat-list' });
  const text = h('textarea', { class: 'input chat-input', rows: 1, maxlength: MAX_BODY, placeholder: 'اكتب رسالة…' });
  let count = -1;

  async function send() {
    const v = text.value;
    if (!v.trim()) { text.focus(); return; }
    text.value = '';
    try { await app.chat.send(key, v); feedback.tap(); }
    catch (err) { text.value = v; feedback.error(); toast(err.message || 'تعذّر الإرسال', { kind: 'error' }); }
    text.focus();
  }
  // Enter يرسل على الحاسوب؛ على الجوال زر الإرسال (Enter سطر جديد)
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) { e.preventDefault(); send(); } });

  el.append(
    header(title, { back: true, sub: key === GROUP ? 'يراها كل من في المحل' : 'رسائل خاصة بينكما' }),
    h('div', { class: 'page chat-page' }, list),
    h('form', { class: 'chat-bar', onsubmit: (e) => { e.preventDefault(); send(); } }, text,
      h('button', { class: 'chat-send', type: 'submit', 'aria-label': 'إرسال' }, icon('send', 24))),
  );

  async function load() {
    const msgs = await app.chat.thread(key);
    if (msgs.length !== count) {
      count = msgs.length;
      let lastDay = null;
      fill(list, msgs.length ? msgs.map((m) => {
        const mine = m.from_id === me.id;
        const day = localDay(new Date(m.created_at));
        const sep = day !== lastDay ? h('div', { class: 'chat-day' }, day === localDay() ? 'اليوم' : num(day)) : null;
        lastDay = day;
        return [sep, h('div', { class: `bubble ${mine ? 'mine' : ''}` },
          !mine && key === GROUP ? h('div', { class: 'bubble-from' }, m.from_name || '') : null,
          h('div', { class: 'bubble-body' }, m.body),
          h('div', { class: 'bubble-time' }, num(timeText(m.created_at))))];
      }) : emptyState('chat', 'ابدأ المحادثة', key === GROUP ? 'اكتب رسالة يراها كل من في المحل على أجهزتهم.' : `اكتب رسالة إلى ${title}.`));
      el.scrollTop = el.scrollHeight;
    }
    if (msgs.length) app.chat.markSeen(key, msgs[msgs.length - 1].created_at);
  }

  load();
  const stop = fastSync();
  const off = bus.on('data', (e) => { if (e.tables.includes('messages')) load(); });
  return () => { stop(); off(); };
}
