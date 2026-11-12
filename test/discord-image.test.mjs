import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordConnection } from '../server/discord.mjs';
import { downloadDiscordImages, DISCORD_IMAGE_LIMITS } from '../server/discord-images.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const DATA = `data:image/png;base64,${PNG.toString('base64')}`;
const BOT = { id: '100', username: 'bot', bot: true }, USER = { id: '101', username: 'human' };
const CDN = 'https://cdn.discordapp.com/attachments/200/300/photo.png?ex=abc&is=def&hm=signature';
const attachment = patch => ({ id: '300', url: CDN, filename: '../../unsafe.png', content_type: 'image/png', size: PNG.length, ...patch });
const image = (id = '1000', patch = {}) => ({ id, channel_id: '400', guild_id: '500', channel: { id: '400', guild_id: '500', name: 'Council', type: 0 }, author: USER, content: `<@${BOT.id}>`, mentions: [BOT], attachments: [attachment()], ...patch });
function store() {
  const data = new Map();
  return { data, get: async (key, fallback = null) => structuredClone(data.has(key) ? data.get(key) : fallback), set: async (key, value) => data.set(key, structuredClone(value)) };
}
function fixture({ settings = store(), history = store(), download, submit } = {}) {
  const calls = [], submissions = [], cancelled = [], edits = [];
  if (!settings.data.has('configuration')) settings.data.set('configuration', { enabled: true, agentId: 'agent' });
  const context = { settings, secrets: { get: async () => 'SECRET', has: async () => true, set: async () => {}, clear: async () => {} }, agents: {
    list: async () => [{ id: 'agent', enabled: true }, { id: 'other', enabled: true }], turns: {
      submit: async input => { submissions.push(structuredClone(input)); return submit ? submit(input) : { turn: { id: `turn-${submissions.length}` } }; },
      read: async id => ({ id, status: 'queued' }), cancel: async id => { cancelled.push(id); return { cancellationRequested: true }; },
    }, sessions: { create: async () => ({ agentId: 'agent', sessionId: 'fresh' }) },
  } };
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return download ? download(url, init) : new Response(PNG, { headers: { 'content-type': 'image/png' } }); };
  const service = createDiscordConnection({ context, fetchImpl, connectionId: 'images', discordHistorySettings: history });
  const api = { interactionCallback: async () => {}, interactionEdit: async (_event, text) => edits.push(text), sendMessage: async () => assert.fail('no outbound expected') };
  return { service, context, settings, history, calls, submissions, cancelled, edits, api, fetchImpl };
}
async function admit(f, message = image()) {
  await f.service.processMessage(message, BOT);
  const route = (await f.service.publicState()).pending[0]; assert.ok(route);
  await f.service.approve(route.id, { agentId: 'agent' }); return route;
}
const command = (id, name, patch = {}) => ({ id, application_id: BOT.id, channel_id: '400', guild_id: '500', token: 'PRIVATE', type: 2, member: { user: USER, permissions: '32' }, data: { name }, ...patch });
const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('condition did not settle'); };

test('inbound CDN download is anonymous, exact-host HTTPS, no redirects; magic and safe names reach Core', async () => {
  const calls = [];
  for (const host of ['cdn.discordapp.com', 'media.discordapp.net']) {
    const result = await downloadDiscordImages([attachment({ url: CDN.replace('cdn.discordapp.com', host) })], { fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(PNG, { headers: { 'content-type': 'image/png' } }); } });
    assert.deepEqual(result, [{ name: 'discord-image-1.png', type: 'image/png', size: PNG.length, encoding: 'data-url', content: DATA }]);
  }
  for (const { init } of calls) { assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.headers, undefined); assert.equal(init.body, undefined); }
  for (const [type, hex] of [['image/jpeg', 'ffd8ffe000'], ['image/gif', '474946383961'], ['image/webp', '524946461000000057454250']]) {
    const bytes = Buffer.from(hex, 'hex');
    const [item] = await downloadDiscordImages([attachment({ content_type: type, size: bytes.length })], { fetchImpl: async () => new Response(bytes, { headers: { 'content-type': type } }) });
    assert.equal(item.type, type); assert.equal(item.content, `data:${type};base64,${bytes.toString('base64')}`);
  }
});

test('CDN rejects host spoofing, credentials, redirects, path traversal and non-attachment paths before fetch', async () => {
  for (const url of [
    CDN.replace('https:', 'http:'), CDN.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.invalid'), CDN.replace('cdn.discordapp.com', 'evilcdn.discordapp.com'),
    CDN.replace('cdn.discordapp.com', 'cdn.discordapp.com@evil.invalid'), CDN.replace('cdn.discordapp.com', 'user:pass@cdn.discordapp.com'), CDN.replace('cdn.discordapp.com', 'cdn.discordapp.com:443'),
    'https://cdn.discordapp.com/avatars/200/300.png', 'https://cdn.discordapp.com/attachments/200/300/../300/photo.png', 'https://cdn.discordapp.com/attachments/200/300/%2e%2e',
    'https://cdn.discordapp.com/attachments/200/300/a%2fb.png', 'https://cdn.discordapp.com/attachments/200/300/a\\b.png', `${CDN}#fragment`,
  ]) {
    let calls = 0;
    await assert.rejects(downloadDiscordImages([attachment({ url })], { fetchImpl: async () => { calls++; } }), { message: 'discord_image_download_failed' });
    assert.equal(calls, 0, url);
  }
  for (const response of [new Response(null, { status: 302 }), { ok: true, status: 200, redirected: true }, { ok: true, status: 200, url: 'https://evil.invalid/' }]) {
    await assert.rejects(downloadDiscordImages([attachment()], { fetchImpl: async () => response }), /discord_image_download_failed/);
  }
});

test('metadata, MIME, byte signatures, count, declared aggregate and streamed aggregate are bounded', async () => {
  const limit = DISCORD_IMAGE_LIMITS.bytes;
  const cases = [
    { list: [attachment({ content_type: 'image/svg+xml' })], error: 'unsupported', calls: 0 },
    { list: [attachment({ size: limit + 1 })], error: 'too_large', calls: 0 },
    { list: [attachment({ size: limit }), attachment()], error: 'too_large', calls: 0 },
    { list: Array.from({ length: 5 }, () => attachment()), error: 'too_many', calls: 0 },
    { response: () => new Response(PNG, { headers: { 'content-length': String(limit + 1) } }), error: 'too_large' },
    { response: () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(limit)); c.enqueue(Buffer.alloc(1)); c.close(); } })), error: 'too_large' },
    { response: () => new Response('not PNG', { headers: { 'content-type': 'image/png' } }), error: 'unsupported' },
    { response: () => new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }), error: 'unsupported' },
    { list: [attachment({ content_type: 'image/jpeg' })], error: 'unsupported' },
    { response: () => { throw new Error(`SECRET ${CDN}`); }, error: 'download_failed' },
  ];
  for (const item of cases) {
    let calls = 0;
    await assert.rejects(downloadDiscordImages(item.list || [attachment()], { fetchImpl: async () => { calls++; return item.response ? item.response() : new Response(PNG); } }), { message: `discord_image_${item.error}` });
    assert.equal(calls, item.calls ?? 1);
  }
  let calls = 0;
  const bytes = Buffer.alloc(limit / 2 + 1); PNG.copy(bytes);
  await assert.rejects(downloadDiscordImages([attachment({ size: 0 }), attachment({ size: 0 })], { fetchImpl: async () => { calls++; return new Response(bytes); } }), /discord_image_too_large/);
  assert.equal(calls, 2);
});

test('image-only admission does not download or replay on approval; captions and bytes submit once with private input reclaimed', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await admit(f); assert.equal(f.calls.length, 0); assert.equal(f.submissions.length, 0);
  const message = image('1001'); await Promise.all([f.service.processMessage(message, BOT), f.service.processMessage(message, BOT)]);
  assert.equal(f.calls.length, 1); assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].displayMessage, '[Image attached]'); assert.equal(f.submissions[0].attachments[0].content, DATA);
  assert.equal(f.settings.data.get('deliveries')[0].submission, null);
  assert.equal(f.settings.data.get('deliveries')[0].sessionId, 'discord:images:400');
  assert.doesNotMatch(JSON.stringify(await f.service.publicState()), /submission|data:image|cdn\.discordapp|signature/);
  assert.doesNotMatch(JSON.stringify([...f.history.data]), /data:image|cdn\.discordapp|signature/);
  await f.service.processMessage(image('1002', { content: '<@!100> inspect this', attachments: [attachment(), attachment()] }), BOT);
  assert.equal(f.submissions[1].displayMessage, 'inspect this'); assert.equal(f.submissions[1].attachments.length, 2);
});

test('guild ambient images, bots, webhooks, disabled routes and connection never fetch; reply/DM/thread triggers preserved', async t => {
  const f = fixture(); t.after(() => f.service.close()); const route = await admit(f);
  for (const patch of [{ content: '', mentions: [] }, { author: { ...USER, bot: true } }, { webhook_id: '600' }]) await f.service.processMessage(image('1001', patch), BOT);
  assert.equal(f.calls.length, 0);
  await f.service.processMessage(image('1002', { content: '', mentions: [], message_reference: { message_id: '900', channel_id: '400' }, referenced_message: { id: '900', channel_id: '400', content: '', author: BOT } }), BOT);
  assert.equal(f.submissions.length, 1);
  await f.service.processMessage(image('1003', { content: '', mentions: [], message_reference: { message_id: '900', channel_id: '999' }, referenced_message: { id: '900', channel_id: '999', content: '', author: BOT } }), BOT);
  assert.equal(f.submissions.length, 1);
  await f.service.updateMapping(route.id, { enabled: false }); await f.service.processMessage(image('1004'), BOT); assert.equal(f.calls.length, 1);
  await f.service.configure({ enabled: false }); await f.service.processMessage(image('1005'), BOT); assert.equal(f.calls.length, 1);
  await f.service.configure({ enabled: true });
  const dm = image('2000', { guild_id: undefined, channel_id: '401', channel: { id: '401', type: 1 }, content: '', mentions: [] });
  await admit(f, dm); await f.service.processMessage({ ...dm, id: '2001' }, BOT); assert.equal(f.submissions.length, 2);
  const thread = image('3000', { channel_id: '402', channel: { id: '402', guild_id: '500', type: 11, parent_id: '400' } });
  await admit(f, thread); await f.service.processMessage({ ...thread, id: '3001' }, BOT);
  assert.equal(f.submissions.length, 3); assert.notEqual(f.submissions[2].sessionId, f.submissions[1].sessionId);
});

test('image failures never submit a partial caption or expose signed URLs or bytes', async t => {
  const f = fixture({ download: async () => new Response('not image', { headers: { 'content-type': 'image/png' } }) }); t.after(() => f.service.close());
  await admit(f); const message = image('1001', { content: '<@100> private caption' });
  await f.service.processMessage(message, BOT); await f.service.processMessage(message, BOT);
  assert.equal(f.submissions.length, 0); assert.equal(f.calls.length, 1);
  const state = await f.service.publicState(); assert.equal(state.deliveries[0].error, 'discord_image_unsupported');
  assert.doesNotMatch(JSON.stringify(state), /private caption|data:image|signature|submission/);
});

test('uncertain submission freezes exact bytes before submit and replays across restart without redownload', async t => {
  let attempts = 0;
  const f = fixture({ submit: async input => {
    const stored = f.settings.data.get('deliveries')[0]; assert.deepEqual(stored.submission, input); assert.equal(stored.submissionAttempted, true);
    if (!attempts++) throw new Error('response_lost'); return { turn: { id: 'receipt' } };
  } });
  let service = f.service; t.after(() => service.close()); await admit(f);
  const message = image('1002', { content: '<@100> frozen caption' }); await service.processMessage(message, BOT);
  const original = structuredClone(f.submissions[0]); assert.equal(f.settings.data.get('deliveries')[0].status, 'submitting');
  await service.close(); service = createDiscordConnection({ context: f.context, connectionId: 'images', fetchImpl: async () => assert.fail('must not redownload'), discordHistorySettings: f.history });
  await service.processMessage(image('1001', { content: 'late history', attachments: [], mentions: [] }), BOT);
  await service.reconcile(f.api); assert.deepEqual(f.submissions[1], original); assert.equal(f.settings.data.get('deliveries')[0].submission, null);
  await service.processMessage(message, BOT); assert.equal(f.submissions.length, 2);
});

test('old Core deterministic rejection is terminal, but later validation after an ambiguous response preserves frozen bytes', async t => {
  for (const ambiguous of [false, true]) {
    let attempts = 0;
    const f = fixture({ submit: async () => { if (ambiguous && !attempts++) throw new Error('response_lost'); throw new Error('mod_capability_input_invalid'); } });
    t.after(() => f.service.close()); await admit(f); const msg = image('1001');
    await f.service.processMessage(msg, BOT); await f.service.processMessage(msg, BOT);
    const item = f.settings.data.get('deliveries')[0];
    assert.equal(item.status, ambiguous ? 'submitting' : 'failed');
    if (ambiguous) assert.equal(item.submission.attachments[0].content, DATA);
    else { assert.equal(item.error, 'core_image_attachments_unavailable'); assert.equal(item.submission, null); }
    assert.equal(f.calls.length, 1);
  }
});

test('stop resolves frozen admission, cancels owned receipt after input reclamation, and never redownloads', async t => {
  let attempts = 0;
  const f = fixture({ submit: async () => { if (!attempts++) throw new Error('response_lost'); return { turn: { id: 'receipt' } }; } }); t.after(() => f.service.close());
  await admit(f); await f.service.processMessage(image('1001'), BOT);
  await f.service.processInteraction(command('2000', 'stop'), BOT, f.api);
  assert.deepEqual(f.cancelled, ['receipt']); assert.equal(f.calls.length, 1);
  const item = f.settings.data.get('deliveries')[0]; assert.equal(item.status, 'interrupted'); assert.equal(item.submission, null);
  assert.match(f.edits[0], /Cancellation requested for 1/);
  await f.service.processMessage(image('1001'), BOT); assert.equal(f.submissions.length, 2);
});

test('mapping deletion, reassignment, disable and new session clear frozen submissions and prevent resurrection', async t => {
  for (const action of ['delete', 'reassign', 'disable', 'new']) {
    const f = fixture({ submit: async () => { throw new Error('response_lost'); } }); t.after(() => f.service.close());
    const route = await admit(f); await f.service.processMessage(image('1001'), BOT);
    if (action === 'delete') await f.service.deleteMapping(route.id);
    if (action === 'reassign') await f.service.updateMapping(route.id, { enabled: true, agentId: 'other' });
    if (action === 'disable') await f.service.updateMapping(route.id, { enabled: false });
    if (action === 'new') await f.service.processInteraction(command('2000', 'new'), BOT, f.api);
    const item = f.settings.data.get('deliveries')[0]; assert.equal(item.status, 'interrupted', action); assert.equal(item.submission, null, action);
    if (action === 'disable') await f.service.updateMapping(route.id, { enabled: true });
    await f.service.processMessage(image('1001'), BOT); assert.equal(f.submissions.length, 1); assert.equal(f.calls.length, 1);
  }
});

test('mapping/connection/server cancellation aborts stalled inbound fetches before Core submit', { timeout: 5000 }, async t => {
  for (const action of ['delete', 'disable', 'connection', 'token', 'server', 'close']) {
    let entered = false, signal;
    const f = fixture({ download: async (_url, init) => { entered = true; signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('PRIVATE')), { once: true })); } });
    t.after(() => f.service.close());
    let route;
    if (action === 'server') {
      await f.service.processMessage(image(), BOT); await f.service.configureServer('500', { enabled: true });
      // Remove the pending admission and let the approved server generate an inherited route.
    } else route = await admit(f);
    const processing = f.service.processMessage(image('1001'), BOT); await until(() => entered);
    const cancellation = action === 'delete' ? f.service.deleteMapping(route.id) : action === 'disable' ? f.service.updateMapping(route.id, { enabled: false }) : action === 'connection' ? f.service.configure({ enabled: false }) : action === 'token' ? f.service.clearToken() : action === 'server' ? f.service.configureServer('500', { enabled: false }) : f.service.close();
    await processing; await cancellation; assert.equal(signal.aborted, true, action); assert.equal(f.submissions.length, 0, action);
  }
});

test('full frozen ledger rejects new image without eviction; aggregate data fits ledger at exact 20 MiB boundary', { timeout: 10000 }, async t => {
  const bytes = Buffer.alloc(DISCORD_IMAGE_LIMITS.bytes); PNG.copy(bytes);
  const f = fixture({ download: async () => new Response(bytes), submit: async () => { throw new Error('uncertain'); } }); t.after(() => f.service.close());
  await admit(f); await f.service.processMessage(image('1001', { attachments: [attachment({ size: bytes.length })] }), BOT);
  const item = f.settings.data.get('deliveries')[0]; assert.equal(item.submission.attachments[0].size, bytes.length);
  assert.ok(Buffer.byteLength(JSON.stringify(f.settings.data.get('deliveries'))) < 32_000_000);
  assert.ok(item.submission.attachments[0].content.length < 30_000_000);
  // A second frozen image cannot fit; the first remains byte-for-byte unchanged.
  await assert.rejects(f.service.processMessage(image('1002', { attachments: [attachment({ size: bytes.length })] }), BOT), /discord_backlog_full/);
  assert.deepEqual(f.settings.data.get('deliveries'), [item]); assert.equal(f.submissions.length, 1);
  const frozen = Array.from({ length: 200 }, (_, n) => ({ id: `in:old-${n}`, status: 'submitting', submission: { message: 'frozen' } }));
  f.settings.data.set('deliveries', frozen);
  await assert.rejects(f.service.processMessage(image('1003'), BOT), /discord_backlog_full/); assert.deepEqual(f.settings.data.get('deliveries'), frozen);
});

test('invalid mapping edits do not abort an authorized download; stream cancellation cannot hang the queue', { timeout: 3000 }, async t => {
  let entered = false, signal, finish;
  const f = fixture({ download: async (_url, init) => {
    entered = true; signal = init.signal;
    return new Response(new ReadableStream({ start(c) { finish = () => { c.enqueue(PNG); c.close(); }; } }), { headers: { 'content-type': 'image/png' } });
  } }); t.after(() => f.service.close()); const route = await admit(f);
  const processing = f.service.processMessage(image('1001'), BOT); await until(() => entered);
  await assert.rejects(f.service.updateMapping(route.id, { enabled: 'no' }), /mapping_invalid/);
  await assert.rejects(f.service.updateMapping(route.id, { enabled: false, agentId: 'missing' }), /agent_not_found/);
  assert.equal(signal.aborted, false); finish(); await processing; assert.equal(f.submissions.length, 1);
  entered = false;
  const stalled = f.service.processMessage(image('1002'), BOT); await until(() => entered);
  const cancellation = f.service.deleteMapping(route.id); await stalled; await cancellation;
  assert.equal(signal.aborted, true); assert.equal(f.submissions.length, 1);
});

test('accepted in-flight receipt survives revocation without private bytes or a revived reply', async t => {
  let entered = false, finish;
  const f = fixture({ submit: async () => { entered = true; return new Promise(resolve => { finish = () => resolve({ turn: { id: 'accepted-in-flight' } }); }); } });
  t.after(() => { finish?.(); return f.service.close(); }); const route = await admit(f);
  const processing = f.service.processMessage(image('1001'), BOT); await until(() => entered);
  const revocation = f.service.deleteMapping(route.id); finish(); await processing; await revocation;
  const item = f.settings.data.get('deliveries')[0]; assert.equal(item.turnId, 'accepted-in-flight'); assert.equal(item.status, 'interrupted'); assert.equal(item.submission, null);
  await admit(f, image('1002')); await f.service.processMessage(image('1001'), BOT); assert.equal(f.submissions.length, 1);
});

test('temporary Core capability loss and legacy uncertain admissions preserve exact frozen input', async t => {
  const f = fixture({ submit: async () => { throw new Error('response_lost'); } }); t.after(() => f.service.close());
  await admit(f); await f.service.processMessage(image('1001'), BOT);
  const item = f.settings.data.get('deliveries')[0], frozen = structuredClone(item.submission), turns = f.context.agents.turns;
  delete item.submissionAttempted; // Older versions did not record whether submission was attempted.
  f.settings.data.set('deliveries', [item]);
  f.context.agents.turns = {}; await f.service.processMessage(image('1001'), BOT);
  assert.deepEqual(f.settings.data.get('deliveries')[0].submission, frozen);
  turns.submit = async input => { assert.deepEqual(input, frozen); throw new Error('mod_capability_input_invalid'); };
  f.context.agents.turns = turns; await f.service.reconcile(f.api);
  assert.equal(f.settings.data.get('deliveries')[0].status, 'submitting'); assert.deepEqual(f.settings.data.get('deliveries')[0].submission, frozen);
  assert.equal(f.calls.length, 1);
});
