// Shared visibility is context, not a wake-up or an A2A request. Only approved,
// enabled group/topic routes call this store; private chats never enter it.
const KEY = 'telegram-room-history';
const MAX_ROOMS = 100;
const MAX_MESSAGES = 50;
const MAX_TEXT = 4000;
const MAX_BYTES = 512_000;
const MAX_CONTEXT = 16_000;
function boundedText(text, limit = MAX_TEXT) {
  const value = text.slice(0, limit);
  const last = value.charCodeAt(value.length - 1);
  return (last >= 0xD800 && last <= 0xDBFF ? value.slice(0, -1) : value).toWellFormed();
}
const roomKey = (chatId, topicId) => JSON.stringify([String(chatId), topicId == null ? null : String(topicId)]);
export const isRoom = mapping => ['group', 'supergroup'].includes(mapping.chatType);
export function telegramSpeaker(sender = {}) {
  return {
    id: sender.id == null ? null : String(sender.id),
    name: String([sender.first_name, sender.last_name].filter(Boolean).join(' ') || sender.title || sender.username || sender.id || 'Telegram user').slice(0, 180),
    username: sender.username ? String(sender.username).slice(0, 180) : null,
    kind: sender.is_bot ? 'bot' : 'human',
  };
}
export function quotedReply(message) {
  const reply = message.reply_to_message;
  if (!reply) return null;
  const text = reply.text || reply.caption || message.quote?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  return { messageId: reply.message_id ?? null, speaker: telegramSpeaker(reply.sender_chat || reply.from), text: boundedText(text), ...(message.quote?.text ? { quotedExcerpt: boundedText(message.quote.text) } : {}) };
}
export function createRoomHistory({ settings, clock = Date.now }) {
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  async function rooms() { return await settings.get(KEY, []); }
  return Object.freeze({
    record: (mapping, message, speaker) => serialize(async () => {
      if (!isRoom(mapping) || !Number.isSafeInteger(message.message_id) || typeof message.text !== 'string' || !message.text.trim()) return;
      const key = roomKey(mapping.chatId, mapping.topicId);
      const list = await rooms();
      let room = list.find(item => item.key === key);
      if (!room) { room = { key, messages: [] }; list.push(room); }
      // Telegram message IDs, unlike update IDs, are shared by all bots in a room.
      if (room.messages.some(item => item.messageId === message.message_id)) return;
      room.messages.push({ messageId: message.message_id, at: message.date ? new Date(message.date * 1000).toISOString() : new Date(clock()).toISOString(), speaker, text: boundedText(message.text), ...(message.reply_to_message?.message_id != null ? { replyToMessageId: message.reply_to_message.message_id } : {}) });
      room.messages.sort((a, b) => a.messageId - b.messageId);
      room.messages = room.messages.slice(-MAX_MESSAGES);
      // Recency is ingestion order across rooms, Telegram order within a room.
      const ordered = [...list.filter(item => item !== room), room].slice(-MAX_ROOMS);
      while (Buffer.byteLength(JSON.stringify(ordered)) > MAX_BYTES) {
        if (ordered[0].messages.length > 1) ordered[0].messages.shift();
        else ordered.shift();
      }
      await settings.set(KEY, ordered);
    }),
    context: (mapping, messageId) => serialize(async () => {
      if (!isRoom(mapping)) return [];
      const room = (await rooms()).find(item => item.key === roomKey(mapping.chatId, mapping.topicId));
      const selected = [];
      let size = 2; // JSON array brackets.
      for (const message of [...(room?.messages || [])].reverse()) {
        // Never include the current message, or a later update from a faster bot.
        if (Number.isSafeInteger(messageId) && message.messageId >= messageId) continue;
        const bytes = Buffer.byteLength(JSON.stringify(message));
        if (size + bytes + (selected.length ? 1 : 0) > MAX_CONTEXT) break;
        size += bytes + (selected.length ? 1 : 0); selected.unshift(message);
      }
      return selected;
    }),
  });
}
