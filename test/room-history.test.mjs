import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHistory, quotedReply } from '../server/room-history.mjs';
function fixture() {
  const data = new Map();
  const settings = { get: async (key, fallback) => structuredClone(data.get(key) ?? fallback), set: async (key, value) => data.set(key, structuredClone(value)) };
  return { data, history: createRoomHistory({ settings, clock: () => 0 }) };
}
const room = (chatId = '-1', topicId = null) => ({ chatId, topicId, chatType: 'supergroup' });
const speaker = { id: '1', name: 'King', kind: 'human' };

test('parallel room writers deduplicate and retain Telegram order, excluding current and future messages', async () => {
  const { history, data } = fixture();
  await Promise.all([4, 2, 3, 2].map(id => history.record(room(), { message_id: id, text: `message-${id}` }, speaker)));
  assert.deepEqual(data.get('telegram-room-history')[0].messages.map(m => m.messageId), [2, 3, 4]);
  assert.deepEqual((await history.context(room(), 4)).map(m => m.messageId), [2, 3]);
  assert.deepEqual(await history.context(room('-2'), 10), []);
  assert.deepEqual(await history.context(room('-1', 9), 10), []);
});

test('history enforces per-room message count, text, room count, total byte and context byte bounds', async () => {
  const { history, data } = fixture();
  for (let id = 1; id <= 60; id++) await history.record(room(), { message_id: id, text: 'x'.repeat(5000) }, speaker);
  let stored = data.get('telegram-room-history');
  assert.equal(stored[0].messages.length, 50);
  assert.equal(stored[0].messages[0].messageId, 11);
  assert.equal(stored[0].messages[0].text.length, 4000);
  const context = await history.context(room(), 61);
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 16000);
  for (let id = 2; id <= 110; id++) await history.record(room(`-${id}`), { message_id: id, text: 'small' }, speaker);
  stored = data.get('telegram-room-history'); assert.equal(stored.length, 100);
  for (let id = 111; id <= 160; id++) for (let message = 1; message <= 5; message++) await history.record(room(`-${id}`), { message_id: message, text: '🧌'.repeat(4000) }, speaker);
  assert.ok(Buffer.byteLength(JSON.stringify(data.get('telegram-room-history'))) <= 512000);
  assert.ok(Buffer.byteLength(JSON.stringify(await history.context(room('-160'), 9))) <= 16000);
});


test('text and quoted excerpts never split Unicode surrogate pairs at bounds', async () => {
  const { history, data } = fixture();
  const text = 'a' + '🧌'.repeat(2000);
  await history.record(room(), { message_id: 1, text }, speaker);
  const stored = data.get('telegram-room-history')[0].messages[0].text;
  assert.equal(stored, 'a' + '🧌'.repeat(1999));
  assert.equal(stored.isWellFormed(), true);
  const reply = quotedReply({ reply_to_message: { text, from: { first_name: 'Hatchet' } }, quote: { text } });
  assert.equal(reply.text, stored); assert.equal(reply.quotedExcerpt, stored);
});
