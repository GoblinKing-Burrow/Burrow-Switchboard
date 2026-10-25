import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSwitchboardService } from '../server/telegram.mjs';
import { activate } from '../server/index.mjs';

const BOTS = [{ id: '1', username: 'hatchet_bot' }, { id: '2', username: 'smatchet_bot' }];
const routeId = (chatId, topicId = null) => createHash('sha256').update(`telegram:${chatId}:${topicId ?? 'root'}`).digest('hex').slice(0, 24);
const key = (connectionId, name) => connectionId === 'default' ? name : `connection-${connectionId}-${name}`;
const request = (body, params = {}) => ({ auth: { enabled: false }, body, params, query: {}, headers: {} });
const message = (id, text, extra = {}) => ({ update_id: id, message: { message_id: id, date: 1792752000 + id, chat: { id: -100, type: 'supergroup', title: 'Council' }, from: { id: 50, first_name: 'Human' }, text, ...extra } });
const mention = (text, value, type = 'mention') => ({ type, offset: text.indexOf(value), length: value.length });

function fixture() {
  const settings = new Map(), secrets = new Map(), routes = new Map(), submissions = [], calls = [];
  const agents = [{ id: 'goblin', enabled: true }, { id: 'hatchet', enabled: true }, { id: 'smatchet', enabled: true }, { id: 'off', enabled: false }];
  const context = {
    id: 'burrow-switchboard',
    api: Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method, (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler)])),
    settings: {
      get: async (name, fallback = null) => structuredClone(settings.has(name) ? settings.get(name) : fallback),
      set: async (name, value) => settings.set(name, structuredClone(value)),
      delete: async name => settings.delete(name),
    },
    secrets: { get: async name => secrets.get(name) ?? null, set: async (name, value) => secrets.set(name, value), clear: async name => secrets.delete(name), has: async name => secrets.has(name) },
    agents: { list: async () => agents, turns: {
      submit: async input => { submissions.push(structuredClone(input)); return { turn: { id: `turn-${submissions.length}`, status: 'queued' } }; },
      read: async id => ({ id, status: 'succeeded', result: { answerText: `Answer ${id}` } }),
    } },
    logger: { info() {}, error() {} },
  };
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/getMe')) {
      const bot = url.includes('/botone/') ? BOTS[0] : BOTS[1];
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { ...bot, is_bot: true } }) };
    }
    if (url.endsWith('/users/@me')) return { ok: true, status: 200, json: async () => ({ id: '90', bot: true, username: 'discord_bot' }) };
    if (url.endsWith('/channels/300')) return { ok: true, status: 200, json: async () => ({ id: '300', guild_id: '200', name: 'Council', type: 0 }) };
    throw new Error(`unexpected_request: ${url}`);
  };
  const service = createSwitchboardService({ context, fetchImpl });
  return { context, settings, secrets, routes, submissions, calls, agents, fetchImpl, service };
}
async function twoBots(f) {
  await f.service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
  const state = await f.service.createConnection({ name: 'Smatchet', enabled: false, token: 'two', agentId: 'smatchet' });
  return ['default', state.connections[1].id];
}
async function admit(f, connectionId, bot, extra = {}) {
  await f.service.processMessage(message(1, 'admit', extra), bot, connectionId);
  const connection = (await f.service.publicState()).connections.find(item => item.id === connectionId);
  assert.equal(connection.pending.length, 1);
  await f.service.approveConnection(connectionId, connection.pending[0].id, {});
}
async function viaBoth(f, ids, update) {
  for (const [index, id] of ids.entries()) await f.service.processMessage(update, BOTS[index], id);
}

test('two approved bots broadcast human speech, target known entities/replies, and never loop bot messages', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const ids = await twoBots(f);
  for (const [index, id] of ids.entries()) await admit(f, id, BOTS[index]);
  let id = 10;
  const cases = [
    { text: 'ordinary group conversation', recipients: ['hatchet', 'smatchet'] },
    { text: '@hatchet_bot answer', entities: [mention('@hatchet_bot answer', '@hatchet_bot')], recipients: ['hatchet'], clean: 'answer' },
    { text: '😀 @SMATCHET_BOT answer', entities: [mention('😀 @SMATCHET_BOT answer', '@SMATCHET_BOT')], recipients: ['smatchet'], clean: '😀  answer' },
    { text: 'Hatchet answer', entities: [{ type: 'text_mention', offset: 0, length: 7, user: { id: 1, is_bot: true } }], recipients: ['hatchet'] },
    { text: '/ask@smatchet_bot explain', entities: [mention('/ask@smatchet_bot explain', '/ask@smatchet_bot', 'bot_command')], recipients: ['smatchet'] },
    { text: 'reply to unrelated bot', reply_to_message: { from: { id: 999, is_bot: true } }, recipients: ['hatchet', 'smatchet'] },
    { text: 'reply to Hatchet', reply_to_message: { from: { id: 1, is_bot: true } }, recipients: ['hatchet'] },
    { text: 'reply to Smatchet', reply_to_message: { from: { id: 2, is_bot: true } }, recipients: ['smatchet'] },
    { text: '@smatchet_bot take over', entities: [mention('@smatchet_bot take over', '@smatchet_bot')], reply_to_message: { from: { id: 1, is_bot: true } }, recipients: ['smatchet'], clean: 'take over' },
    { text: 'Hatchet take over', entities: [{ type: 'text_mention', offset: 0, length: 7, user: { id: 1 } }], reply_to_message: { from: { id: 2, is_bot: true } }, recipients: ['hatchet'] },
    { text: '@hatchet_bot and @smatchet_bot discuss', entities: [mention('@hatchet_bot and @smatchet_bot discuss', '@hatchet_bot'), mention('@hatchet_bot and @smatchet_bot discuss', '@smatchet_bot')], recipients: ['hatchet', 'smatchet'], clean: ['and @smatchet_bot discuss', '@hatchet_bot and  discuss'] },
    { text: '@human your opinion?', entities: [mention('@human your opinion?', '@human')], recipients: ['hatchet', 'smatchet'] },
    { text: '@unknown_bot your opinion?', entities: [mention('@unknown_bot your opinion?', '@unknown_bot')], recipients: ['hatchet', 'smatchet'] },
    { text: 'Human your opinion?', entities: [{ type: 'text_mention', offset: 0, length: 5, user: { id: 50, is_bot: false } }], recipients: ['hatchet', 'smatchet'] },
    { text: 'reply to another human', reply_to_message: { from: { id: 50, is_bot: false } }, recipients: ['hatchet', 'smatchet'] },
    { text: '@hatchet_bot.fake remains ordinary speech', entities: [mention('@hatchet_bot.fake remains ordinary speech', '@hatchet_bot.fake')], recipients: ['hatchet', 'smatchet'] },
    { text: 'known name with invalid entity', entities: [{ type: 'mention', offset: -1, length: 12 }], recipients: ['hatchet', 'smatchet'] },
    { text: '@hatchet_bot bot says hello', from: { id: 2, is_bot: true }, entities: [mention('@hatchet_bot bot says hello', '@hatchet_bot')], recipients: [] },
    { text: 'unknown bot speech', from: { id: 88, is_bot: true }, recipients: [] },
  ];
  for (const { text, recipients, clean, ...extra } of cases) {
    const update = message(id++, text, extra);
    const before = f.submissions.length;
    await viaBoth(f, ids, update);
    const added = f.submissions.slice(before);
    assert.deepEqual(added.map(input => input.agentId), recipients, text);
    assert.equal(new Set(added.map(input => input.idempotencyKey)).size, recipients.length, text);
    for (const [index, input] of added.entries()) {
      assert.equal(input.displayMessage, (Array.isArray(clean) ? clean[index] : clean) ?? text, text);
      const connectionId = input.agentId === 'hatchet' ? 'default' : ids[1];
      assert.equal(input.sessionId, connectionId === 'default' ? 'telegram:-100:root' : `telegram:${connectionId}:-100:root`);
      assert.equal(input.idempotencyKey, connectionId === 'default' ? `telegram-update-${update.update_id}` : `telegram-${connectionId}-update-${update.update_id}`);
    }
    await viaBoth(f, ids, update);
    assert.equal(f.submissions.length, before + recipients.length, `${text}: replay must not duplicate turns`);
  }
  const history = f.settings.get('telegram-room-history')[0].messages;
  assert.equal(history.length, cases.length, 'shared history deduplicates independent pollers');
  assert.equal(new Set(history.map(item => item.messageId)).size, cases.length);
  const sent = [];
  for (const connectionId of ids) await f.service.reconcile({ sendMessage: async input => { sent.push({ connectionId, ...input }); return { message_id: 1000 + sent.length }; } }, connectionId);
  assert.equal(sent.length, f.submissions.length);
  const count = f.submissions.length;
  await viaBoth(f, ids, message(5000, 'confirmed bot response', { from: { ...BOTS[0], is_bot: true } }));
  assert.equal(f.submissions.length, count, 'delivering and observing a bot answer never submits a new turn');
  for (const connectionId of ids) await f.service.reconcile({ sendMessage: async () => assert.fail('confirmed sends must not repeat') }, connectionId);
});

test('topic-first admission approves the group per connection; inherited sessions/context remain topic and chat isolated', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const ids = await twoBots(f);
  await admit(f, ids[0], BOTS[0], { message_thread_id: 11 });
  let state = await f.service.publicState();
  assert.equal(state.mappings[0].topicId, null, 'a topic request admits its parent group');
  assert.equal(state.mappings[0].id, routeId('-100'));
  assert.equal(state.connections[1].mappings.length, 0);
  await viaBoth(f, ids, message(10, 'topic eleven secret', { message_thread_id: 11 }));
  assert.deepEqual(f.submissions.map(input => input.agentId), ['hatchet']);
  assert.equal(f.submissions[0].sessionId, 'telegram:-100:11');
  state = await f.service.publicState();
  assert.equal(state.pending.length, 0, 'inherited topic does not require another approval');
  assert.equal(state.connections[1].pending[0].topicId, null);
  await f.service.approveConnection(ids[1], state.connections[1].pending[0].id, {});
  await viaBoth(f, ids, message(11, 'topic twelve secret', { message_thread_id: 12 }));
  assert.deepEqual(f.submissions.slice(1).map(input => input.agentId), ['hatchet', 'smatchet']);
  for (const input of f.submissions.slice(1)) {
    assert.match(input.sessionId, /:-100:12$/);
    assert.doesNotMatch(input.message, /topic eleven secret/);
  }
  await f.service.processMessage(message(12, 'root question'), BOTS[0]);
  assert.equal(f.submissions.at(-1).sessionId, 'telegram:-100:root');
  assert.doesNotMatch(f.submissions.at(-1).message, /topic eleven secret|topic twelve secret/);
  await f.service.processMessage(message(13, 'other group secret', { chat: { id: -200, type: 'supergroup' } }), BOTS[0]);
  assert.equal(f.submissions.length, 4, 'group approval must not cross chat boundaries');
  await f.service.processMessage(message(14, 'topic eleven followup', { message_thread_id: 11 }), BOTS[0]);
  assert.match(f.submissions.at(-1).message, /topic eleven secret/);
  assert.doesNotMatch(f.submissions.at(-1).message, /topic twelve secret|root question|other group secret/);
});

test('explicit topic overrides survive root deletion while inherited queued replies stay interrupted after restart/re-admission', async t => {
  const f = fixture(); let service = f.service; t.after(() => service.close());
  await service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
  await admit(f, 'default', BOTS[0]);
  const root = (await service.publicState()).mappings[0];
  // Persisted explicit topic mappings remain supported although new admission is group-wide.
  const override = { ...root, id: routeId('-100', 22), topicId: 22, agentId: 'smatchet' };
  f.settings.set('mappings', [root, override]);
  await service.processMessage(message(10, 'inherited queued', { message_thread_id: 11 }), BOTS[0]);
  await service.processMessage(message(11, 'explicit queued', { message_thread_id: 22 }), BOTS[0]);
  await service.processMessage(message(12, 'root queued'), BOTS[0]);
  assert.deepEqual(f.submissions.map(input => input.agentId), ['hatchet', 'smatchet', 'hatchet']);
  await service.deleteMapping(root.id);
  let state = await service.publicState();
  for (const id of ['in:10', 'in:12']) {
    assert.equal(state.deliveries.find(item => item.id === id).status, 'interrupted');
    assert.equal(state.deliveries.find(item => item.id === id).error, 'mapping_deleted');
  }
  assert.equal(state.deliveries.find(item => item.id === 'in:11').status, 'processing');
  await service.close();
  service = createSwitchboardService({ context: f.context, fetchImpl: f.fetchImpl });
  await service.processMessage(message(13, 'new inherited request', { message_thread_id: 11 }), BOTS[0]);
  state = await service.publicState();
  assert.equal(state.pending[0].topicId, null);
  await service.approve(state.pending[0].id, {});
  const sent = [];
  await service.reconcile({ sendMessage: async input => { sent.push(input); return { message_id: 100 }; } });
  assert.deepEqual(sent.map(input => [input.topicId, input.text]), [[22, 'Answer turn-2']]);
  await service.reconcile({ sendMessage: async () => assert.fail('re-admission must not revive interrupted or delivered replies') });
  assert.equal(f.submissions.length, 3);
  await service.updateMapping(override.id, { agentId: 'smatchet', enabled: false });
  await service.processMessage(message(14, 'disabled override must not fall back', { message_thread_id: 22 }), BOTS[0]);
  assert.equal(f.submissions.length, 3);
  await service.processMessage(message(15, 'inherited still works', { message_thread_id: 11 }), BOTS[0]);
  assert.equal(f.submissions.at(-1).agentId, 'hatchet');
});

test('reconciliation requires an enabled route with matching agent and honors exact topic overrides', async t => {
  const f = fixture(); t.after(() => f.service.close());
  await f.service.publicState();
  const root = { id: routeId('-100'), chatId: '-100', topicId: null, chatType: 'supergroup', agentId: 'hatchet', enabled: true };
  const inbound = (id, topicId, agentId = 'hatchet', chatId = '-100') => ({ id: `in:${id}`, direction: 'inbound', chatId, topicId, agentId, turnId: `turn-${id}`, status: 'processing' });
  f.settings.set('mappings', [root, { ...root, id: routeId('-100', 22), topicId: 22, agentId: 'smatchet' }, { ...root, id: routeId('-100', 33), topicId: 33, enabled: false }]);
  f.settings.set('deliveries', [inbound(1, 11), inbound(2, 22), inbound(3, 22, 'smatchet'), inbound(4, 33), inbound(5, null, 'smatchet'), inbound(6, null, 'hatchet', '-200')]);
  const sent = [];
  await f.service.reconcile({ sendMessage: async input => { sent.push(input); return { message_id: 100 + sent.length }; } });
  assert.deepEqual(sent.map(input => input.text).sort(), ['Answer turn-1', 'Answer turn-3']);
  const state = await f.service.publicState();
  for (const id of [2, 4, 5, 6]) {
    const delivery = state.deliveries.find(item => item.id === `in:${id}`);
    assert.equal(delivery.status, 'interrupted');
    assert.equal(delivery.error, 'mapping_unavailable');
  }
  await f.service.reconcile({ sendMessage: async () => assert.fail('no duplicate sends') });
});

test('assigned connection defaults preserve omitted edits, token clear and restart; invalid assignments are atomic', async t => {
  const f = fixture(); let service = f.service; t.after(() => service.close());
  await service.configure({ enabled: false, token: 'one', agentId: 'hatchet' });
  const created = await service.createConnection({ name: 'Peer', enabled: false, token: 'two', agentId: 'smatchet' });
  const id = created.connections[1].id;
  await service.configureConnection(id, { name: 'Renamed', enabled: false });
  await service.configure({ enabled: false });
  for (const [agentId, error] of [['missing', /agent_not_found/], ['off', /agent_disabled/], ['', /agent_invalid/], [123, /agent_invalid/]]) {
    const before = structuredClone([...f.settings]);
    await assert.rejects(service.configureConnection(id, { enabled: false, name: 'Must not persist', token: 'two', agentId }), error);
    assert.deepEqual([...f.settings], before);
    assert.equal(f.secrets.get(key(id, 'telegram-bot-token')), 'two');
  }
  await assert.rejects(service.createConnection({ name: 'Invalid', enabled: false, token: 'three', agentId: 'off' }), /agent_disabled/);
  assert.equal((await service.publicState()).connections.length, 2);
  await service.clearConnectionToken(id);
  await service.close(); service = createSwitchboardService({ context: f.context, fetchImpl: f.fetchImpl });
  let state = await service.publicState();
  assert.equal(state.agentId, 'hatchet');
  assert.equal(state.connections[1].agentId, 'smatchet');
  assert.equal(state.connections[1].tokenConfigured, false);
  await service.configureConnection(id, { enabled: false, token: 'two' });
  await service.processMessage(message(1, 'admit'), BOTS[1], id);
  state = await service.publicState();
  await service.approveConnection(id, state.connections[1].pending[0].id, {});
  await service.processMessage(message(2, 'uses assigned default'), BOTS[1], id);
  assert.equal(f.submissions.at(-1).agentId, 'smatchet');
  await service.configureConnection(id, { enabled: false, agentId: null });
  await service.configureConnection(id, { enabled: false });
  assert.equal((await service.publicState()).connections[1].agentId, null);
  assert.equal((await service.publicState()).connections[1].mappings[0].agentId, null, 'inherited approval follows the default assignment');
  const route = (await service.publicState()).connections[1].mappings[0];
  await service.updateConnectionMapping(id, route.id, { agentId: 'smatchet', enabled: true });
  await service.configureConnection(id, { enabled: false, agentId: 'hatchet' });
  assert.equal((await service.publicState()).connections[1].mappings[0].agentId, 'smatchet', 'explicit overrides survive default changes');
});

test('operator API assigns Discord connection defaults and authorizes only observed servers with authentication', async t => {
  const f = fixture(); await f.service.close();
  const cleanup = await activate(f.context, { fetchImpl: f.fetchImpl }); t.after(cleanup);
  const created = await f.routes.get('POST /connections')(request({ name: 'Discord', transport: 'discord', token: 'discord-secret', enabled: false, agentId: 'hatchet' }));
  assert.equal(created.status, 200);
  const connection = created.body.connections.find(item => item.transportType === 'discord');
  const params = { connectionId: connection.id, guildId: '200' };
  const authorize = f.routes.get('PUT /connections/:connectionId/servers/:guildId');
  assert.equal(typeof authorize, 'function');
  const denied = await authorize({ ...request({ enabled: true }, params), auth: { enabled: true, authenticated: false } });
  assert.equal(denied.status, 401);
  const unknown = await authorize(request({ enabled: true }, params));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'server_not_found');
  // Observation is gateway-owned; seed its persisted evidence without a real network gateway.
  f.settings.set(key(connection.id, 'observed-guilds'), [{ guildId: '200', name: 'Council guild' }]);
  const approved = await authorize(request({ enabled: true }, params));
  assert.equal(approved.status, 200);
  const discord = approved.body.connections.find(item => item.id === connection.id);
  assert.equal(discord.agentId, 'hatchet');
  assert.deepEqual(discord.servers, [{ guildId: '200', name: 'Council guild', enabled: true }]);
  assert.deepEqual(approved.body.connections[0].mappings, [], 'Discord authorization must not touch Telegram routes');
  const change = f.routes.get('PUT /connections/:connectionId');
  const invalid = await change(request({ enabled: false, agentId: 'off' }, { connectionId: connection.id }));
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error, 'agent_disabled');
  const preserved = await change(request({ name: 'Renamed Discord', enabled: false }, { connectionId: connection.id }));
  assert.equal(preserved.body.connections.find(item => item.id === connection.id).agentId, 'hatchet');
  const remove = f.routes.get('DELETE /connections/:connectionId/servers/:guildId');
  assert.equal((await remove({ ...request(null, params), auth: { enabled: true, authenticated: false } })).status, 401);
  const removed = await remove(request(null, params));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.connections.find(item => item.id === connection.id).servers, []);
  assert.doesNotMatch(JSON.stringify(removed), /discord-secret/);
});
