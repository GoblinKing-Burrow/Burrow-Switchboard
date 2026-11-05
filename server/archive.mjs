// Separate from transport replay buffers: never stores input, answers, or secrets.
export const ARCHIVE_KEY = 'archive-history-v1';
export const ARCHIVE_LIMIT = 10_000;
const MAX_BYTES = 8_000_000;
const TERMINAL = new Set(['succeeded', 'delivered', 'failed', 'interrupted', 'unknown']);
const queues = new WeakMap();
// Shared with the writer queue: failed ordered observations retain their authority
// until a successful write, without retaining private transport replay payloads.
const pending = new WeakMap();
const RECORD_FIELDS = new Set(['id', 'recordId', 'connectionId', 'connectionName', 'transportType', 'direction', 'status', 'chatId', 'chatTitle', 'chatType', 'channelId', 'guildId', 'topicId', 'agentId', 'sessionId', 'turnId', 'at', 'createdAt', 'updatedAt', 'error']);
function validRecord(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (Object.keys(item).some(key => !RECORD_FIELDS.has(key)) || Object.values(item).some(value => typeof value !== 'string')) return false;
  if (!item.id || !item.recordId || !item.connectionId || !['telegram', 'discord'].includes(item.transportType) || !['inbound', 'outbound'].includes(item.direction) || !TERMINAL.has(item.status)) return false;
  if (['at', 'createdAt', 'updatedAt'].some(key => item[key] !== undefined && !Number.isFinite(Date.parse(item[key])))) return false;
  if (item.error !== undefined && !/^[a-z][a-z0-9_]{0,95}$/.test(item.error)) return false;
  return true;
}
const clean = (value, max = 256) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : undefined;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;

export function createArchive({ settings, clock = Date.now }) {
  const serialize = operation => {
    const result = (queues.get(settings) || Promise.resolve()).then(operation, operation);
    queues.set(settings, result.catch(() => {}));
    return result;
  };
  async function read() {
    const state = await settings.get(ARCHIVE_KEY, null);
    if (state === null) return { version: 1, records: [], startedAt: new Date(clock()).toISOString(), truncated: false, legacyImported: false };
    // Validate the value Core exposes; absence/fallback from its storage adapter
    // cannot be distinguished here from a genuinely missing value.
    if (state?.version !== 1 || !Array.isArray(state.records) || !state.records.every(validRecord)
      || new Set(state.records.map(item => item.id)).size !== state.records.length
      || !iso(state.startedAt) || typeof state.truncated !== 'boolean' || typeof state.legacyImported !== 'boolean'
      || Object.keys(state).some(key => !['version', 'records', 'startedAt', 'truncated', 'legacyImported'].includes(key))) throw new Error('archive_history_invalid');
    return state;
  }
  function record(connection, item) {
    if (!item || !TERMINAL.has(item.status) || !['inbound', 'outbound'].includes(item.direction) || !item.id) return null;
    const out = {
      id: JSON.stringify([connection.id, String(item.id)]), recordId: clean(item.id),
      connectionId: clean(connection.id), connectionName: clean(connection.name, 80),
      transportType: connection.transport || 'telegram', direction: item.direction, status: item.status,
    };
    for (const key of ['chatId', 'chatTitle', 'chatType', 'channelId', 'guildId', 'topicId', 'agentId', 'sessionId', 'turnId']) {
      const value = clean(item[key]); if (value !== undefined) out[key] = value;
    }
    for (const key of ['at', 'createdAt', 'updatedAt']) { const value = iso(item[key]); if (value) out[key] = value; }
    if (item.error) out.error = /^[a-z][a-z0-9_]{0,95}$/.test(item.error) ? item.error : 'delivery_failed';
    return out;
  }
  function merge(state, batches, allowEqual = false, retries = []) {
    const records = new Map(state.records.map(item => [item.id, item]));
    function* observations() {
      for (const { connection, deliveries, observedWrite = allowEqual } of batches) for (const item of deliveries || []) {
        const next = record(connection, item); if (next) yield { next, observedWrite: allowEqual && observedWrite };
      }
      for (const item of retries) yield { next: { ...item }, observedWrite: true };
    }
    for (const { next, observedWrite } of observations()) {
      const previous = records.get(next.id);
      // Capture-time identity is historical, not a view of renamed/deleted bots.
      if (previous) { next.connectionName = previous.connectionName; next.transportType = previous.transportType; }
      const nextTime = next.updatedAt || next.at || '';
      const previousTime = previous?.updatedAt || previous?.at || '';
      // Snapshot reads are not new observations. Equal timestamps cannot prove
      // freshness; only ordered transport writes may replace an equal-time row.
      if (!previous || nextTime > previousTime || (observedWrite && nextTime === previousTime)) records.set(next.id, next);
    }
    let list = [...records.values()].sort((a, b) => (b.at || b.createdAt || '').localeCompare(a.at || a.createdAt || '') || a.id.localeCompare(b.id));
    let truncated = state.truncated || list.length > ARCHIVE_LIMIT;
    list = list.slice(0, ARCHIVE_LIMIT);
    let bytes = 2;
    let length = 0;
    for (const item of list) { bytes += Buffer.byteLength(JSON.stringify(item)) + 1; if (bytes > MAX_BYTES) break; length++; }
    if (length < list.length) { truncated = true; list = list.slice(0, length); }
    return { ...state, records: list, truncated };
  }
  return Object.freeze({
    capture: batches => serialize(async () => {
      // Remember only real ordered writes, not surrounding replay snapshots.
      // Apply the same count/byte retention budget even during a prolonged outage.
      const retained = merge(pending.get(settings) || { records: [], truncated: false }, batches.filter(batch => batch.observedWrite !== false), true);
      pending.set(settings, retained);
      const state = await read(); const next = merge(state, batches, false, retained.records);
      next.truncated ||= retained.truncated;
      if (JSON.stringify(next) !== JSON.stringify(state)) await settings.set(ARCHIVE_KEY, next);
      pending.delete(settings);
    }),
    snapshot: source => serialize(async () => {
      // Read live buffers under the same queue as capture, not before enqueueing.
      const batches = typeof source === 'function' ? await source() : source;
      const retained = pending.get(settings);
      const state = await read(); const next = { ...merge(state, batches, false, retained?.records), legacyImported: true };
      next.truncated ||= retained?.truncated || false;
      if (!state.legacyImported || JSON.stringify(next) !== JSON.stringify(state)) await settings.set(ARCHIVE_KEY, next);
      pending.delete(settings);
      return { records: next.records, coverage: { kind: 'retained', limit: ARCHIVE_LIMIT, byteLimit: MAX_BYTES, count: next.records.length, truncated: next.truncated, startedAt: next.startedAt, legacyImported: true } };
    }),
  });
}
