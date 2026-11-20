// المحادثة الداخلية والتعميمات (نقي): رسائل أهل المحل بينهم (للجميع أو لشخص)، وتعميمات صاحب المحل
// مع من قرأها. كل شيء سجل «إضافة فقط» في جدول messages:
//   kind = 'chat'     رسالة: to_id فارغ = للجميع، أو معرّف من تُرسل له
//   kind = 'announce' تعميم لكل أهل المحل
//   kind = 'read'     إشعار قراءة: ref_id = التعميم، from_id = من قرأه
// الهوية: 'owner' صاحب المحل، معرّف الموظف، أو 'dev:A' لجهاز في محل بلا موظفين.

export const GROUP = 'all';
export const MAX_BODY = 2000;

/** من يستعمل الجهاز الآن: { id, name, owner }. */
export function identity(staff, user, prefix = 'A') {
  if (staff && staff.enabled) {
    if (!user) return null;
    if (user.owner) return { id: 'owner', name: user.name || 'صاحب المحل', owner: true };
    return { id: user.id, name: user.name, owner: false };
  }
  // محل بلا موظفين: كل جهاز طرف في المحادثة، والكل صاحب محل (يكتب التعميمات)
  return { id: `dev:${prefix}`, name: `الجهاز ${prefix}`, owner: true };
}

/** أهل المحل الذين يمكن مراسلتهم على انفراد (غير المتكلم). بلا موظفين: لا أحد (محادثة الجميع فقط). */
export function people(staff, meId) {
  if (!staff || !staff.enabled) return [];
  const all = [{ id: 'owner', name: staff.owner && staff.owner.name ? staff.owner.name : 'صاحب المحل' },
    ...(staff.members || []).filter((m) => m.active !== false).map((m) => ({ id: m.id, name: m.name }))];
  return all.filter((p) => p.id !== meId);
}

/** نص الرسالة بعد التنظيف، أو '' إن كان فارغًا. */
export function cleanBody(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY);
}

const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);

/** هل يرى هذا الشخص الرسالة؟ (الخاصة لطرفيها فقط) */
export function visibleTo(msg, meId) {
  return !msg.to_id || msg.to_id === meId || msg.from_id === meId;
}

/** المحادثة التي تنتمي إليها الرسالة من جهة meId: GROUP أو معرّف الطرف الآخر. */
export function threadKey(msg, meId) {
  if (!msg.to_id) return GROUP;
  return msg.from_id === meId ? msg.to_id : msg.from_id;
}

/** رسائل محادثة واحدة مرتبة من الأقدم. */
export function threadMessages(messages, meId, key) {
  return messages.filter((m) => m.kind === 'chat' && visibleTo(m, meId) && threadKey(m, meId) === key).sort(byTime);
}

/**
 * قائمة المحادثات: «الجميع» أولًا ثم كل شخص، مع آخر رسالة وعدد غير المقروء.
 * seen: { [threadKey]: آخر وقت قُرئ } — لكل شخص على جهازه.
 */
export function buildThreads(messages, meId, seen = {}, persons = []) {
  const threads = new Map([[GROUP, { key: GROUP, name: 'كل أهل المحل', last: null, unread: 0 }]]);
  for (const p of persons) threads.set(p.id, { key: p.id, name: p.name, last: null, unread: 0 });
  for (const m of messages) {
    if (m.kind !== 'chat' || !visibleTo(m, meId)) continue;
    const key = threadKey(m, meId);
    if (!threads.has(key)) threads.set(key, { key, name: m.from_id === meId ? 'موظف سابق' : (m.from_name || 'موظف سابق'), last: null, unread: 0 });
    const t = threads.get(key);
    if (!t.last || byTime(t.last, m) < 0) t.last = m;
    if (m.from_id !== meId && (!seen[key] || m.created_at > seen[key])) t.unread += 1;
  }
  const list = [...threads.values()];
  const group = list.shift();
  list.sort((a, b) => (b.last ? b.last.created_at : '').localeCompare(a.last ? a.last.created_at : '') || a.name.localeCompare(b.name, 'ar'));
  return [group, ...list];
}

/** عدد الرسائل غير المقروءة في كل المحادثات. */
export function unreadChats(messages, meId, seen = {}) {
  let n = 0;
  for (const m of messages) {
    if (m.kind !== 'chat' || m.from_id === meId || !visibleTo(m, meId)) continue;
    const key = threadKey(m, meId);
    if (!seen[key] || m.created_at > seen[key]) n += 1;
  }
  return n;
}

/**
 * التعميمات، الأحدث أولًا: كل تعميم مع من قرأه [{ id, name, at }] وهل قرأته أنا وهل هو مني.
 */
export function announcements(messages, meId) {
  const reads = new Map();
  for (const m of messages) {
    if (m.kind !== 'read' || !m.ref_id) continue;
    if (!reads.has(m.ref_id)) reads.set(m.ref_id, new Map());
    const r = reads.get(m.ref_id);
    if (!r.has(m.from_id)) r.set(m.from_id, { id: m.from_id, name: m.from_name || '', at: m.created_at });
  }
  return messages.filter((m) => m.kind === 'announce').sort((a, b) => byTime(b, a)).map((a) => {
    const readers = [...(reads.get(a.id) || new Map()).values()].filter((r) => r.id !== a.from_id);
    const mine = a.from_id === meId;
    return { ...a, mine, readers, readByMe: mine || (reads.get(a.id) || new Map()).has(meId) };
  });
}

/** التعميمات التي لم أقرأها بعد (الأحدث أولًا). */
export function unreadAnnouncements(messages, meId) {
  return announcements(messages, meId).filter((a) => !a.readByMe);
}
