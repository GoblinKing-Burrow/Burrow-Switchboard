import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordConnection } from '../server/discord.mjs';

const BOT = { id: '100', username: 'bot', bot: true };
const USER = { id: '101', username: 'human' };
const GUILD = '200';
const CHANNEL = '300';
function store() {
  const data = new Map();
  return { data, get: async (key, fallback = null) => structuredClone(data.has(key) ? data.get(key) : fallback), set: async (key, value) => data.set(key, structuredClone(value)) };
}
function fixture({ settings = store(), history = store() } = {}) {
  const secrets = new Map([['discord-bot-token', 'secret']]);
  const submissions = [], sent = [], requests = [], edits = [], callbacks = [], cancelled = [], created = [];
  let turn = { status: 'queued' };
  const agents = [{ id: 'goblin', enabled: true }, { id: 'hatchet', enabled: true }, { id: 'off', enabled: false }];
  const context = {
    settings,
    secrets: { get: async key => secrets.get(key), has: async key => secrets.has(key), set: async (key, value) => secrets.set(key, value), clear: async key => secrets.delete(key) },
    agents: { list: async () => agents, turns: {
      submit: async input => { submissions.push(structuredClone(input)); return { turn: { id: `turn-${submissions.length}` } }; },
      read: async id => ({ ...turn, id }),
      cancel: async id => { cancelled.push(id); return { cancellationRequested: true }; },
    }, sessions: { create: async input => { created.push(input); return { agentId: input.agentId, sessionId: `fresh-${created.length}` }; } } },
  };
  const service = createDiscordConnection({ context, connectionId: 'one', discordHistorySettings: history, fetchImpl: async url => {
    requests.push(url);
    assert.match(url, /\/channels\/\d+$/); // Observation must not fetch guilds or discover new membership remotely.
    const id = url.split('/').at(-1);
    return { ok: true, status: 200, json: async () => ({ id, guild_id: GUILD, name: id === CHANNEL ? 'Council' : 'Thread', type: id === CHANNEL ? 0 : 11, ...(id === CHANNEL ? {} : { parent_id: CHANNEL }) }) };
  } });
  const api = {
    sendMessage: async input => { sent.push(input); return { id: `${9000 + sent.length}` }; },
    interactionCallback: async (_event, body) => { callbacks.push(body); },
    interactionEdit: async (_event, content) => { edits.push(content); },
  };
  return { service, context, settings, history, agents, submissions, sent, requests, edits, callbacks, cancelled, created, api, setTurn: value => { turn = value; } };
}
function message(id = '1000', patch = {}) {
  return { id, channel_id: CHANNEL, guild_id: GUILD, guild_name: 'Council guild', author: USER, content: `<@${BOT.id}> question`, mentions: [BOT], ...patch };
}
function interaction(id = '2000', patch = {}) {
  return { id, channel_id: CHANNEL, guild_id: GUILD, guild_name: 'Council guild', application_id: BOT.id, token: 'interaction-secret', type: 2, member: { user: USER, permissions: '32' }, data: { name: 'status' }, ...patch };
}
async function enable(f, agentId = 'goblin') { await f.service.configure({ enabled: true, agentId }); }
async function authorize(f) {
  await enable(f);
  await f.service.processMessage(message(), BOT);
  await f.service.configureServer(GUILD, { enabled: true });
}
async function explicit(f, agentId = 'hatchet') {
  await f.service.processMessage(message(), BOT);
  const request = (await f.service.publicState()).pending[0];
  await f.service.approve(request.id, { agentId });
  return request;
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('condition did not settle');
}

test('assignment defaults to unassigned, is nullable, preserves omission and token clear, validates explicit assignments atomically', async t => {
  const f = fixture(); t.after(() => f.service.close());
  assert.equal((await f.service.publicState()).agentId, null);
  await enable(f, 'hatchet');
  await f.service.configure({ enabled: false });
  assert.equal((await f.service.publicState()).agentId, 'hatchet');
  for (const [agentId, error] of [['missing', /agent_not_found/], ['off', /agent_disabled/], ['', /configuration_invalid/], [123, /configuration_invalid/]]) {
    await assert.rejects(f.service.configure({ enabled: true, agentId }), error);
    assert.equal((await f.service.publicState()).agentId, 'hatchet');
  }
  await f.service.clearToken();
  assert.equal((await f.service.publicState()).agentId, 'hatchet');
  await enable(f, null);
  await f.service.configure({ enabled: true });
  assert.equal((await f.service.publicState()).agentId, null);
  assert.equal(f.requests.length, 0);
});

test('only observed guilds are pending; legacy channel approval never grants an entire server', async t => {
  const f = fixture(); t.after(() => f.service.close()); await enable(f);
  const route = await explicit(f);
  let state = await f.service.publicState();
  assert.equal(state.mappings[0].inherited, false);
  assert.deepEqual(state.servers, []);
  assert.deepEqual(state.pendingServers, [{ guildId: GUILD, name: 'Council guild' }]);
  await f.service.processMessage(message('1001', { channel_id: '301' }), BOT);
  assert.equal(f.submissions.length, 0);
  assert.equal((await f.service.publicState()).pending.length, 1);
  await assert.rejects(f.service.configureServer('999', { enabled: true }), /server_not_found/);
  await assert.rejects(f.service.configureServer(Number(GUILD), { enabled: true }), /server_invalid/);
  await assert.rejects(f.service.configureServer(GUILD, { enabled: 'yes' }), /server_invalid/);
  await assert.rejects(f.service.configureServer(GUILD, { enabled: true, extra: 1 }), /server_invalid/);
  await f.service.processMessage(message('1002'), BOT);
  assert.equal(f.submissions[0].agentId, 'hatchet');
  assert.equal(route.guildId, GUILD);
});

test('server authorization requires a configured enabled agent, including when a persisted assignment becomes disabled', async t => {
  const f = fixture(); t.after(() => f.service.close()); await enable(f, null);
  await f.service.processMessage(message(), BOT);
  await assert.rejects(f.service.configureServer(GUILD, { enabled: true }), /agent_required/);
  await enable(f);
  f.agents[0].enabled = false;
  await assert.rejects(f.service.configureServer(GUILD, { enabled: true }), /agent_disabled/);
  f.agents[0].enabled = true;
  await f.service.configureServer(GUILD, { enabled: true });
  assert.deepEqual((await f.service.publicState()).servers, [{ guildId: GUILD, name: 'Council guild', enabled: true }]);
  assert.deepEqual((await f.service.publicState()).pendingServers, []);
});

test('approved servers create durable inherited channel and thread routes with isolated sessions/context and unchanged triggers', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001', { content: 'parent ambient', mentions: [] }), BOT);
  await f.service.processMessage(message('1002'), BOT);
  await f.service.processMessage(message('1003', { channel_id: '301', content: 'thread ambient', mentions: [] }), BOT);
  await f.service.processMessage(message('1004', { channel_id: '301' }), BOT);
  assert.equal(f.submissions.length, 2);
  assert.notEqual(f.submissions[0].sessionId, f.submissions[1].sessionId);
  assert.match(f.submissions[0].message, /parent ambient/);
  assert.doesNotMatch(f.submissions[1].message, /parent ambient/);
  assert.match(f.submissions[1].message, /thread ambient/);
  const state = await f.service.publicState();
  assert.equal(state.mappings.length, 2);
  assert.ok(state.mappings.every(route => route.inherited === true && route.agentId === 'goblin'));
  const thread = state.mappings.find(route => route.channelId === '301');
  assert.equal(thread.chatType, 'thread'); assert.equal(thread.parentId, CHANNEL);
  assert.equal(state.pending.length, 0);
  await f.service.processMessage(message('1005', { author: { ...USER, bot: true } }), BOT);
  await f.service.processMessage(message('1006', { webhook_id: '102' }), BOT);
  assert.equal(f.submissions.length, 2);
  await f.service.close();
  const restarted = fixture({ settings: f.settings, history: f.history }); t.after(() => restarted.service.close());
  await restarted.service.processMessage(message('1007'), BOT);
  assert.equal(restarted.submissions[0].sessionId, f.submissions[0].sessionId);
  assert.match(restarted.submissions[0].message, /parent ambient/);
});

test('explicit and disabled mappings override server default and survive assignment changes and revocation', async t => {
  const f = fixture(); t.after(() => f.service.close()); await enable(f);
  const route = await explicit(f);
  await f.service.configureServer(GUILD, { enabled: true });
  await f.service.processMessage(message('1001'), BOT);
  assert.equal(f.submissions[0].agentId, 'hatchet');
  await f.service.updateMapping(route.id, { enabled: false, agentId: 'hatchet' });
  await f.service.processMessage(message('1002'), BOT);
  assert.equal(f.submissions.length, 1);
  await enable(f, null);
  await f.service.processMessage(message('1003', { channel_id: '301' }), BOT);
  assert.equal((await f.service.publicState()).mappings.length, 1);
  await f.service.updateMapping(route.id, { enabled: true, agentId: 'hatchet' });
  await f.service.deleteServer(GUILD);
  await f.service.processMessage(message('1004'), BOT);
  assert.equal(f.submissions.at(-1).agentId, 'hatchet');
});

test('slash commands observe pending guilds and create inherited routes, /new and /stop preserve cancellation and idempotency', async t => {
  const f = fixture(); t.after(() => f.service.close()); await enable(f);
  await f.service.processInteraction(interaction(), BOT, f.api);
  assert.match(f.edits.at(-1), /no approved/);
  assert.deepEqual((await f.service.publicState()).pendingServers, [{ guildId: GUILD, name: 'Council guild' }]);
  assert.equal(f.requests.length, 0);
  await f.service.configureServer(GUILD, { enabled: true });
  const fresh = interaction('2001', { data: { name: 'new' } });
  await Promise.all([f.service.processInteraction(fresh, BOT, f.api), f.service.processInteraction(fresh, BOT, f.api)]);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].agentId, 'goblin');
  assert.equal((await f.service.publicState()).mappings[0].inherited, true);
  await f.service.processMessage(message('2002'), BOT);
  assert.equal(f.submissions[0].sessionId, 'fresh-1');
  assert.doesNotMatch(f.submissions[0].message, /roomHistory/);
  await f.service.processInteraction(interaction('2003', { data: { name: 'stop' } }), BOT, f.api);
  assert.deepEqual(f.cancelled, ['turn-1']);
  await f.service.processInteraction(interaction('2004', { channel_id: '301' }), BOT, f.api);
  assert.equal((await f.service.publicState()).mappings.length, 2);
  assert.ok(f.callbacks.every(body => body.type === 5 && body.data.flags === 64));
});

test('inherited agent reassignment interrupts old work and resets bindings while preserving explicit routes', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processInteraction(interaction('2001', { data: { name: 'new' } }), BOT, f.api);
  await f.service.processMessage(message('2002'), BOT);
  const inherited = (await f.service.publicState()).mappings[0];
  await f.service.processMessage(message('2003', { channel_id: '301' }), BOT);
  const thread = (await f.service.publicState()).mappings.find(route => route.channelId === '301');
  await f.service.updateMapping(thread.id, { enabled: true, agentId: 'goblin' });
  await enable(f, 'hatchet');
  const state = await f.service.publicState();
  assert.equal(state.mappings.find(route => route.id === inherited.id).agentId, 'hatchet');
  assert.equal(state.mappings.find(route => route.id === inherited.id).sessionId, null);
  assert.equal(state.mappings.find(route => route.id === thread.id).agentId, 'goblin');
  assert.equal(state.mappings.find(route => route.id === thread.id).inherited, false);
  f.setTurn({ status: 'succeeded', result: { answerText: 'old reply' } });
  await f.service.reconcile(f.api);
  assert.equal(f.sent.length, 1); // Only the explicit thread keeps its pending delivery.
  assert.equal(f.sent[0].channelId, '301');
  await f.service.processMessage(message('2004'), BOT);
  assert.equal(f.submissions.at(-1).agentId, 'hatchet');
  assert.notEqual(f.submissions.at(-1).sessionId, 'fresh-1');
});

for (const operation of ['disable', 'delete']) test(`server ${operation} blocks in-flight reads and stale replies after reapproval`, async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001'), BOT);
  let release, entered = false;
  f.context.agents.turns.read = async () => { entered = true; return new Promise(resolve => { release = resolve; }); };
  const reading = f.service.reconcile(f.api); await until(() => entered);
  const revoking = operation === 'delete' ? f.service.deleteServer(GUILD) : f.service.configureServer(GUILD, { enabled: false });
  release({ id: 'turn-1', status: 'succeeded', result: { answerText: 'stale' } });
  await reading; await revoking;
  assert.equal(f.sent.length, 0);
  assert.equal((await f.service.publicState()).deliveries[0].status, 'interrupted');
  await f.service.processMessage(message('1002'), BOT);
  assert.equal(f.submissions.length, 1);
  if (operation === 'delete') assert.equal((await f.service.publicState()).pendingServers[0].guildId, GUILD);
  await f.service.configureServer(GUILD, { enabled: true });
  f.context.agents.turns.read = async id => ({ id, status: 'succeeded', result: { answerText: 'stale' } });
  await f.service.reconcile(f.api);
  assert.equal(f.sent.length, 0);
  await f.service.processMessage(message('1003'), BOT);
  assert.equal(f.submissions.length, 2);
});

test('reconciliation rejects persisted inherited routes without approval and with mismatched assignment', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001'), BOT);
  await f.settings.set('servers', []); // Simulate legacy/corrupt persisted state, not a mutation through the worker.
  f.setTurn({ status: 'succeeded', result: { answerText: 'must not send' } });
  await f.service.reconcile(f.api);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.service.publicState()).deliveries[0].status, 'interrupted');
  await f.service.configureServer(GUILD, { enabled: true });
  await f.service.processMessage(message('1002'), BOT);
  await f.settings.set('configuration', { enabled: true, agentId: 'hatchet' });
  await f.service.reconcile(f.api);
  assert.equal(f.sent.length, 0);
});

test('revocation aborts an in-flight inherited send without restarting transport or sending later chunks', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001'), BOT);
  f.setTurn({ status: 'succeeded', result: { answerText: 'x'.repeat(4001) } });
  let entered = false, signal, attempts = 0;
  const sending = f.service.reconcile({ sendMessage: async input => {
    attempts++; entered = true; signal = input.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await until(() => entered);
  const revoking = f.service.configureServer(GUILD, { enabled: false });
  await until(() => signal.aborted);
  await sending; await revoking;
  assert.equal(attempts, 1);
  await f.service.configureServer(GUILD, { enabled: true });
  await f.service.reconcile(f.api);
  assert.equal(f.sent.length, 0);
});

test('config reassignment during a Core read suppresses the old reply, and null assignment pauses inherited routes', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001'), BOT);
  let release, entered = false;
  f.context.agents.turns.read = async () => { entered = true; return new Promise(resolve => { release = resolve; }); };
  const reading = f.service.reconcile(f.api); await until(() => entered);
  const changing = enable(f, 'hatchet');
  release({ id: 'turn-1', status: 'succeeded', result: { answerText: 'old goblin reply' } });
  await reading; await changing;
  assert.equal(f.sent.length, 0);
  assert.equal((await f.service.publicState()).deliveries[0].status, 'interrupted');
  await enable(f, null);
  await f.service.processMessage(message('1002'), BOT);
  await f.service.processInteraction(interaction(), BOT, f.api);
  assert.equal(f.submissions.length, 1);
  assert.match(f.edits.at(-1), /no approved/);
  assert.equal((await f.service.publicState()).mappings[0].agentId, null);
  await enable(f, 'hatchet');
  await f.service.processMessage(message('1003'), BOT);
  assert.equal(f.submissions.at(-1).agentId, 'hatchet');
});

test('attachment-only incoming messages still observe guild metadata without new remote access', async t => {
  const f = fixture(); t.after(() => f.service.close()); await enable(f);
  await f.service.processMessage(message('1000', { content: '' }), BOT);
  assert.deepEqual((await f.service.publicState()).pendingServers, [{ guildId: GUILD, name: 'Council guild' }]);
  assert.equal(f.requests.length, 0);
  await f.service.processMessage(message('1001', { content: '', guild_name: 'Renamed guild' }), BOT);
  assert.equal((await f.service.publicState()).pendingServers[0].name, 'Renamed guild');
});

// Invalid operator requests must not revoke a valid in-flight delivery.
test('rejected server mutations leave an authorized in-flight reply untouched', async t => {
  const f = fixture(); t.after(() => f.service.close()); await authorize(f);
  await f.service.processMessage(message('1001'), BOT);
  f.setTurn({ status: 'succeeded', result: { answerText: 'valid reply' } });
  let entered = false, signal, release;
  const sending = f.service.reconcile({ sendMessage: async input => {
    entered = true; signal = input.signal;
    return new Promise(resolve => { release = () => resolve({ id: '9999' }); });
  } });
  await until(() => entered);
  await assert.rejects(f.service.configureServer(GUILD, { enabled: 'no' }), /server_invalid/);
  await assert.rejects(f.service.configureServer(GUILD, { enabled: false, extra: 1 }), /server_invalid/);
  await assert.rejects(f.service.configureServer('999', { enabled: false }), /server_not_found/);
  await assert.rejects(f.service.deleteServer('999'), /server_not_found/);
  assert.equal(signal.aborted, false);
  release(); await sending;
  const state = await f.service.publicState();
  assert.equal(state.servers[0].enabled, true);
  assert.equal(state.deliveries.find(item => item.direction === 'inbound').status, 'delivered');
});
