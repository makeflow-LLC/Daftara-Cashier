// خدمة المحادثة الداخلية والتعميمات: من أنا، الإرسال، القراءة، وعدد غير المقروء. المنطق في domain/chat.js.
// «قرأتُ حتى» لكل شخص محفوظ على الجهاز (meta chat:seen:<id>)؛ وقراءة التعميم تُرسل للجميع (kind = read).
import { identity, people, cleanBody, buildThreads, threadMessages, unreadChats, announcements, unreadAnnouncements, GROUP } from '../domain/chat.js';

export function createChat(app, { toast = () => {} } = {}) {
  const seenKey = (id) => `chat:seen:${id}`;
  const chat = {
    GROUP,
    me: () => identity(app.shop?.settings?.staff, app.user, app.ctx.prefix || 'A'),
    people: () => { const me = chat.me(); return me ? people(app.shop?.settings?.staff, me.id) : []; },
    /** يكتب التعميمات: صاحب المحل، ومن له صلاحية الإعدادات (المدير). */
    canAnnounce: () => { const me = chat.me(); return !!me && (me.owner || app.can('settings')); },
    async all() { return app.db.messages.toArray(); },
    async seen() { const me = chat.me(); return me ? (await app.meta.get(seenKey(me.id), {})) : {}; },

    async threads() {
      const me = chat.me();
      if (!me) return [];
      return buildThreads(await chat.all(), me.id, await chat.seen(), chat.people());
    },
    async thread(key) {
      const me = chat.me();
      return me ? threadMessages(await chat.all(), me.id, key) : [];
    },
    /** يرسل رسالة: to = GROUP للجميع أو معرّف شخص. */
    async send(to, text) {
      const me = chat.me();
      const body = cleanBody(text);
      if (!me || !body) return null;
      const row = await app.store.append('messages', { kind: 'chat', from_id: me.id, from_name: me.name, to_id: to === GROUP ? null : to, body });
      await chat.markSeen(to === GROUP ? GROUP : to, row.created_at);
      if (app.scheduler) app.scheduler.now(); // الرسالة تصل الآن لا بعد ثوانٍ
      return row;
    },
    async markSeen(key, at = null) {
      const me = chat.me();
      if (!me) return;
      const seen = { ...(await chat.seen()) };
      const t = at || new Date().toISOString();
      if (seen[key] && seen[key] >= t) return;
      seen[key] = t;
      await app.meta.set(seenKey(me.id), seen);
      app.bus.emit('chat');
    },

    async announcements() {
      const me = chat.me();
      return me ? announcements(await chat.all(), me.id) : [];
    },
    async announce(text) {
      const me = chat.me();
      const body = cleanBody(text);
      if (!me || !body) return null;
      if (!chat.canAnnounce()) throw new Error('التعميمات يكتبها صاحب المحل');
      const row = await app.store.append('messages', { kind: 'announce', from_id: me.id, from_name: me.name, body });
      if (app.scheduler) app.scheduler.now();
      return row;
    },
    /** يسجّل أني قرأت هذه التعميمات (مرة لكل تعميم)، فيرى صاحبها من قرأ. */
    async ack(list) {
      const me = chat.me();
      const todo = (list || []).filter((a) => !a.readByMe && !a.mine);
      if (!me || !todo.length) return;
      await app.store.write(async (w) => {
        for (const a of todo) await w.append('messages', { kind: 'read', from_id: me.id, from_name: me.name, ref_id: a.id, body: '' });
      });
    },
    /** { chats, announcements, latest } — لشارة «المزيد» ولافتة الرئيسية. */
    async unread() {
      const me = chat.me();
      if (!me) return { chats: 0, announcements: 0, latest: null };
      const all = await chat.all();
      const ann = unreadAnnouncements(all, me.id);
      return { chats: unreadChats(all, me.id, await chat.seen()), announcements: ann.length, latest: ann[0] || null };
    },

    start() {
      // رسالة أو تعميم وصل من جهاز آخر والمستخدم في شاشة أخرى: تنبيه قصير
      app.bus.on('data', async (e) => {
        if (e.source !== 'remote' || !e.tables.includes('messages')) return;
        app.bus.emit('chat');
        if (String(location.hash).startsWith('#/chat')) return;
        const u = await chat.unread();
        if (u.latest) toast(`تعميم جديد من ${u.latest.from_name || 'صاحب المحل'}`, { kind: 'info', ms: 5000 });
        else if (u.chats) toast(u.chats === 1 ? 'رسالة جديدة في المحادثة' : `${u.chats} رسائل جديدة في المحادثة`, { kind: 'info', ms: 4000 });
      });
    },
  };
  return chat;
}
