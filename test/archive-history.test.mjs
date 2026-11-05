import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createArchive, ARCHIVE_KEY, ARCHIVE_LIMIT } from '../server/archive.mjs';
import { createSwitchboardService } from '../server/connections.mjs';
import { activate } from '../server/index.mjs';

const AT = '2026-11-04T12:00:00.000Z';
const connection = { id: 'default', name: 'Original bot', transport: 'telegram' };
const event = (id, extra = {}) => ({ id, direction: 'inbound', status: 'delivered', at: AT, createdAt: AT, updatedAt: AT, chatId: '42', agentId: 'agent', ...extra });
function fixture(seed = {}) {
  const data = new Map(Object.entries(seed)); const secrets = new Map(); const routes = new Map(); const logs = [];
  let failArchive = false;
  const settings = {
    get: async (key, fallback = null) => structuredClone(data.has(key) ? data.get(key) : fallback),
    set: async (key, value) => { if (failArchive && key === ARCHIVE_KEY) throw new Error('disk_full'); data.set(key, structuredClone(value)); return value; },
    delete: async key => data.delete(key),
  };
  const context = { settings,
    secrets: { get: async key => secrets.get(key) ?? null, set: async (key, value) => secrets.set(key, value), clear: async key => secrets.delete(key), has: async key => secrets.has(key) },
    agents: { list: async () => [{ id: 'agent', enabled: true, name: 'Agent' }], turns: { submit: async () => ({ turn: { id: 'turn', status: 'succeeded' } }), read: async () => ({ id: 'turn', status: 'succeeded', result: { answerText: 'private answer' } }) } },
    logger: { info() {}, error: (...args) => logs.push(args) },
    api: Object.fromEntries(['get', 'put', 'post', 'delete'].map(method => [method, (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler)])),
  };
  return { data, settings, context, secrets, routes, logs, failArchive: value => { failArchive = value; } };
}
const options = f => ({ context: f.context, clock: () => Date.parse(AT), fetchImpl: async () => { throw new Error('network_forbidden'); } });

test('legacy migration is additive, idempotent, terminal only, and strips replay/body/secret data', async () => {
  const retained = [event('in:1', { submission: null, token: 'secret-token', answerText: 'private-answer', message: 'private-message', attachments: ['private-image'], error: 'https://secret.example/token' }), event('in:2', { status: 'processing' }), event('in:3', { status: 'failed', submission: { message: 'private-frozen-input' } }), event('out:4', { direction: 'outbound', status: 'unknown' }), event('in:5', { status: 'submitting', submission: { message: 'private-frozen-input' } })];
  const f = fixture({ deliveries: retained }); const service = createSwitchboardService(options(f));
  const first = await service.archiveState(); const second = await service.archiveState();
  assert.equal(first.records.length, 3); assert.deepEqual(second, first);
  assert.deepEqual(f.data.get('deliveries'), retained, 'migration must never modify replay records');
  assert.equal(first.coverage.kind, 'retained'); assert.equal(first.coverage.legacyImported, true);
  assert.doesNotMatch(JSON.stringify(first), /secret-token|private-answer|private-message|private-image|private-frozen-input|secret\.example/);
  assert.equal(first.records.find(row => row.recordId === 'in:1').error, 'delivery_failed');
  await service.close();
});

test('history persists through restart and bot deletion without exposing current configuration', async () => {
  const f = fixture({ connections: [connection], deliveries: [event('in:1')] });
  let service = createSwitchboardService(options(f));
  const before = await service.archiveState(); await service.removeConnection('default');
  assert.equal(f.data.has('deliveries'), false); assert.deepEqual(f.data.get('connections'), []);
  assert.deepEqual((await service.archiveState()).records, before.records); await service.close();
  service = createSwitchboardService(options(f));
  assert.deepEqual((await service.archiveState()).records, before.records);
  assert.equal(Object.hasOwn(await service.archiveState(), 'connections'), false); await service.close();
});

test('failed archival deletion leaves retained queue and registry intact for recovery', async () => {
  const f = fixture({ connections: [connection], deliveries: [event('in:1')] }); const service = createSwitchboardService(options(f));
  f.failArchive(true); await assert.rejects(service.removeConnection('default'), /disk_full/);
  assert.equal(f.data.get('connections').length, 1); assert.equal(f.data.get('deliveries').length, 1);
  f.failArchive(false); await service.removeConnection('default');
  assert.equal((await service.archiveState()).records.length, 1); await service.close();
});

test('concurrent transports and archive instances preserve distinct identities and monotonic outcomes', async () => {
  const f = fixture(); const a = createArchive({ settings: f.settings }); const b = createArchive({ settings: f.settings });
  await Promise.all(Array.from({ length: 50 }, (_, index) => (index % 2 ? a : b).capture([{ connection: { id: `bot-${index}`, name: `Bot ${index}`, transport: index % 2 ? 'discord' : 'telegram' }, deliveries: [event('in:1')] }])));
  assert.equal((await a.snapshot([])).records.length, 50);
  await a.capture([{ connection, deliveries: [event('in:2', { updatedAt: '2026-11-05T00:00:00.000Z' })] }]);
  await b.capture([{ connection: { ...connection, name: 'Renamed bot' }, deliveries: [event('in:2', { status: 'succeeded' })] }]);
  const found = (await a.snapshot([])).records.find(row => row.connectionId === 'default');
  assert.equal(found.status, 'delivered'); assert.equal(found.connectionName, 'Original bot');
});

test('retention is bounded, newest first, explicit and stable across reimport/restart', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  const deliveries = Array.from({ length: ARCHIVE_LIMIT + 20 }, (_, index) => event(`in:${index}`, { at: new Date(Date.parse(AT) + index * 1000).toISOString() }));
  const first = await archive.snapshot([{ connection, deliveries }]);
  assert.equal(first.records.length, ARCHIVE_LIMIT); assert.equal(first.coverage.truncated, true);
  assert.equal(first.records[0].recordId, `in:${ARCHIVE_LIMIT + 19}`);
  const second = await createArchive({ settings: f.settings }).snapshot([{ connection, deliveries }]);
  assert.deepEqual(second, first);
});

test('retention enforces byte budget for large metadata without storing bodies', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings }); const huge = '🙂'.repeat(256);
  const deliveries = Array.from({ length: ARCHIVE_LIMIT }, (_, index) => event(`in:${index}`, Object.fromEntries(['chatId', 'chatTitle', 'chatType', 'channelId', 'guildId', 'topicId', 'agentId', 'sessionId', 'turnId'].map(key => [key, huge]))));
  const result = await archive.snapshot([{ connection, deliveries }]);
  assert.ok(result.records.length < ARCHIVE_LIMIT); assert.equal(result.coverage.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.records)) <= result.coverage.byteLimit);
});

test('unrecognized history is never silently overwritten', async () => {
  const sentinel = { version: 2, records: [], future: 'preserve' }; const f = fixture({ [ARCHIVE_KEY]: sentinel });
  await assert.rejects(createArchive({ settings: f.settings }).snapshot([{ connection, deliveries: [event('in:1')] }]), /archive_history_invalid/);
  assert.deepEqual(f.data.get(ARCHIVE_KEY), sentinel);
});

test('history endpoint requires operator authentication and never caches responses', async () => {
  const f = fixture({ connections: [connection], deliveries: [event('in:1')] }); const cleanup = await activate(f.context, options(f));
  try {
    const handler = f.routes.get('GET /archive'); assert.equal(typeof handler, 'function');
    const denied = await handler({ auth: { enabled: true, authenticated: false } });
    assert.equal(denied.status, 401); assert.equal(denied.headers['cache-control'], 'no-store');
    assert.equal(denied.body.records, undefined);
    const allowed = await handler({ auth: { enabled: true, authenticated: true } });
    assert.equal(allowed.status, 200); assert.equal(allowed.body.records.length, 1);
    assert.equal(allowed.headers['cache-control'], 'no-store');
  } finally { await cleanup(); }
});

test('archive persistence failure does not duplicate a confirmed transport send', async () => {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const f = fixture({ connections: [connection], mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }], deliveries: [event('in:1', { status: 'processing', turnId: 'turn' })] });
  const service = createSwitchboardService(options(f)); let sends = 0; const api = { sendMessage: async () => { sends++; return { message_id: 1 }; } };
  f.failArchive(true); await service.reconcile(api); await service.reconcile(api);
  assert.equal(sends, 1); assert.equal(f.data.get('deliveries').find(row => row.direction === 'outbound').status, 'delivered');
  f.failArchive(false); const recovered = await service.archiveState();
  assert.equal(recovered.warning, 'archive_capture_failed'); assert.equal(recovered.records.length, 2);
  await service.close();
});

test('archive failure cannot prevent startup or poison later worker use after a failed delete', async () => {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const f = fixture({ connections: [connection], mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }], deliveries: [event('in:1')] });
  const service = createSwitchboardService(options(f));
  f.failArchive(true); await service.start();
  await assert.rejects(service.removeConnection('default'), /disk_full/);
  f.failArchive(false);
  await service.processMessage({ update_id: 20, message: { message_id: 20, chat: { id: 42, type: 'private' }, from: { id: 9, first_name: 'Human' }, text: 'controlled test input' } }, { id: '10', username: 'test_bot' });
  assert.ok(f.data.get('deliveries').some(row => row.id === 'in:20' && row.turnId === 'turn'));
  await service.close();
});

test('a recovered capture-gap warning survives a subsequent service restart', async () => {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const f = fixture({ connections: [connection], mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }], deliveries: [event('in:1', { status: 'processing', turnId: 'turn' })] });
  let service = createSwitchboardService(options(f));
  f.failArchive(true); await service.reconcile({ sendMessage: async () => ({ message_id: 1 }) });
  f.failArchive(false); assert.equal((await service.archiveState()).warning, 'archive_capture_failed'); await service.close();
  service = createSwitchboardService(options(f));
  assert.equal((await service.archiveState()).warning, 'archive_capture_failed'); await service.close();
});

test('historical records outlive the unchanged 200-record replay buffer', async () => {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const f = fixture({ connections: [connection], mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }] });
  const service = createSwitchboardService(options(f));
  for (let id = 1; id <= 210; id++) await service.processMessage({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from: { id: 9, first_name: 'Human' }, text: 'controlled test input' } }, { id: '10', username: 'test_bot' });
  assert.equal(f.data.get('deliveries').length, 200);
  const history = await service.archiveState();
  assert.equal(history.records.length, 210); assert.ok(history.records.some(row => row.recordId === 'in:1'));
  await service.close();
});

for (const outcome of ['reply', 'empty', 'failed', 'interrupted']) test(`Discord ${outcome} archives terminal inbound metadata while keeping replay input private`, async () => {
  const channelId = '223456789012345678';
  const f = fixture({ connections: [{ ...connection, transport: 'discord' }], configuration: { enabled: true }, mappings: [{ id: 'discord-route', channelId, chatId: channelId, guildId: null, chatType: 'direct', chatTitle: 'Historical DM', enabled: true, agentId: 'agent' }] });
  f.context.agents.turns.read = async () => ({ id: 'turn', status: ['failed', 'interrupted'].includes(outcome) ? outcome : 'succeeded', result: { answerText: outcome === 'reply' ? 'private-answer-sentinel' : '' } });
  const service = createSwitchboardService(options(f)); let sends = 0;
  await service.processMessage({ id: '523456789012345678', channel_id: channelId, author: { id: '423456789012345678', username: 'human' }, content: 'private-input-sentinel', mentions: [] }, { id: '123456789012345678', username: 'test_bot', bot: true });
  assert.equal(f.data.get('deliveries')[0].status, 'processing');
  assert.equal((await service.archiveState()).records.length, 0, 'processing work is not historical');
  await service.reconcile({ sendMessage: async () => { sends++; return { id: '923456789012345678' }; } });
  const live = f.data.get('deliveries').find(row => row.direction === 'inbound');
  assert.equal(live.submission.displayMessage, 'private-input-sentinel', 'Discord keeps its existing replay shape');
  assert.equal(live.status, ['failed', 'interrupted'].includes(outcome) ? outcome : 'delivered');
  const history = await service.archiveState();
  assert.equal(history.records.length, outcome === 'reply' ? 2 : 1);
  assert.equal(history.records.find(row => row.direction === 'inbound').status, live.status);
  assert.equal(history.records.find(row => row.direction === 'inbound').transportType, 'discord');
  assert.equal(sends, outcome === 'reply' ? 1 : 0);
  assert.doesNotMatch(JSON.stringify(history), /private-input-sentinel|private-answer-sentinel|submission|displayMessage/);
  await service.close();
});

for (const transport of ['telegram', 'discord']) test(`${transport} bot removal preserves stopped work and ambiguous sends without fabricated delivery`, async () => {
  const frozen = { message: 'private-frozen-delete', displayMessage: 'private-frozen-delete', agentId: 'agent', sessionId: 'saved-session', attachments: [{ bytes: 'private-image-delete' }] };
  const records = [event('in:submitting', { status: 'submitting', submission: frozen }), event('in:processing', { status: 'processing', turnId: 'turn', submission: frozen }), event('out:sending', { direction: 'outbound', status: 'sending' })];
  const f = fixture({ connections: [{ ...connection, transport }], deliveries: records });
  const service = createSwitchboardService(options(f));
  await service.removeConnection('default');
  const history = await service.archiveState();
  assert.equal(history.records.length, 3);
  assert.deepEqual(history.records.map(row => [row.recordId, row.status]).sort(), [['in:processing', 'interrupted'], ['in:submitting', 'interrupted'], ['out:sending', 'unknown']]);
  assert.ok(history.records.every(row => row.error === 'connection_stopped_for_removal'));
  assert.ok(history.records.every(row => row.transportType === transport));
  assert.doesNotMatch(JSON.stringify(history), /private-frozen-delete|private-image-delete|submission/);
  assert.equal(f.data.has('deliveries'), false); assert.deepEqual(f.data.get('connections'), []);
  await service.close();
});

for (const transport of ['telegram', 'discord']) test(`${transport} failed registry deletion keeps frozen replay data and resumed outcomes supersede stop observations`, async () => {
  const chatId = transport === 'discord' ? '223456789012345678' : '42';
  const routeId = transport === 'discord' ? 'discord-route' : createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const frozen = { message: 'private-replay-after-delete', displayMessage: 'private-replay-after-delete', agentId: 'agent', sessionId: 'saved-session' };
  const retained = [event('in:submitting', { chatId, channelId: chatId, guildId: null, status: 'submitting', submission: frozen }), event('in:processing', { chatId, channelId: chatId, guildId: null, status: 'processing', turnId: 'turn', submission: frozen }), event('out:sending', { chatId, channelId: chatId, guildId: null, direction: 'outbound', status: 'sending' })];
  const f = fixture({ connections: [{ ...connection, transport }], configuration: { enabled: true, agentId: 'agent' }, mappings: [{ id: routeId, chatId, channelId: chatId, guildId: null, topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }], deliveries: retained });
  const write = f.settings.set; let failRegistry = true; let now = Date.parse(AT) + 1000;
  f.settings.set = async (key, value) => { if (failRegistry && key === 'connections' && value.length === 0) throw new Error('registry_write_failed'); return write(key, value); };
  const service = createSwitchboardService({ ...options(f), clock: () => now });
  await assert.rejects(service.removeConnection('default'), /registry_write_failed/);
  assert.deepEqual(f.data.get('deliveries'), retained, 'stopping must not rewrite frozen transport replay data');
  assert.equal(f.data.get('connections').length, 1);
  const stopped = await service.archiveState();
  assert.equal(stopped.records.find(row => row.recordId === 'in:processing').status, 'interrupted');
  assert.equal(stopped.records.find(row => row.recordId === 'out:sending').status, 'unknown');
  failRegistry = false; now += 1000;
  await service.configureConnection('default', { enabled: true });
  await service.reconcile({ sendMessage: async () => ({ id: '923456789012345678', message_id: 1 }) });
  const resumed = await service.archiveState();
  assert.equal(resumed.records.find(row => row.recordId === 'in:processing').status, 'delivered');
  assert.notEqual(resumed.records.find(row => row.recordId === 'in:processing').error, 'connection_stopped_for_removal');
  assert.doesNotMatch(JSON.stringify(resumed), /private-replay-after-delete|submission/);
  await service.close();
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settleArchive = () => new Promise(resolve => setImmediate(resolve));

test('stale pre-gathered snapshot cannot overwrite a captured outcome with a tied timestamp', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  const stale = [{ connection, deliveries: [event('in:tied', { status: 'succeeded' })] }];
  await archive.capture([{ connection, deliveries: [event('in:tied', { status: 'delivered' })] }]);
  const snapshot = await archive.snapshot(stale);
  assert.equal(snapshot.records[0].status, 'delivered');
  assert.equal((await createArchive({ settings: f.settings }).snapshot(stale)).records[0].status, 'delivered');
});

test('snapshot loader reads delivery buffers inside the shared archive serialization boundary', async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  const write = f.settings.set;
  f.settings.set = async (key, value) => { if (key === ARCHIVE_KEY) { entered.resolve(); await release.promise; } return write(key, value); };
  const first = createArchive({ settings: f.settings }); const second = createArchive({ settings: f.settings });
  const capturing = first.capture([{ connection, deliveries: [event('in:serialized')] }]);
  await entered.promise;
  let loaded = false;
  const reading = second.snapshot(async () => { loaded = true; return []; });
  await settleArchive();
  assert.equal(loaded, false, 'loader must wait behind preceding archive write');
  release.resolve(); await capturing;
  assert.equal((await reading).records.length, 1); assert.equal(loaded, true);
});

test('deferred service snapshot and same-millisecond worker capture cannot regress a delivered outcome across restart', async () => {
  const stale = event('in:tied-service', { status: 'succeeded' });
  const f = fixture({ connections: [connection], deliveries: [stale] });
  const service = createSwitchboardService(options(f));
  await service.archiveState();
  const entered = deferred(); const release = deferred(); const get = f.settings.get; let deferRead = true;
  f.settings.get = async (key, fallback) => {
    const snapshot = await get(key, fallback);
    if (key === 'deliveries' && deferRead) { deferRead = false; entered.resolve(); await release.promise; }
    return snapshot;
  };
  const reading = service.archiveState(); await entered.promise;
  const delivered = { ...stale, status: 'delivered' };
  await f.settings.set('deliveries', [delivered]);
  const capturing = createArchive({ settings: f.settings }).capture([{ connection, deliveries: [delivered] }]);
  // Under the old implementation this capture commits before the deferred
  // pre-gathered snapshot and is then overwritten by its equal-timestamp data.
  await settleArchive(); release.resolve();
  await Promise.all([reading, capturing]);
  assert.equal(f.data.get(ARCHIVE_KEY).records[0].status, 'delivered');
  await service.close();
  const restarted = createSwitchboardService(options(f));
  assert.equal((await restarted.archiveState()).records[0].status, 'delivered');
  await restarted.close();
});

for (const transport of ['telegram', 'discord']) test(`${transport} removal classifies legacy delivered records with frozen submission according to transport semantics`, async () => {
  const retained = event('in:legacy-frozen', { submission: { message: 'private-legacy-frozen-input', attachments: [{ bytes: 'private-legacy-bytes' }] } });
  const f = fixture({ connections: [{ ...connection, transport }], deliveries: [retained] });
  const service = createSwitchboardService(options(f));
  await service.archiveState();
  await service.removeConnection('default');
  const expected = transport === 'telegram' ? 'interrupted' : 'delivered';
  const history = await service.archiveState();
  assert.equal(history.records[0].status, expected);
  assert.equal(history.records[0].error, transport === 'telegram' ? 'connection_stopped_for_removal' : undefined);
  assert.doesNotMatch(JSON.stringify(history), /private-legacy-frozen-input|private-legacy-bytes|submission/);
  await service.close();
  const restarted = createSwitchboardService(options(f));
  assert.equal((await restarted.archiveState()).records[0].status, expected); await restarted.close();
});

test('a genuine same-millisecond terminal capture supersedes a stopped observation without stale import restoring it', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  const stopped = event('in:resumed-tie', { status: 'interrupted', error: 'connection_stopped_for_removal' });
  await archive.capture([{ connection, deliveries: [stopped] }]);
  await archive.capture([{ connection, deliveries: [event('in:resumed-tie', { status: 'delivered' })] }]);
  const history = await archive.snapshot([{ connection, deliveries: [stopped] }]);
  assert.equal(history.records[0].status, 'delivered'); assert.equal(history.records[0].error, undefined);
});

for (const [label, corrupt] of [
  ['submission payload', state => { state.records[0].submission = { message: 'secret-corrupted-history' }; }],
  ['nonterminal status', state => { state.records[0].status = 'processing'; }],
  ['null record', state => { state.records[0] = null; }],
  ['unknown record field', state => { state.records[0].token = 'secret-corrupted-history'; }],
  ['unknown envelope field', state => { state.token = 'secret-corrupted-history'; }],
  ['invalid field type', state => { state.records[0].chatTitle = { secret: 'secret-corrupted-history' }; }],
  ['duplicate record identity', state => { state.records.push(structuredClone(state.records[0])); }],
  ['invalid timestamp', state => { state.records[0].updatedAt = 'not-a-date'; }],
]) test(`corrupted persisted ${label} fails closed without exposing or overwriting stored data`, async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  await archive.capture([{ connection, deliveries: [event('in:valid')] }]);
  const corrupted = structuredClone(f.data.get(ARCHIVE_KEY)); corrupt(corrupted); f.data.set(ARCHIVE_KEY, structuredClone(corrupted));
  const write = f.settings.set; let writes = 0;
  f.settings.set = async (...args) => { writes++; return write(...args); };
  for (const action of [() => archive.snapshot([]), () => archive.snapshot(async () => []), () => archive.capture([{ connection, deliveries: [event('in:new')] }])]) {
    await assert.rejects(action(), error => { assert.equal(error.message, 'archive_history_invalid'); assert.doesNotMatch(String(error), /secret-corrupted-history/); return true; });
  }
  assert.equal(writes, 0); assert.deepEqual(f.data.get(ARCHIVE_KEY), corrupted);
});

test('unchanged unresolved legacy row cannot overwrite a stopped observation during unrelated same-millisecond writes', async () => {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const frozen = { message: 'private-legacy-replay', displayMessage: 'private-legacy-replay', agentId: 'agent', sessionId: 'telegram:42:root', idempotencyKey: 'telegram-update-91' };
  const legacy = event('in:91', { updateId: 91, telegramMessageId: 91, submission: frozen, topicId: null });
  const f = fixture({ connections: [connection], configuration: { enabled: true, agentId: 'agent' }, mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }], deliveries: [legacy] });
  const write = f.settings.set; let rejectDelete = true; let turns = 0;
  f.settings.set = async (key, value) => { if (rejectDelete && key === 'connections' && value.length === 0) throw new Error('registry_write_failed'); return write(key, value); };
  f.context.agents.turns.submit = async () => ({ turn: { id: `turn-${++turns}`, status: 'succeeded' } });
  f.context.agents.turns.read = async id => ({ id, status: 'succeeded', result: { answerText: 'private-resumed-answer' } });
  const service = createSwitchboardService(options(f));
  await assert.rejects(service.removeConnection('default'), /registry_write_failed/);
  assert.deepEqual(f.data.get('deliveries'), [legacy]);
  rejectDelete = false; await service.configureConnection('default', { enabled: true });
  const message = id => ({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from: { id: 9, first_name: 'Human' }, text: 'controlled replay test' } });
  const bot = { id: '10', username: 'test_bot' };
  await service.processMessage(message(92), bot);
  assert.deepEqual(f.data.get('deliveries').find(row => row.id === 'in:91'), legacy);
  assert.equal((await service.archiveState()).records.find(row => row.recordId === 'in:91').status, 'interrupted');
  await service.processMessage(message(91), bot);
  await service.reconcile({ sendMessage: async () => ({ message_id: 1 }) });
  const resumed = await service.archiveState();
  assert.equal(resumed.records.find(row => row.recordId === 'in:91').status, 'delivered');
  assert.notEqual(resumed.records.find(row => row.recordId === 'in:91').error, 'connection_stopped_for_removal');
  assert.doesNotMatch(JSON.stringify(resumed), /private-legacy-replay|private-resumed-answer|submission/);
  await service.close();
});

for (const transport of ['telegram', 'discord']) test(`${transport} delivered work with an accepted turn remains delivered during removal even if submission is retained`, async () => {
  const accepted = event('in:accepted', { turnId: 'accepted-turn', submission: { message: 'private-accepted-input' } });
  const f = fixture({ connections: [{ ...connection, transport }], deliveries: [accepted] });
  const service = createSwitchboardService(options(f));
  await service.removeConnection('default');
  const history = await service.archiveState();
  assert.equal(history.records[0].status, 'delivered'); assert.equal(history.records[0].error, undefined);
  assert.equal(history.records[0].turnId, 'accepted-turn');
  assert.doesNotMatch(JSON.stringify(history), /private-accepted-input|submission/);
  await service.close();
});

function instrumentArchive(f) {
  const counts = { reads: 0, writes: 0 };
  const get = f.settings.get, set = f.settings.set;
  f.settings.get = async (key, ...args) => { if (key === ARCHIVE_KEY) counts.reads++; return get(key, ...args); };
  f.settings.set = async (key, ...args) => { if (key === ARCHIVE_KEY) counts.writes++; return set(key, ...args); };
  return { counts, reset: () => { counts.reads = 0; counts.writes = 0; } };
}
function replayFixture() {
  const routeId = createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24);
  const f = fixture({ connections: [connection], configuration: { enabled: true, agentId: 'agent' }, mappings: [{ id: routeId, chatId: '42', topicId: null, chatType: 'direct', agentId: 'agent', enabled: true }] });
  const message = id => ({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from: { id: 9, first_name: 'Human' }, text: 'controlled performance test' } });
  return { f, message, bot: { id: '10', username: 'test_bot' } };
}

test('nonterminal replay writes and timestamp-only repeats skip all archive reads and writes', async () => {
  const { f, message, bot } = replayFixture(); let now = Date.parse(AT);
  f.context.agents.turns.submit = async () => ({ turn: { id: 'pending-turn', status: 'queued' } });
  f.context.agents.turns.read = async () => ({ id: 'pending-turn', status: 'queued' });
  const io = instrumentArchive(f); const service = createSwitchboardService({ ...options(f), clock: () => now });
  await service.archiveState(); io.reset();
  await service.processMessage(message(1), bot); // submitting, then processing
  for (let index = 0; index < 3; index++) { now += 1000; await service.reconcile({}); }
  assert.deepEqual(io.counts, { reads: 0, writes: 0 });
  assert.equal(f.data.get('deliveries')[0].status, 'processing');
  f.context.agents.turns.read = async () => ({ id: 'pending-turn', status: 'succeeded', result: { answerText: '' } });
  now += 1000; await service.reconcile({});
  assert.ok(io.counts.reads > 0); assert.ok(io.counts.writes > 0);
  assert.equal(f.data.get(ARCHIVE_KEY).records[0].status, 'succeeded');
  io.reset();
  for (let index = 0; index < 3; index++) { now += 1000; await service.reconcile({}); }
  assert.deepEqual(io.counts, { reads: 0, writes: 0 }, 'timestamp-only terminal rewrites must not reread the retained history');
  await service.close();
});

test('pending archive retry recovers on the next nonterminal mutation then stops hot-path history reads while retaining gap warning', async () => {
  const { f, message, bot } = replayFixture();
  const io = instrumentArchive(f); const service = createSwitchboardService(options(f));
  await service.archiveState(); io.reset();
  f.failArchive(true);
  await service.processMessage(message(1), bot); // accepted succeeded outcome cannot be archived
  assert.ok(io.counts.writes > 0); assert.equal(f.data.get(ARCHIVE_KEY).records.length, 0);
  f.failArchive(false); io.reset();
  f.context.agents.turns.submit = async () => ({ turn: { id: 'next-pending-turn', status: 'queued' } });
  await service.processMessage(message(2), bot);
  assert.ok(io.counts.reads > 0); assert.ok(io.counts.writes > 0, 'nonterminal mutation must retry failed retained outcome capture');
  assert.equal(f.data.get(ARCHIVE_KEY).records.find(row => row.recordId === 'in:1').status, 'succeeded');
  io.reset(); await service.processMessage(message(3), bot);
  assert.deepEqual(io.counts, { reads: 0, writes: 0 }, 'successful retry clears retry scheduling, not the historical gap warning');
  assert.equal((await service.archiveState()).warning, 'archive_capture_failed');
  await service.close();
  const restarted = createSwitchboardService(options(f));
  assert.equal((await restarted.archiveState()).warning, 'archive_capture_failed'); await restarted.close();
});

test('history comparison never serializes frozen private submissions while still detecting terminal outcomes', async () => {
  const { f } = replayFixture();
  let privateSerialization = 0;
  const submission = { message: 'private-large-frozen-input', attachments: [{ bytes: 'x'.repeat(2_000_000) }] };
  Object.defineProperty(submission, 'toJSON', { enumerable: false, get() { privateSerialization++; throw new Error('private_submission_must_not_be_serialized_for_history'); } });
  f.data.set('deliveries', [event('in:private-hot-path', { status: 'processing', turnId: 'private-turn', submission })]);
  // Preserve the private object identity only for the replay-buffer adapter.
  // Other keys retain the ordinary structured-clone persistence fixture.
  const get = f.settings.get, set = f.settings.set;
  f.settings.get = async (key, fallback) => key === 'deliveries' ? f.data.get(key).map(row => ({ ...row })) : get(key, fallback);
  f.settings.set = async (key, value) => {
    if (key === 'deliveries') { f.data.set(key, value.map(row => ({ ...row }))); return value; }
    return set(key, value);
  };
  let now = Date.parse(AT);
  f.context.agents.turns.read = async () => ({ id: 'private-turn', status: 'queued' });
  const io = instrumentArchive(f); const service = createSwitchboardService({ ...options(f), clock: () => now });
  await service.archiveState(); io.reset();
  now += 1000; await service.reconcile({});
  assert.equal(privateSerialization, 0); assert.deepEqual(io.counts, { reads: 0, writes: 0 });
  assert.equal(f.data.has('archive-history-gap'), false);
  f.context.agents.turns.read = async () => ({ id: 'private-turn', status: 'succeeded', result: { answerText: '' } });
  now += 1000; await service.reconcile({});
  assert.equal(privateSerialization, 0); assert.ok(io.counts.writes > 0);
  assert.equal(f.data.get(ARCHIVE_KEY).records[0].status, 'succeeded');
  assert.doesNotMatch(JSON.stringify(f.data.get(ARCHIVE_KEY)), /private-large-frozen-input|attachments|submission/);
  io.reset(); now += 1000; await service.reconcile({});
  assert.equal(privateSerialization, 0); assert.deepEqual(io.counts, { reads: 0, writes: 0 });
  assert.equal(f.data.get('deliveries')[0].submission, submission, 'history projection must leave frozen replay input intact');
  assert.equal(f.data.has('archive-history-gap'), false);
  await service.close();
});

for (const recovery of ['snapshot', 'nonterminal']) test(`failed equal-time delivered capture retains ordering through ${recovery} retry and restart`, async () => {
  const { f, message, bot } = replayFixture();
  f.data.set('deliveries', [event('in:1', { status: 'processing', turnId: 'turn' })]);
  const set = f.settings.set; let rejectDelivered = true, sends = 0;
  f.settings.set = async (key, value) => {
    if (key === ARCHIVE_KEY && rejectDelivered && value.records.some(row => row.recordId === 'in:1' && row.status === 'delivered')) throw new Error('disk_full');
    return set(key, value);
  };
  const service = createSwitchboardService(options(f));
  await service.archiveState();
  await service.reconcile({ sendMessage: async () => { sends++; return { message_id: 1 }; } });
  assert.equal(sends, 1);
  assert.equal(f.data.get('deliveries').find(row => row.id === 'in:1').status, 'delivered');
  assert.equal(f.data.get(ARCHIVE_KEY).records.find(row => row.recordId === 'in:1').status, 'succeeded');
  await assert.rejects(service.archiveState(), /disk_full/, 'a failed snapshot retry must not discard ordered observations');
  rejectDelivered = false;
  if (recovery === 'snapshot') await service.archiveState();
  else {
    f.context.agents.turns.submit = async () => ({ turn: { id: 'queued-retry', status: 'queued' } });
    await service.processMessage(message(2), bot);
  }
  assert.equal(f.data.get(ARCHIVE_KEY).records.find(row => row.recordId === 'in:1').status, 'delivered');
  assert.equal((await service.archiveState()).warning, 'archive_capture_failed');
  await service.close();
  const restarted = createSwitchboardService(options(f));
  assert.equal((await restarted.archiveState()).records.find(row => row.recordId === 'in:1').status, 'delivered');
  assert.equal(sends, 1); await restarted.close();
});

test('failed ordered observations survive another bot/instance write without granting stale snapshots authority', async () => {
  const f = fixture(); const first = createArchive({ settings: f.settings });
  await first.capture([{ connection, deliveries: [event('in:retry', { status: 'succeeded' }), event('in:stable')] }]);
  f.failArchive(true);
  await assert.rejects(first.capture([{ connection, deliveries: [event('in:retry', { status: 'interrupted', submission: { message: 'private-pending-input' } })] }]), /disk_full/);
  await assert.rejects(first.capture([{ connection, deliveries: [event('in:retry', { status: 'delivered' })] }]), /disk_full/);
  f.failArchive(false);
  const second = createArchive({ settings: f.settings });
  await second.capture([
    { connection, deliveries: [event('in:stable', { status: 'succeeded' })], observedWrite: false },
    { connection: { ...connection, id: 'other-bot' }, deliveries: [event('in:other')] },
  ]);
  const result = await second.snapshot([]);
  assert.equal(result.records.find(row => row.recordId === 'in:retry').status, 'delivered');
  assert.equal(result.records.find(row => row.recordId === 'in:stable').status, 'delivered');
  assert.equal(result.records.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /private-pending-input|submission/);
  // A newer observation must supersede the retry, not be overwritten by it.
  await first.capture([{ connection, deliveries: [event('in:retry', { status: 'failed' })] }]);
  assert.equal((await second.snapshot([])).records.find(row => row.recordId === 'in:retry').status, 'failed');
});

test('failed observation retention is bounded and sanitized before recovery without replay buffers', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  f.failArchive(true);
  const deliveries = Array.from({ length: ARCHIVE_LIMIT + 1 }, (_, index) => event(`in:pending-${index}`, { submission: { message: 'private-retry-input' }, answerText: 'private-retry-answer' }));
  await assert.rejects(archive.capture([{ connection, deliveries }]), /disk_full/);
  f.failArchive(false);
  const recovered = await archive.snapshot([]);
  assert.equal(recovered.records.length, ARCHIVE_LIMIT); assert.equal(recovered.coverage.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(recovered.records)) <= recovered.coverage.byteLimit);
  assert.doesNotMatch(JSON.stringify(recovered), /private-retry|submission|answerText/);
});

test('fresh module after process loss cannot infer equal-time failed-write ordering from replay snapshots', async () => {
  const f = fixture(); const archive = createArchive({ settings: f.settings });
  await archive.capture([{ connection, deliveries: [event('in:lost-order', { status: 'succeeded' })] }]);
  f.failArchive(true);
  await assert.rejects(archive.capture([{ connection, deliveries: [event('in:lost-order')] }]), /disk_full/);
  f.failArchive(false);
  // A fresh module has no prior process's WeakMap; only persisted settings remain.
  const { createArchive: freshArchive } = await import(`../server/archive.mjs?fresh-process=${Date.now()}`);
  const recovered = await freshArchive({ settings: f.settings }).snapshot([{ connection, deliveries: [event('in:lost-order')] }]);
  assert.equal(recovered.records[0].status, 'succeeded', 'snapshots must not fabricate ordering evidence after process loss');
});
