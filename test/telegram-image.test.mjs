import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSwitchboardService, createTelegramApi, createTelegramConnection } from '../server/telegram.mjs';

// A complete 1x1 PNG, not mocked base64 or a provider URL.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const DATA = `data:image/png;base64,${PNG.toString('base64')}`;
const bots = [{ id: '1', username: 'hatchet_bot' }, { id: '2', username: 'smatchet_bot' }];
const routeId = (chatId, topicId = null) => createHash('sha256').update(`telegram:${chatId}:${topicId ?? 'root'}`).digest('hex').slice(0, 24);
const json = value => new Response(JSON.stringify({ ok: true, result: value }), { status: 200, headers: { 'content-type': 'application/json' } });
const image = (id, extra = {}) => ({ update_id: id, message: { message_id: id, chat: { id: -100, type: 'supergroup', title: 'Council' }, from: { id: 42, first_name: 'Human' }, photo: [{ file_id: 'small', width: 40, height: 40, file_size: 40 }, { file_id: 'best', width: 1200, height: 1200, file_size: PNG.length }], ...extra } });
const direct = (id, extra = {}) => image(id, { chat: { id: 42, type: 'private' }, ...extra });
const mention = (text, value, type = 'mention') => ({ type, offset: text.indexOf(value), length: value.length });

function fixture({ download, getFile, submit } = {}) {
  const settings = new Map(), secrets = new Map(), calls = [], submissions = [];
  const context = {
    settings: { get: async (key, fallback = null) => structuredClone(settings.has(key) ? settings.get(key) : fallback), set: async (key, value) => settings.set(key, structuredClone(value)), delete: async key => settings.delete(key) },
    secrets: { get: async key => secrets.get(key) ?? null, set: async (key, value) => secrets.set(key, value), has: async key => secrets.has(key), clear: async key => secrets.delete(key) },
    agents: { list: async () => [{ id: 'hatchet', enabled: true }, { id: 'smatchet', enabled: true }], turns: {
      submit: async input => { submissions.push(structuredClone(input)); return submit ? submit(input) : { turn: { id: `turn-${submissions.length}`, status: 'queued' } }; },
      read: async id => ({ id, status: 'queued' }),
    } },
    logger: { info() {}, error(...args) { calls.push({ log: args }); } },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/getMe')) {
      const peer = url.includes('/bottwo/');
      return json({ ...bots[Number(peer)], is_bot: true });
    }
    if (url.endsWith('/getFile')) return getFile ? getFile(url, init) : json({ file_path: 'photos/file_0.png', file_size: PNG.length });
    if (url.startsWith('https://api.telegram.org/file/')) return download ? download(url, init) : new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected ${url}`);
  };
  const service = createSwitchboardService({ context, fetchImpl });
  return { settings, secrets, calls, submissions, context, fetchImpl, service };
}
async function configure(f) {
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
  return (await f.service.createConnection({ name: 'peer', token: 'two', enabled: false, agentId: 'smatchet' })).connections[1].id;
}
async function admit(f, connection, bot, update = image(1)) {
  await f.service.processMessage(update, bot, connection);
  const state = (await f.service.publicState()).connections.find(item => item.id === connection);
  await f.service.approveConnection(connection, state.pending[0].id, {});
}
const fileCalls = f => f.calls.filter(call => call.url?.endsWith('/getFile'));
const downloads = f => f.calls.filter(call => call.url?.includes('/file/bot'));

test('image-only admission and selected photo carry actual PNG bytes, never fetch before approval', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
  const update = direct(10);
  await f.service.processMessage(update, bots[0]);
  assert.equal(fileCalls(f).length, 0); assert.equal(downloads(f).length, 0);
  assert.equal(f.submissions.length, 0);
  const pending = (await f.service.publicState()).pending[0];
  await f.service.approve(pending.id, {});
  assert.equal(fileCalls(f).length, 0, 'approval does not replay the admission request');
  await f.service.processMessage(direct(11), bots[0]);
  assert.deepEqual(JSON.parse(fileCalls(f)[0].init.body), { file_id: 'best' });
  assert.equal(downloads(f)[0].init.redirect, 'error');
  assert.equal(f.submissions[0].displayMessage, '[Image attached]');
  assert.match(f.submissions[0].message, /\[Image attached\]/);
  assert.deepEqual(f.submissions[0].attachments, [{ name: 'telegram-image.png', type: 'image/png', size: PNG.length, encoding: 'data-url', content: DATA }]);
  assert.doesNotMatch(JSON.stringify(f.submissions[0]), /api\.telegram\.org|botone/);
  await f.service.processMessage(direct(11), bots[0]);
  assert.equal(f.submissions.length, 1); assert.equal(downloads(f).length, 1);
});

test('caption entities and replies choose only approved managed bot(s); topic context and histories stay isolated', async t => {
  const f = fixture(); t.after(() => f.service.close()); const peer = await configure(f);
  for (const [id, bot] of [['default', bots[0]], [peer, bots[1]]]) await admit(f, id, bot);
  const viaBoth = async update => { await f.service.processMessage(update, bots[0], 'default'); await f.service.processMessage(update, bots[1], peer); };
  const text = '😀 @SMATCHET_BOT what is this?';
  await viaBoth(image(10, { caption: text, caption_entities: [mention(text, '@SMATCHET_BOT')], message_thread_id: 11 }));
  assert.deepEqual(f.submissions.map(item => item.agentId), ['smatchet']);
  assert.equal(f.submissions[0].displayMessage, '😀  what is this?');
  assert.match(f.submissions[0].sessionId, /:-100:11$/); assert.equal(fileCalls(f).length, 1);
  await viaBoth(image(11, { message_thread_id: 12, reply_to_message: { message_id: 9, from: { id: 1, is_bot: true }, caption: 'Earlier caption' } }));
  assert.deepEqual(f.submissions.map(item => item.agentId), ['smatchet', 'hatchet']);
  assert.match(f.submissions[1].message, /Earlier caption/); assert.doesNotMatch(f.submissions[1].message, /what is this/);
  const targeted = '@hatchet_bot';
  await viaBoth(image(12, { caption: targeted, caption_entities: [mention(targeted, targeted)], message_thread_id: 11, reply_to_message: { from: { id: 2, is_bot: true } } }));
  assert.equal(f.submissions[2].agentId, 'hatchet'); assert.equal(f.submissions[2].displayMessage, '[Image attached]');
  const hist = JSON.parse(f.submissions[2].message.split('\n')[1]).roomHistory;
  assert.equal(hist[0].text, text); assert.doesNotMatch(JSON.stringify(hist), /data:image|file_id/);
  await viaBoth(image(13, { caption: 'ordinary room image' }));
  assert.deepEqual(f.submissions.slice(-2).map(item => item.agentId), ['hatchet', 'smatchet']);
  assert.notEqual(f.submissions.at(-2).idempotencyKey, f.submissions.at(-1).idempotencyKey);
  assert.notEqual(f.submissions.at(-2).sessionId, f.submissions.at(-1).sessionId);
  const total = f.submissions.length, downloaded = downloads(f).length;
  await viaBoth(image(13, { caption: 'ordinary room image' }));
  assert.equal(f.submissions.length, total); assert.equal(downloads(f).length, downloaded);
  await viaBoth(image(14, { from: { id: 2, is_bot: true }, caption: 'bot image' }));
  assert.equal(f.submissions.length, total); assert.equal(downloads(f).length, downloaded);
});

test('text_mention and bot command caption entities target the correct peer', async t => {
  const f = fixture(); t.after(() => f.service.close()); const peer = await configure(f);
  await admit(f, 'default', bots[0]); await admit(f, peer, bots[1]);
  for (const [i, caption, entity] of [[20, 'Hatchet describe', { type: 'text_mention', offset: 0, length: 7, user: { id: 1 } }], [21, '/ask@smatchet_bot describe', mention('/ask@smatchet_bot describe', '/ask@smatchet_bot', 'bot_command')]]) {
    for (const [id, bot] of [['default', bots[0]], [peer, bots[1]]]) await f.service.processMessage(image(i, { caption, caption_entities: [entity] }), bot, id);
  }
  assert.deepEqual(f.submissions.map(item => item.agentId), ['hatchet', 'smatchet']);
  assert.equal(fileCalls(f).length, 2);
});

test('image-document byte signature, not name or HTTP header, determines MIME; photo falls back from oversized highest', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  await f.service.processMessage(direct(2, { photo: undefined, document: { file_id: 'doc', file_name: '../../unsafe.png', mime_type: 'image/png', file_size: PNG.length }, caption: 'a document' }), bots[0]);
  assert.equal(f.submissions[0].attachments[0].name, 'telegram-image.png');
  assert.equal(f.submissions[0].attachments[0].content, DATA);
  await f.service.processMessage(direct(3, { photo: [{ file_id: 'practical', width: 100, height: 100, file_size: PNG.length }, { file_id: 'huge', width: 1000, height: 1000, file_size: 20 * 1024 * 1024 + 1 }] }), bots[0]);
  assert.equal(JSON.parse(fileCalls(f).at(-1).init.body).file_id, 'practical');
});

test('size, MIME, failed requests and malicious paths produce redacted failed deliveries without submitting captions', async t => {
  const cases = [
    { name: 'unsupported metadata', update: direct(11, { photo: undefined, document: { file_id: 'doc', mime_type: 'image/svg+xml' }, caption: 'must not forward' }), error: 'telegram_image_unsupported', gets: 0 },
    { name: 'oversize metadata', update: direct(12, { photo: [{ file_id: 'x', file_size: 20 * 1024 * 1024 + 1 }] }), error: 'telegram_image_too_large', gets: 0 },
    { name: 'oversize getFile', getFile: () => json({ file_path: 'photos/p.png', file_size: 20 * 1024 * 1024 + 1 }), error: 'telegram_image_too_large', gets: 1 },
    { name: 'oversize content-length', download: () => new Response(PNG, { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }), error: 'telegram_image_too_large', gets: 1 },
    { name: 'oversize stream', download: () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20 * 1024 * 1024)); c.enqueue(new Uint8Array(1)); c.close(); } })), error: 'telegram_image_too_large', gets: 1 },
    { name: 'bad bytes', download: () => new Response('this is not a png', { headers: { 'content-type': 'image/png' } }), error: 'telegram_image_unsupported', gets: 1 },
    { name: 'mismatched MIME', update: direct(13, { photo: undefined, document: { file_id: 'doc', mime_type: 'image/jpeg' } }), error: 'telegram_image_unsupported', gets: 1 },
    { name: 'failed fetch with token', download: url => { throw new Error(`fetch failed ${url}`); }, error: 'telegram_image_download_failed', gets: 1 },
    { name: 'HTTP redirect', download: () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }), error: 'telegram_image_download_failed', gets: 1 },
    ...['../secret', '/photos/file.png', 'https://evil.invalid/file.png', 'photos/%2e%2e/file.png', 'photos/../file.png', 'photos\\file.png', 'photos/file.png?token=one', 'photos//file.png'].map(path => ({ name: `unsafe ${path}`, getFile: () => json({ file_path: path }), error: 'telegram_image_download_failed', gets: 1 })),
  ];
  for (const [i, item] of cases.entries()) {
    const f = fixture(item);
    try {
      await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
      await f.service.processMessage(item.update || direct(200 + i, { photo: [{ file_id: 'only', width: 100, height: 100 }], caption: 'must not forward' }), bots[0]);
      const state = await f.service.publicState();
      assert.equal(state.deliveries[0].status, 'failed', item.name); assert.equal(state.deliveries[0].error, item.error, item.name);
      assert.equal(f.submissions.length, 0, item.name); assert.equal(fileCalls(f).length, item.gets, item.name);
      assert.doesNotMatch(JSON.stringify(state), /api\.telegram\.org|botone|data:image|must not forward/, item.name);
      assert.doesNotMatch(JSON.stringify([...f.settings]), /api\.telegram\.org|botone|data:image/, item.name);
      if (item.name.startsWith('unsafe')) assert.equal(downloads(f).length, 0, item.name);
    } finally { await f.service.close(); }
  }
});

test('uncertain Core submission freezes exact image, caption and topic history across replay and restart', async t => {
  let attempts = 0;
  const f = fixture({ submit: async () => { if (!attempts++) throw new Error('uncertain'); return { turn: { id: 'durable', status: 'queued' } }; } });
  let service = f.service; t.after(() => service.close());
  const peer = await configure(f); await admit(f, 'default', bots[0]); await admit(f, peer, bots[1]);
  const caption = '@hatchet_bot inspect';
  const update = image(30, { caption, caption_entities: [mention(caption, '@hatchet_bot')], message_thread_id: 11 });
  await assert.rejects(service.processMessage(update, bots[0]), /uncertain/);
  const stored = f.settings.get('deliveries').find(item => item.id === 'in:30');
  assert.equal(stored.submission.attachments[0].content, DATA);
  const serializedPublic = JSON.stringify(await service.publicState());
  assert.doesNotMatch(serializedPublic, /submission|data:image|iVBORw0KGgo/);
  // A late, earlier room message changes the available context before replay.
  const other = '@smatchet_bot late history';
  await service.processMessage(image(29, { caption: other, caption_entities: [mention(other, '@smatchet_bot')], message_thread_id: 11 }), bots[0]);
  assert.equal(f.settings.get('telegram-room-history')[0].messages.some(item => item.text === other), true);
  await service.close(); service = createSwitchboardService({ context: f.context, fetchImpl: f.fetchImpl });
  await service.processMessage(update, bots[0]);
  assert.deepEqual(f.submissions[0], f.submissions[1]);
  assert.equal(fileCalls(f).length, 1); assert.equal(downloads(f).length, 1);
  assert.equal(f.settings.get('deliveries').find(item => item.id === 'in:30').submission, null);
  await service.processMessage(update, bots[0]); assert.equal(f.submissions.length, 2);
});

test('mapping deletion interrupts frozen uncertain work and discards its private bytes', async t => {
  const f = fixture({ submit: async () => { throw new Error('uncertain'); } }); t.after(() => f.service.close());
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  const update = direct(5); await assert.rejects(f.service.processMessage(update, bots[0]), /uncertain/);
  const mapping = (await f.service.publicState()).mappings[0]; await f.service.deleteMapping(mapping.id);
  const delivery = f.settings.get('deliveries').find(item => item.id === 'in:5');
  assert.equal(delivery.status, 'interrupted'); assert.equal(delivery.submission, null);
  await f.service.processMessage(update, bots[0]); await f.service.approve(mapping.id, {}); await f.service.processMessage(update, bots[0]);
  assert.equal(f.submissions.length, 1); assert.equal(fileCalls(f).length, 1);
});

test('mapping deletion aborts in-flight download before new Core work', { timeout: 2000 }, async t => {
  let entered; const downloading = new Promise(resolve => { entered = resolve; });
  let aborted = false;
  const f = fixture({ download: async (_url, init) => { entered(); await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true })); } });
  f.settings.set('configuration', { enabled: true, agentId: 'hatchet' });
  f.settings.set('transport-state', { bot: bots[0], offset: 0 });
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', chatTitle: 'DM', agentId: 'hatchet', enabled: true }]);
  f.secrets.set('telegram-bot-token', 'one');
  let polled = false;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/getUpdates')) {
      if (!polled) { polled = true; return json([direct(50)]); }
      await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    return f.fetchImpl(url, init);
  };
  const connection = createTelegramConnection({ context: f.context, fetchImpl, idleDelayMs: 1 }); t.after(() => connection.close());
  connection.start(); await downloading;
  await connection.deleteMapping(routeId(42));
  assert.equal(aborted, true); assert.equal(f.submissions.length, 0);
  assert.equal((await connection.publicState()).mappings.length, 0);
});

test('Telegram API refuses unexpected host/path data and sanitizes errors without exposing response bodies', async () => {
  for (const payload of [{ file_path: 'https://evil.invalid/f' }, { file_path: 'photos/../f' }]) {
    let calls = 0;
    const api = createTelegramApi({ token: 'SECRET', fetchImpl: async () => { calls++; return json(payload); } });
    await assert.rejects(api.image({ file_id: 'x' }), { message: 'telegram_image_download_failed' }); assert.equal(calls, 1);
  }
  const api = createTelegramApi({ token: 'SECRET', fetchImpl: async url => { throw new Error(`sensitive ${url}`); } });
  await assert.rejects(api.image({ file_id: 'x' }), { message: 'telegram_image_download_failed' });
});

test("20 MiB exact boundary fits Core's data URL limit", { timeout: 10000 }, async () => {
  const limit = 20 * 1024 * 1024;
  const large = Buffer.alloc(limit); PNG.copy(large);
  const data = new Response(large, { headers: { 'content-length': String(limit) } });
  const api = createTelegramApi({ token: 'local-only', fetchImpl: async url => url.endsWith('/getFile') ? json({ file_path: 'photos/big.png', file_size: limit }) : data });
  const attachment = await api.image({ file_id: 'x' });
  assert.equal(attachment.size, limit);
  assert.equal(Buffer.from(attachment.content.split(',')[1], 'base64').length, limit);
  assert.ok(attachment.content.length < 30_000_000);
});

test('JPEG, GIF and WebP signatures are passed through with matching Core MIME', async () => {
  for (const [type, ext, hex] of [
    ['image/jpeg', 'jpg', 'ffd8ffe000104a464946'],
    ['image/gif', 'gif', '47494638396101000100'],
    ['image/webp', 'webp', '524946461000000057454250'],
  ]) {
    const bytes = Buffer.from(hex, 'hex');
    const api = createTelegramApi({ token: 'fixture', fetchImpl: async url => url.endsWith('/getFile') ? json({ file_path: `images/example.${ext}` }) : new Response(bytes) });
    const item = await api.image({ file_id: 'x', declaredType: type });
    assert.equal(item.type, type); assert.equal(item.name, `telegram-image.${ext}`);
    assert.equal(item.content, `data:${type};base64,${bytes.toString('base64')}`);
  }
});

test('protected uncertain submissions survive a full delivery ledger and old work may still be evicted', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.secrets.set('telegram-bot-token', 'one');
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  const frozen = Array.from({ length: 199 }, (_, i) => ({ id: `in:${1000 + i}`, direction: 'inbound', status: 'submitting', submission: { idempotencyKey: `frozen-${i}`, attachments: [{ content: DATA }] } }));
  f.settings.set('deliveries', [...frozen, { id: 'in:old', direction: 'inbound', status: 'processing', turnId: 'old' }]);
  await f.service.processMessage(direct(5000), bots[0]);
  let ledger = f.settings.get('deliveries');
  assert.equal(ledger.length, 200); assert.equal(ledger.some(item => item.id === 'in:old'), false);
  for (const entry of frozen) assert.deepEqual(ledger.find(item => item.id === entry.id), entry);
  // Fill the sole replaceable slot with another unresolved submission.
  ledger[0] = { id: 'in:new-frozen', status: 'submitting', submission: { attachments: [{ content: DATA }] } };
  f.settings.set('deliveries', ledger);
  await assert.rejects(f.service.processMessage(direct(5001), bots[0]), /telegram_backlog_full/);
  assert.equal(f.submissions.length, 1); assert.equal(f.settings.get('deliveries').length, 200);
  assert.doesNotMatch(JSON.stringify(await f.service.publicState()), /data:image|submission/);
});

test('Core failure details cannot leak provider URLs or image bytes in delivery state', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.secrets.set('telegram-bot-token', 'one');
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  await f.service.processMessage(direct(7), bots[0]);
  f.context.agents.turns.read = async () => ({ status: 'failed', error: `https://api.telegram.org/file/botone/path ${DATA}` });
  await f.service.reconcile({ sendMessage: async () => assert.fail('no response') });
  const state = await f.service.publicState();
  assert.equal(state.deliveries[0].error, 'agent_turn_failed');
  assert.doesNotMatch(JSON.stringify(state), /api\.telegram\.org|botone|data:image/);
});

test('disabled mapping and unsupported media captions never trigger a fetch or partial text turn', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  const route = (await f.service.publicState()).mappings[0];
  await f.service.updateMapping(route.id, { agentId: 'hatchet', enabled: false });
  await f.service.processMessage(direct(2, { caption: 'do not download' }), bots[0]);
  assert.equal(fileCalls(f).length, 0); assert.equal(f.submissions.length, 0);
  await f.service.updateMapping(route.id, { agentId: 'hatchet', enabled: true });
  await f.service.processMessage(direct(3, { photo: undefined, video: { file_id: 'unsupported' }, caption: 'do not omit the video' }), bots[0]);
  assert.equal(fileCalls(f).length, 0); assert.equal(f.submissions.length, 0);
});

test('connection disable aborts a stalled file download before Core submission', { timeout: 2000 }, async t => {
  let entered; const downloading = new Promise(resolve => { entered = resolve; }); let aborted = false;
  const f = fixture({ download: async (_url, init) => { entered(); await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true })); } });
  f.settings.set('configuration', { enabled: true, agentId: 'hatchet' }); f.settings.set('transport-state', { bot: bots[0], offset: 0 });
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]); f.secrets.set('telegram-bot-token', 'one');
  let polled = false;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/getUpdates')) {
      if (!polled) { polled = true; return json([direct(50)]); }
      await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    return f.fetchImpl(url, init);
  };
  const connection = createTelegramConnection({ context: f.context, fetchImpl, idleDelayMs: 1 }); t.after(() => connection.close());
  connection.start(); await downloading; await connection.configure({ enabled: false });
  assert.equal(aborted, true); assert.equal(f.submissions.length, 0); assert.equal((await connection.publicState()).enabled, false);
});

test('official URL uses a standard colon token and never follows redirects', async () => {
  const calls = [];
  const api = createTelegramApi({ token: '12345:abc', fetchImpl: async (url, init) => { calls.push({ url, init }); return url.endsWith('/getFile') ? json({ file_path: 'photos/p.png' }) : new Response(PNG); } });
  await api.image({ file_id: 'x' });
  assert.equal(calls[0].url, 'https://api.telegram.org/bot12345:abc/getFile');
  assert.equal(calls[1].url, 'https://api.telegram.org/file/bot12345:abc/photos/p.png');
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[1].init.redirect, 'error');
});

test('a Core-unavailable text delivery can be replayed after capability recovery', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  const turns = f.context.agents.turns; f.context.agents.turns = {};
  const update = { update_id: 90, message: { message_id: 90, chat: { id: 42, type: 'private' }, from: { id: 1 }, text: 'hello' } };
  await f.service.processMessage(update, bots[0]);
  assert.equal((await f.service.publicState()).deliveries[0].error, 'core_external_agent_turns_unavailable');
  f.context.agents.turns = turns; await f.service.processMessage(update, bots[0]);
  assert.equal(f.submissions.length, 1); assert.equal(f.submissions[0].displayMessage, 'hello');
});

test('old Core image validation failure advances polling to later text without redownload or duplicate turns', { timeout: 4000 }, async t => {
  const f = fixture({ submit: async input => {
    if (input.attachments) throw new Error('mod_capability_input_invalid');
    return { turn: { id: 'text-accepted', status: 'queued' } };
  } });
  f.settings.set('configuration', { enabled: true, agentId: 'hatchet' });
  f.settings.set('transport-state', { bot: bots[0], offset: 0 });
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', chatTitle: 'DM', agentId: 'hatchet', enabled: true }]);
  f.secrets.set('telegram-bot-token', 'one');
  const updates = [direct(50, { caption: 'private caption' }), { update_id: 51, message: { message_id: 51, chat: { id: 42, type: 'private' }, from: { id: 1 }, text: 'later text' } }];
  const offsets = []; let reachedOffset;
  const progressed = new Promise(resolve => { reachedOffset = resolve; });
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/getUpdates')) {
      const { offset } = JSON.parse(init.body); offsets.push(offset);
      if (offset >= 52) {
        reachedOffset();
        await new Promise((resolve, reject) => {
          if (init.signal.aborted) return reject(init.signal.reason);
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      }
      return json(updates.filter(update => update.update_id >= offset));
    }
    return f.fetchImpl(url, init);
  };
  const connection = createTelegramConnection({ context: f.context, fetchImpl, idleDelayMs: 1, retryDelayMs: 1 });
  t.after(() => connection.close()); connection.start();
  let timer;
  try {
    await Promise.race([progressed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('polling failed to advance')), 700); })]);
  } finally { clearTimeout(timer); }
  assert.deepEqual(offsets, [0, 52]);
  assert.equal(f.submissions.length, 2); assert.equal(f.submissions[1].displayMessage, 'later text');
  assert.equal(f.submissions[1].attachments, undefined);
  assert.equal(fileCalls(f).length, 1); assert.equal(downloads(f).length, 1);
  const state = await connection.publicState();
  assert.equal(state.coreAgentTurns.available, true);
  assert.equal(state.deliveries.find(item => item.id === 'in:50').status, 'failed');
  assert.equal(state.deliveries.find(item => item.id === 'in:50').error, 'core_image_attachments_unavailable');
  assert.equal(state.deliveries.find(item => item.id === 'in:51').turnId, 'text-accepted');
  assert.equal(f.settings.get('transport-state').offset, 52);
  assert.equal(f.settings.get('deliveries').find(item => item.id === 'in:50').submission, null);
  assert.doesNotMatch(JSON.stringify(state), /private caption|data:image|iVBORw0KGgo|submission/);
  await connection.processMessage(updates[0], bots[0]);
  assert.equal(f.submissions.length, 2); assert.equal(downloads(f).length, 1, 'known terminal failure never re-downloads');
});

test('only exact deterministic Core pre-admission errors become sanitized terminal failures', async t => {
  const cases = [
    ['mod_capability_input_invalid', true, 'core_image_attachments_unavailable'],
    ['mod_capability_input_invalid', false, 'core_turn_input_invalid'],
    ['image_attachment_too_large', true, 'core_image_attachment_too_large'],
    ['agent_not_found', true, 'core_agent_not_found'],
    ['agent_disabled', false, 'core_agent_disabled'],
  ];
  for (const [coreCode, hasImage, publicCode] of cases) await t.test(`${coreCode}, image=${hasImage}`, async t => {
    const f = fixture({ submit: async () => { throw Object.assign(new Error(coreCode), { details: { secret: `private ${DATA}` } }); } });
    t.after(() => f.service.close());
    f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', chatTitle: 'DM', agentId: 'hatchet', enabled: true }]);
    f.secrets.set('telegram-bot-token', 'one');
    const update = hasImage ? direct(60) : { update_id: 60, message: { message_id: 60, chat: { id: 42, type: 'private' }, from: { id: 1 }, text: 'hello' } };
    await f.service.processMessage(update, bots[0]);
    let entry = f.settings.get('deliveries')[0];
    assert.equal(entry.status, 'failed'); assert.equal(entry.error, publicCode); assert.equal(entry.submission, null);
    assert.doesNotMatch(JSON.stringify(await f.service.publicState()), /private|data:image|iVBORw0KGgo|submission/);
    await f.service.processMessage(update, bots[0]);
    entry = f.settings.get('deliveries')[0];
    assert.equal(entry.error, publicCode); assert.equal(f.submissions.length, 1);
    assert.equal(downloads(f).length, hasImage ? 1 : 0);
  });
});

test('ambiguous or conflicting Core outcomes and later validation errors retain exact frozen replay', async t => {
  for (const laterError of ['mod_external_turn_idempotency_conflict', 'mod_capability_input_invalid', 'image_attachment_too_large', 'agent_disabled', 'agent_not_found', 'mod_capability_input_invalid:extra']) await t.test(laterError, async t => {
    let attempt = 0, receipt, executions = 0;
    const f = fixture({ submit: async input => {
      attempt++;
      if (attempt === 1) { receipt = structuredClone(input); executions++; throw new Error('response_lost'); }
      assert.deepEqual(input, receipt);
      if (attempt === 2) throw new Error(laterError);
      return { turn: { id: 'already-accepted', status: 'queued' }, replayed: true };
    } });
    t.after(() => f.service.close());
    f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', chatTitle: 'DM', agentId: 'hatchet', enabled: true }]);
    f.secrets.set('telegram-bot-token', 'one');
    const update = direct(61, { caption: 'frozen' });
    await assert.rejects(f.service.processMessage(update, bots[0]), { message: 'response_lost' });
    await assert.rejects(f.service.processMessage(update, bots[0]), { message: laterError });
    const pending = f.settings.get('deliveries').find(item => item.id === 'in:61');
    assert.equal(pending.status, 'submitting'); assert.deepEqual(pending.submission, receipt);
    assert.equal(downloads(f).length, 1); assert.equal(executions, 1);
    await f.service.processMessage(update, bots[0]);
    assert.equal(f.settings.get('deliveries')[0].turnId, 'already-accepted');
    assert.equal(f.settings.get('deliveries')[0].submission, null); assert.equal(executions, 1);
  });
  for (const code of ['mod_external_turn_idempotency_conflict', 'mod_capability_input_invalid:extra', 'response_lost']) await t.test(`initial ${code}`, async t => {
    const f = fixture({ submit: async () => { throw new Error(code); } }); t.after(() => f.service.close());
    f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
    f.secrets.set('telegram-bot-token', 'one');
    await assert.rejects(f.service.processMessage(direct(62), bots[0]), { message: code });
    assert.equal(f.settings.get('deliveries')[0].status, 'submitting');
    assert.equal(f.settings.get('deliveries')[0].submission.attachments[0].content, DATA);
  });
});

test('uncertain image remains replayable across temporary Core capability loss', async t => {
  let attempt = 0;
  const f = fixture({ submit: async () => { if (!attempt++) throw new Error('response_lost'); return { turn: { id: 'accepted-before-loss', status: 'queued' }, replayed: true }; } });
  t.after(() => f.service.close());
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  f.secrets.set('telegram-bot-token', 'one');
  const update = direct(63); await assert.rejects(f.service.processMessage(update, bots[0]), /response_lost/);
  const frozen = structuredClone(f.settings.get('deliveries')[0].submission), turns = f.context.agents.turns;
  f.context.agents.turns = {};
  await assert.rejects(f.service.processMessage(update, bots[0]), /core_external_agent_turns_unavailable/);
  const pending = f.settings.get('deliveries')[0];
  assert.equal(pending.status, 'submitting'); assert.deepEqual(pending.submission, frozen);
  f.context.agents.turns = turns; await f.service.processMessage(update, bots[0]);
  assert.deepEqual(f.submissions[1], f.submissions[0]); assert.equal(f.settings.get('deliveries')[0].turnId, 'accepted-before-loss');
  assert.equal(f.settings.get('deliveries')[0].error, null); assert.equal(downloads(f).length, 1);
});

test('mapping disable, deletion and agent change clear frozen work even from legacy terminal statuses', async t => {
  for (const action of ['disable', 'delete', 'reassign', 'agent']) for (const legacyStatus of ['submitting', 'failed', 'interrupted', 'delivered']) await t.test(`${action}: ${legacyStatus}`, async t => {
    const f = fixture({ submit: async () => { throw new Error('response_lost'); } }); t.after(() => f.service.close());
    await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
    const update = direct(64); await assert.rejects(f.service.processMessage(update, bots[0]), /response_lost/);
    const turns = f.context.agents.turns; f.context.agents.turns = {};
    await assert.rejects(f.service.processMessage(update, bots[0]), /core_external_agent_turns_unavailable/);
    assert.equal(f.settings.get('deliveries')[0].status, 'submitting');
    // Upgrade scenario: older code could have persisted failed together with submission.
    const ledger = f.settings.get('deliveries'); ledger[0].status = legacyStatus; f.settings.set('deliveries', ledger);
    const mapping = (await f.service.publicState()).mappings[0];
    if (action === 'disable') await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: false });
    if (action === 'delete') await f.service.deleteMapping(mapping.id);
    if (action === 'reassign') await f.service.updateMapping(mapping.id, { agentId: 'smatchet', enabled: true });
    if (action === 'agent') await f.service.configure({ enabled: false, agentId: 'smatchet' });
    const interrupted = f.settings.get('deliveries').find(item => item.id === 'in:64');
    assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.submission, null);
    assert.equal(interrupted.error, action === 'delete' ? 'mapping_deleted' : action === 'agent' ? 'agent_changed' : 'mapping_changed');
    f.context.agents.turns = turns;
    if (action === 'disable') await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: true });
    if (action === 'delete') { await f.service.processMessage(update, bots[0]); await f.service.approve(mapping.id, {}); }
    if (action === 'reassign') await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: true });
    if (action === 'agent') await f.service.configure({ enabled: false, agentId: 'hatchet' });
    await f.service.processMessage(update, bots[0]);
    assert.equal(f.submissions.length, 1); assert.equal(downloads(f).length, 1);
  });
});

test('mapping changes retain accepted receipt ownership and do not revive it after re-enable', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  const update = direct(65); await f.service.processMessage(update, bots[0]);
  const mapping = (await f.service.publicState()).mappings[0];
  assert.equal(f.settings.get('deliveries')[0].turnId, 'turn-1');
  await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: false });
  const interrupted = f.settings.get('deliveries')[0];
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.turnId, 'turn-1');
  await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: true });
  await f.service.processMessage(update, bots[0]);
  await f.service.reconcile({ sendMessage: async () => assert.fail('interrupted accepted receipt cannot be delivered') });
  assert.equal(f.submissions.length, 1); assert.equal(downloads(f).length, 1);
});

test('root mapping changes leave separately overridden topic submissions and receipts intact', async t => {
  for (const action of ['disable', 'delete', 'agent']) await t.test(action, async t => {
    const f = fixture(); t.after(() => f.service.close());
    await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
    const root = { id: routeId(-100), chatId: '-100', topicId: null, chatType: 'supergroup', chatTitle: 'Council', agentId: 'hatchet', inheritedAgent: true, enabled: true };
    const override = { ...root, id: routeId(-100, 22), topicId: 22, agentId: 'smatchet', inheritedAgent: false };
    f.settings.set('mappings', [root, override]);
    const base = { direction: 'inbound', chatId: '-100', status: 'failed', submission: { attachments: [{ content: DATA }] } };
    const inherited = { ...base, id: 'in:1', topicId: 11, agentId: 'hatchet' };
    const explicit = { ...base, id: 'in:2', topicId: 22, agentId: 'smatchet' };
    const acceptedOverride = { ...base, id: 'in:3', topicId: 22, status: 'processing', submission: null, turnId: 'owned-by-explicit-route' };
    f.settings.set('deliveries', [inherited, explicit, acceptedOverride]);
    if (action === 'disable') await f.service.updateMapping(root.id, { agentId: 'hatchet', enabled: false });
    if (action === 'delete') await f.service.deleteMapping(root.id);
    if (action === 'agent') await f.service.configure({ enabled: false, agentId: 'smatchet' });
    const ledger = f.settings.get('deliveries');
    assert.equal(ledger[0].status, 'interrupted'); assert.equal(ledger[0].submission, null);
    assert.deepEqual(ledger[1], explicit); assert.deepEqual(ledger[2], acceptedOverride);
  });
});

test('temporarily missing Core keeps an uncertain update at its poll offset until the same receipt returns', { timeout: 4000 }, async t => {
  let attempt = 0, lostResponse;
  const lost = new Promise(resolve => { lostResponse = resolve; });
  const f = fixture({ submit: async () => {
    if (!attempt++) { f.context.agents.turns = {}; lostResponse(); throw new Error('response_lost'); }
    return { turn: { id: 'existing-receipt', status: 'queued' }, replayed: true };
  } });
  f.settings.set('configuration', { enabled: true, agentId: 'hatchet' });
  f.settings.set('transport-state', { bot: bots[0], offset: 0 });
  f.settings.set('mappings', [{ id: routeId(42), chatId: '42', topicId: null, chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  f.secrets.set('telegram-bot-token', 'one');
  const turns = f.context.agents.turns, update = direct(70), offsets = [];
  let unavailableRetry, resumed;
  const retried = new Promise(resolve => { unavailableRetry = resolve; });
  const advanced = new Promise(resolve => { resumed = resolve; });
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/getUpdates')) {
      const { offset } = JSON.parse(init.body); offsets.push(offset);
      if (offset === 0 && offsets.length > 1) unavailableRetry();
      if (offset >= 71) {
        resumed();
        await new Promise((resolve, reject) => {
          if (init.signal.aborted) return reject(init.signal.reason);
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      }
      return json(offset <= 70 ? [update] : []);
    }
    return f.fetchImpl(url, init);
  };
  const connection = createTelegramConnection({ context: f.context, fetchImpl, idleDelayMs: 1, retryDelayMs: 10 });
  t.after(() => connection.close()); connection.start();
  await lost; await retried;
  // The second getUpdates returned the same update, but submission is withheld.
  const retryDeadline = Date.now() + 1000;
  while ((await connection.publicState()).transport.error !== 'core_external_agent_turns_unavailable') {
    if (Date.now() > retryDeadline) throw new Error('unavailable retry not observed');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(f.settings.get('transport-state').offset, 0);
  assert.equal(f.settings.get('deliveries')[0].status, 'submitting');
  assert.equal(f.settings.get('deliveries')[0].submission.attachments[0].content, DATA);
  f.context.agents.turns = turns;
  await advanced;
  assert.equal(f.settings.get('transport-state').offset, 71);
  assert.equal(f.settings.get('deliveries')[0].turnId, 'existing-receipt');
  assert.equal(f.settings.get('deliveries')[0].submission, null);
  assert.deepEqual(f.submissions[1], f.submissions[0]); assert.equal(downloads(f).length, 1);
  assert.equal(offsets.at(-1), 71); assert.ok(offsets.slice(0, -1).every(offset => offset === 0));
});

test('revoking a mapping while submit is pending retains an accepted receipt and interrupts its reply', async t => {
  let entered, finish;
  const submitting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ submit: async () => { entered(); await gate; return { turn: { id: 'accepted-in-flight', status: 'queued' } }; } });
  t.after(() => { finish(); return f.service.close(); });
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  const update = direct(71); const mapping = (await f.service.publicState()).mappings[0];
  const request = f.service.processMessage(update, bots[0]); await submitting;
  const revocation = f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: false });
  finish(); await request; await revocation;
  const interrupted = f.settings.get('deliveries')[0];
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.turnId, 'accepted-in-flight');
  assert.equal(interrupted.submission, null); assert.equal(interrupted.error, 'mapping_changed');
  await f.service.updateMapping(mapping.id, { agentId: 'hatchet', enabled: true });
  await f.service.processMessage(update, bots[0]);
  await f.service.reconcile({ sendMessage: async () => assert.fail('receipt remains interrupted') });
  assert.equal(f.submissions.length, 1); assert.equal(downloads(f).length, 1);
});

test('revoking a mapping during uncertain in-flight submission prevents old bytes from replaying', async t => {
  let entered, finish;
  const submitting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ submit: async () => { entered(); await gate; throw new Error('response_lost'); } });
  t.after(() => { finish(); return f.service.close(); });
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' }); await admit(f, 'default', bots[0], direct(1));
  const update = direct(72); const mapping = (await f.service.publicState()).mappings[0];
  const request = f.service.processMessage(update, bots[0]); await submitting;
  const revocation = f.service.deleteMapping(mapping.id);
  finish(); await assert.rejects(request, /response_lost/); await revocation;
  const interrupted = f.settings.get('deliveries')[0];
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.submission, null);
  assert.equal(interrupted.error, 'mapping_deleted');
  await f.service.processMessage(update, bots[0]); await f.service.approve(mapping.id, {});
  await f.service.processMessage(update, bots[0]);
  assert.equal(f.submissions.length, 1); assert.equal(downloads(f).length, 1);
});
