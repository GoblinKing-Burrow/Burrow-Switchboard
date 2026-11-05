import { randomUUID } from 'node:crypto';
import { createArchive } from './archive.mjs';
import { createRoomHistory } from './room-history.mjs';
import { createTelegramApi, createTelegramConnection } from './telegram.mjs';
import { createDiscordApi, createDiscordConnection } from './discord.mjs';

const STATE_KEYS = ['configuration', 'transport-state', 'mappings', 'pending-admissions', 'deliveries', 'servers', 'observed-guilds', 'command-interactions'];
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
function inputObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('connection_invalid');
  return input;
}
function text(value, max, error) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(error);
  return value.trim();
}

// The original connection keeps its exact settings, secret, session and idempotency
// keys. New connections get isolated stores and workers, not a shared poll cursor.
export function createSwitchboardService(options = {}) {
  const { context, fetchImpl = fetch } = options;
  if (!context?.settings || !context?.secrets || !context?.agents) throw new Error('switchboard_context_required');
  const roomHistory = createRoomHistory({ settings: context.settings, clock: options.clock });
  const archive = createArchive({ settings: context.settings, clock: options.clock });
  const identities = new Map();
  let archiveError = false;
  let archiveRetry = false;
  const workers = new Map();
  const kinds = new Map();
  let queue = Promise.resolve();
  let started = false;
  let closed = false;
  const serialize = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  const key = (id, name) => id === 'default' ? name : `connection-${id}-${name}`;
  const kindFor = id => kinds.get(id) || 'telegram';
  const tokenKey = id => key(id, `${kindFor(id)}-bot-token`);
  async function registry() {
    let list = await context.settings.get('connections', null);
    if (list === null) {
      const state = await context.settings.get('transport-state', {});
      list = [{ id: 'default', name: 'Telegram', botId: state?.bot?.id ? String(state.bot.id) : null }];
      await context.settings.set('connections', list);
    }
    for (const item of list) {
      const kind = item.transport || 'telegram';
      if (!['telegram', 'discord'].includes(kind)) fail('connection_transport_invalid');
      kinds.set(item.id, kind);
      identities.set(item.id, { ...item, transport: kind });
    }
    return list;
  }
  async function telegramBots() {
    const list = await registry();
    return Promise.all(list.filter(item => kindFor(item.id) === 'telegram').map(async item => {
      const state = await context.settings.get(key(item.id, 'transport-state'), {});
      return { id: item.botId || state?.bot?.id, username: state?.bot?.username };
    }));
  }
  async function validateAgent(agentId) {
    if (agentId === undefined || agentId === null) return;
    text(agentId, 96, 'agent_invalid');
    const agent = (await context.agents.list()).find(item => item.id === agentId);
    if (!agent) fail('agent_not_found', 404);
    if (!agent.enabled) fail('agent_disabled', 409);
  }
  function worker(id) {
    if (!workers.has(id)) {
      const scoped = {
        ...context,
        settings: {
          get: (name, fallback) => context.settings.get(key(id, name), fallback),
          set: async (name, value) => {
            if (name !== 'deliveries') return context.settings.set(key(id, name), value);
            const previous = await context.settings.get(key(id, name), []);
            // Commit replay state first. Archive failures must never turn a
            // confirmed send into an ambiguous retry or change poll offsets.
            const result = await context.settings.set(key(id, name), value);
            try {
              const connection = identities.get(id) || { id, name: id, transport: kindFor(id) };
              // Nonterminal replay writes and timestamp-only repeats are not
              // new historical outcomes. Keep the delivery path independent of
              // ledger size until there is something new to preserve.
              const historyFields = ['id', 'direction', 'status', 'at', 'createdAt', 'chatId', 'chatTitle', 'chatType', 'channelId', 'guildId', 'topicId', 'agentId', 'sessionId', 'turnId', 'error'];
              const comparable = item => JSON.stringify(historyFields.map(field => { const value = item[field]; return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 256) : null; }));
              const before = new Map(previous.map(item => [item.id, comparable(item)]));
              const changed = value.filter(item => ['succeeded', 'delivered', 'failed', 'interrupted', 'unknown'].includes(item.status) && before.get(item.id) !== comparable(item));
              if (!changed.length && !archiveRetry) return result;
              await archive.capture([
                { connection, deliveries: previous, observedWrite: false },
                { connection, deliveries: value, observedWrite: false },
                { connection, deliveries: changed },
              ]);
              archiveRetry = false;
            } catch { await markArchiveFailure(); }
            return result;
          },
        },
        secrets: {
          get: name => context.secrets.get(key(id, name)),
          set: (name, value) => context.secrets.set(key(id, name), value),
          clear: name => context.secrets.clear(key(id, name)),
          has: name => context.secrets.has(key(id, name)),
        },
      };
      const service = kindFor(id) === 'discord'
        ? createDiscordConnection({ ...options, context: scoped, connectionId: id, discordHistorySettings: context.settings })
        : createTelegramConnection({ ...options, context: scoped, connectionId: id, roomHistory, telegramBots });
      workers.set(id, service);
      if (started && !closed) service.start();
    }
    return workers.get(id);
  }
  async function entry(id) {
    const list = await registry();
    const found = list.find(item => item.id === id);
    if (!found) fail('connection_not_found', 404);
    return { list, found };
  }
  async function publicState() {
    const list = await registry();
    const connections = await Promise.all(list.map(async item => ({ id: item.id, name: item.name, transportType: kindFor(item.id), ...await worker(item.id).publicState() })));
    const legacy = connections.find(item => item.id === 'default');
    const coreAgentTurns = connections[0]?.coreAgentTurns || (context.agents?.turns?.submit && context.agents?.turns?.read ? { available: true } : { available: false, reason: 'core_external_agent_turns_unavailable' });
    return { ...(legacy || { enabled: false, tokenConfigured: false, bot: { configured: false }, transport: { enabled: false, health: 'stopped', polling: 'stopped' }, mappings: [], pending: [], deliveries: [] }), coreAgentTurns, connections };
  }
  async function markArchiveFailure() {
    archiveError = true;
    archiveRetry = true;
    context.logger?.error('Switchboard history persistence failed');
    try { await context.settings.set('archive-history-gap', true); } catch {}
  }
  async function archiveState() {
    const list = await registry();
    const snapshot = await archive.snapshot(() => Promise.all(list.map(async connection => ({ connection: { ...connection, transport: kindFor(connection.id) }, deliveries: await context.settings.get(key(connection.id, 'deliveries'), []) }))));
    archiveRetry = false;
    if (archiveError) await context.settings.set('archive-history-gap', true);
    const captureGap = archiveError || await context.settings.get('archive-history-gap', false);
    // A prior persistence failure means records may have been lost before a
    // retry. Keep this warning even if current retained records are recovered.
    return { ...snapshot, ...(captureGap ? { warning: 'archive_capture_failed' } : {}) };
  }
  async function identity(token, kind = 'telegram') {
    let bot;
    try { bot = await (kind === 'discord' ? createDiscordApi : createTelegramApi)({ token, fetchImpl }).getMe({ signal: AbortSignal.timeout(15_000) }); }
    catch (error) { fail([`${kind}_auth_failed`, `${kind}_rate_limited`].includes(error.message) ? error.message : `${kind}_token_validation_failed`); }
    if (kind === 'discord') {
      if (typeof bot?.id !== 'string' || !/^\d{1,32}$/.test(bot.id) || bot.bot !== true) fail('discord_response_invalid');
      return { id: bot.id, username: bot.username || null, displayName: bot.global_name || bot.username || null, bot: true };
    }
    if (!bot?.id || bot.is_bot === false) fail('telegram_response_invalid');
    return { id: String(bot.id), username: bot.username || null, displayName: [bot.first_name, bot.last_name].filter(Boolean).join(' ') || null };
  }
  async function validateToken(id, token, list, boundId = null) {
    const kind = kindFor(id);
    const bot = await identity(token, kind);
    if (boundId && String(boundId) !== bot.id) fail(`${kind}_bot_changed_add_connection`, 409);
    for (const item of list) {
      if (item.id === id || kindFor(item.id) !== kind) continue;
      const state = await context.settings.get(key(item.id, 'transport-state'), {});
      let otherId = item.botId || state?.bot?.id;
      const saved = await context.secrets.get(tokenKey(item.id));
      if (saved === token) fail(`${kind}_bot_already_connected`, 409);
      // Old installations may not yet have polled once. Resolve their identity
      // before admitting another poller rather than accidentally sharing a bot.
      if (!otherId && saved) otherId = (await identity(saved, kind)).id;
      if (String(otherId || '') === bot.id) fail(`${kind}_bot_already_connected`, 409);
    }
    return bot;
  }
  async function create(input) {
    const value = inputObject(input, ['name', 'token', 'enabled', 'transport', 'agentId']);
    const name = text(value.name, 80, 'connection_name_invalid');
    const kind = value.transport ?? 'telegram';
    if (!['telegram', 'discord'].includes(kind)) fail('connection_transport_invalid');
    const token = text(value.token, 4096, `${kind}_token_invalid`);
    if (typeof value.enabled !== 'boolean') fail('connection_invalid');
    await validateAgent(value.agentId);
    const list = await registry();
    const id = randomUUID();
    kinds.set(id, kind);
    const bot = await validateToken(id, token, list);
    // Publish the registry last so a half-written creation cannot be polled.
    await context.secrets.set(tokenKey(id), token);
    try {
      await context.settings.set(key(id, 'configuration'), { enabled: value.enabled, agentId: value.agentId ?? null });
      await context.settings.set(key(id, 'transport-state'), { bot, offset: 0, health: value.enabled ? 'unknown' : 'stopped', polling: value.enabled ? 'starting' : 'stopped', error: null });
      await context.settings.set('connections', [...list, { id, name, transport: kind, botId: bot.id }]);
    } catch (error) {
      await context.secrets.clear(tokenKey(id));
      for (const name of STATE_KEYS) await context.settings.delete(key(id, name));
      throw error;
    }
    identities.set(id, { id, name, transport: kind });
    worker(id);
    return publicState();
  }
  async function configure(id, input) {
    const value = inputObject(input, ['name', 'enabled', 'token', 'agentId']);
    if (typeof value.enabled !== 'boolean') fail('configuration_invalid');
    await validateAgent(value.agentId);
    const { list, found } = await entry(id);
    const kind = kindFor(id);
    const name = value.name === undefined ? found.name : text(value.name, 80, 'connection_name_invalid');
    let token, bot;
    if (value.token !== undefined) {
      token = text(value.token, 4096, `${kind}_token_invalid`);
      const oldState = await context.settings.get(key(id, 'transport-state'), {});
      let boundId = found.botId || oldState?.bot?.id;
      const saved = await context.secrets.get(tokenKey(id));
      if (!boundId && saved && saved !== token) boundId = (await identity(saved, kind)).id;
      if (!boundId && found.bindingUnknown) fail(`${kind}_bot_changed_add_connection`, 409);
      bot = await validateToken(id, token, list, boundId);
    }
    await worker(id).configure({ enabled: value.enabled, ...(value.agentId === undefined ? {} : { agentId: value.agentId }), ...(token === undefined ? {} : { token, bot }) });
    await context.settings.set('connections', list.map(item => item.id === id ? { ...item, name, ...(bot ? { botId: bot.id } : {}) } : item));
    return publicState();
  }
  async function clearToken(id) {
    const { list, found } = await entry(id);
    const state = await context.settings.get(key(id, 'transport-state'), {});
    // Retain the bot binding even after a credential clear, so old routes and
    // pending replies can never be silently moved to a different bot.
    if (!found.botId) {
      const saved = await context.secrets.get(tokenKey(id));
      const botId = state?.bot?.id ? String(state.bot.id) : null;
      await context.settings.set('connections', list.map(item => item.id === id ? { ...item, botId, ...(!botId && saved ? { bindingUnknown: true } : {}) } : item));
    }
    await worker(id).clearToken();
    return publicState();
  }
  async function remove(id) {
    const { list, found } = await entry(id);
    // Disable first, invalidate any long-poll result, then drain this worker.
    await worker(id).clearToken();
    await worker(id).close();
    // Preserve every retained outcome before deleting the transport buffers.
    // Failure stops removal here; the disabled connection remains recoverable.
    workers.delete(id);
    const stoppedAt = new Date((options.clock || Date.now)()).toISOString();
    const retained = await context.settings.get(key(id, 'deliveries'), []);
    // This records the completed bridge stop, not Core cancellation or a
    // successful registry deletion. Never mutate frozen replay inputs.
    const stopped = retained.map(item => (['submitting', 'processing', 'sending'].includes(item.status) || (kindFor(id) === 'telegram' && item.direction === 'inbound' && item.submission && !item.turnId))
      ? { ...item, status: item.status === 'sending' ? 'unknown' : 'interrupted', error: 'connection_stopped_for_removal', updatedAt: stoppedAt }
      : item);
    await archive.capture([{ connection: { ...found, transport: kindFor(id) }, deliveries: stopped }]);
    await archiveState();
    kinds.delete(id);
    await context.settings.set('connections', list.filter(item => item.id !== id));
    for (const name of STATE_KEYS) await context.settings.delete(key(id, name));
    return publicState();
  }
  const action = (id, method, args) => serialize(async () => {
    await entry(id);
    if (typeof worker(id)[method] !== 'function') fail('connection_transport_invalid');
    await worker(id)[method](...args);
    return publicState();
  });
  function start() {
    return serialize(async () => {
      if (closed) return;
      try { await archiveState(); } catch { await markArchiveFailure(); }
      started = true;
      for (const item of await registry()) worker(item.id).start();
    });
  }
  async function close() {
    closed = true;
    await queue;
    await Promise.all([...workers.values()].map(service => service.close()));
  }
  return Object.freeze({
    start, close,
    publicState: () => serialize(publicState),
    archiveState: () => serialize(archiveState),
    createConnection: input => serialize(() => create(input)),
    configureConnection: (id, input) => serialize(() => configure(id, input)),
    clearConnectionToken: id => serialize(() => clearToken(id)),
    removeConnection: id => serialize(() => remove(id)),
    configureConnectionServer: (id, guildId, input) => action(id, 'configureServer', [guildId, input]),
    deleteConnectionServer: (id, guildId) => action(id, 'deleteServer', [guildId]),
    approveConnection: (id, routeId, input) => action(id, 'approve', [routeId, input]),
    denyConnection: (id, routeId) => action(id, 'deny', [routeId]),
    updateConnectionMapping: (id, routeId, input) => action(id, 'updateMapping', [routeId, input]),
    deleteConnectionMapping: (id, routeId) => action(id, 'deleteMapping', [routeId]),
    configure: input => serialize(() => configure('default', input)),
    clearToken: () => serialize(() => clearToken('default')),
    approve: (id, input) => action('default', 'approve', [id, input]),
    deny: id => action('default', 'deny', [id]),
    updateMapping: (id, input) => action('default', 'updateMapping', [id, input]),
    deleteMapping: id => action('default', 'deleteMapping', [id]),
    processMessage: (update, bot, id = 'default') => action(id, 'processMessage', [update, bot]),
    reconcile: (api, id = 'default') => action(id, 'reconcile', [api]),
  });
}

