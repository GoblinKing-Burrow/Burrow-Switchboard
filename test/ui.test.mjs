import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSettings, settingsSections } from '../ui/settings.js';

class FakeNode {
  constructor(tagName = '#text', text = '') { this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.parentNode = null; this._text = text; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.className = ''; this.selected = false; this.validityMessage = ''; }
  append(...nodes) { for (const value of nodes.flat()) { if (value === null || value === undefined) continue; const node = typeof value === 'string' ? new FakeNode('#text', value) : value; node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { const normalized = String(value); this.attributes.set(name, normalized); if (name === 'id') this.id = normalized; if (name === 'type') this.type = normalized; if (name === 'value') this.value = normalized; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  dispatchEvent(event) { event.target = this; event.currentTarget = this; return this.listeners.get(event.type)?.(event); }
  remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  reportValidity() { return !this.validityMessage; }
  setCustomValidity(value) { this.validityMessage = value; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
}
const documentFixture = { createElement: tag => new FakeNode(tag), createTextNode: text => new FakeNode('#text', text) };
const descendants = node => [node, ...node.children.flatMap(descendants)];
const byTag = (root, tag) => descendants(root).filter(node => node.tagName === tag.toUpperCase());
const byText = (root, tag, text) => byTag(root, tag).find(node => node.textContent === text);
const byAttr = (root, tag, name, value) => byTag(root, tag).find(node => node.getAttribute(name) === value);
const settle = () => new Promise(resolve => setImmediate(resolve));
const connection = (id, name, overrides = {}) => ({ id, name, enabled: true, tokenConfigured: true, bot: { configured: true, id: id === 'default' ? '42' : '84', username: id === 'default' ? 'switchboard_bot' : 'alerts_bot' }, transport: { enabled: true, health: 'healthy', polling: 'active', lastPollAt: '2026-10-22T15:00:00Z' }, mappings: [{ id: `map-${id}`, chatId: `-${id}`, chatTitle: `${name} Council`, chatType: 'group', agentId: 'hatchet', agentName: 'Hatchet', enabled: true }], pending: [{ id: `pending-${id}`, chatId: id, chatTitle: `${name} Rob`, chatType: 'direct', requestedAt: '2026-10-22T14:00:00Z' }], deliveries: [{ id: `delivery-${id}`, direction: 'inbound', chatTitle: `${name} Rob`, agentName: 'Hatchet', status: 'delivered', at: '2026-10-22T15:01:00Z' }], ...overrides });
const config = () => ({ connections: [connection('default', 'Primary'), connection('alerts', 'Alerts', { transportType: 'discord', transport: { kind: 'discord', enabled: true, health: 'healthy', polling: 'connected', lastPollAt: '2026-10-22T15:00:00Z' }, mappings: [{ id: 'map-alerts', chatId: 'channel-84', chatTitle: 'Alerts Council', chatType: 'channel', topicId: 'thread-7', agentId: 'hatchet', agentName: 'Hatchet', enabled: true }] })], coreAgentTurns: { available: true } });
const selectConnection = async (root, id) => { const select = byAttr(root, 'select', 'aria-label', 'Bot connection'); select.value = id; await select.dispatchEvent({ type: 'change' }); };

test.beforeEach(() => { globalThis.document = documentFixture; globalThis.confirm = () => true; });
test.afterEach(() => { delete globalThis.document; delete globalThis.confirm; });

test('Settings status selects one bot connection for scoped diagnostics', async () => {
  const root = new FakeNode('div'); const calls = [];
  const cleanup = mountSettings({ section: 'diagnostics', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [], api: async (path, init) => { calls.push({ path, init }); return config(); } });
  await settle(); assert.equal(calls[0].path, '/configuration');
  await selectConnection(root, 'alerts');
  assert.match(root.textContent, /@alerts_bot/); assert.match(root.textContent, /Alerts Council/); assert.doesNotMatch(root.textContent, /Primary Council/); assert.match(root.textContent, /Recent deliveries/);
  const signal = calls[0].init.signal; cleanup(); assert.equal(signal.aborted, true); assert.equal(root.children.length, 0);
});

test('Configuration creates Telegram and Discord connections with write-only tokens', async () => {
  assert.deepEqual(settingsSections.map(item => item.id), ['bots', 'diagnostics']);
  const root = new FakeNode('div'); const calls = []; const api = async (path, init = {}) => { calls.push({ path, init }); return config(); };
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [], api }); await settle();
  assert.deepEqual(byAttr(root, 'select', 'aria-label', 'Bot connection').children.map(option => option.textContent), ['Primary · Telegram (@switchboard_bot)', 'Alerts · Discord (@alerts_bot)']);
  await byText(root, 'button', 'Add bot connection').dispatchEvent({ type: 'click' });
  const createForm = byTag(root, 'form').find(form => form.textContent.includes('New bot connection')); const inputs = byTag(createForm, 'input');
  const provider = byAttr(createForm, 'select', 'aria-label', 'Transport'); const name = inputs.find(input => input.id === 'switchboard-new-name'); const token = inputs.find(input => input.id === 'switchboard-new-token'); const enabled = inputs.find(input => input.type === 'checkbox');
  assert.equal(provider.value, 'telegram'); provider.value = 'discord'; await provider.dispatchEvent({ type: 'change' }); assert.match(createForm.textContent, /Message Content intent/); assert.match(createForm.textContent, /View Channels, Send Messages, Read Message History, and Send Messages in Threads/); assert.equal(token.getAttribute('placeholder'), 'Paste Discord bot token');
  name.value = 'Support'; token.value = 'write-only-token'; enabled.checked = false; await createForm.dispatchEvent({ type: 'submit', preventDefault() {} }); await settle();
  const create = calls.find(call => call.path === '/connections'); assert.equal(create.init.method, 'POST'); assert.deepEqual(JSON.parse(create.init.body), { name: 'Support', token: 'write-only-token', enabled: false, transport: 'discord', agentId: null }); cleanup();
});

test('Configuration edits only the selected connection and preserves blank tokens', async () => {
  const root = new FakeNode('div'); const calls = []; const api = async (path, init = {}) => { calls.push({ path, init }); return config(); };
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [], api }); await settle(); await selectConnection(root, 'alerts');
  const form = byTag(root, 'form').find(item => !item.textContent.includes('New bot connection')); const name = byTag(form, 'input').find(input => input.id === 'switchboard-name'); const token = byTag(form, 'input').find(input => input.type === 'password'); const enabled = byTag(form, 'input').find(input => input.type === 'checkbox');
  assert.equal(token.value, ''); assert.equal(byAttr(form, 'input', 'aria-label', 'Connection transport').value, 'Discord'); assert.equal(byAttr(form, 'input', 'aria-label', 'Connection transport').getAttribute('disabled'), 'disabled'); name.value = 'Alerts renamed'; enabled.checked = false; await form.dispatchEvent({ type: 'submit', preventDefault() {} }); await settle();
  const update = calls.find(call => call.path === '/connections/alerts' && call.init.method === 'PUT'); assert.deepEqual(JSON.parse(update.init.body), { name: 'Alerts renamed', enabled: false, agentId: null });
  token.value = 'same-bot-token'; await form.dispatchEvent({ type: 'submit', preventDefault() {} }); await settle(); assert.equal(JSON.parse(calls.filter(call => call.path === '/connections/alerts').at(-1).init.body).token, 'same-bot-token'); cleanup();
});

test('Credential clearing and connection removal are separate scoped destructive actions', async () => {
  const root = new FakeNode('div'); const calls = []; const api = async (path, init = {}) => { calls.push({ path, init }); return config(); };
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [], api }); await settle(); await selectConnection(root, 'alerts');
  await byText(root, 'button', 'Clear configured token').dispatchEvent({ type: 'click' }); await settle(); assert.ok(calls.some(call => call.path === '/connections/alerts/token/clear' && call.init.method === 'POST'));
  await selectConnection(root, 'alerts'); await byText(root, 'button', 'Remove connection').dispatchEvent({ type: 'click' }); await settle(); assert.ok(calls.some(call => call.path === '/connections/alerts' && call.init.method === 'DELETE')); cleanup();
});

test('Pending admissions use the selected connection scoped routes', async () => {
  const root = new FakeNode('div'); const calls = [];
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [{ id: 'hatchet', name: 'Hatchet', enabled: true }, { id: 'sleepy', name: 'Sleepy', enabled: false }], api: async (path, init = {}) => { calls.push({ path, init }); return config(); } }); await settle(); await selectConnection(root, 'alerts');
  assert.equal(byTag(root, 'option').some(option => option.value === 'sleepy'), false); assert.match(root.textContent, /Alerts Rob/); assert.doesNotMatch(root.textContent, /Primary Rob/);
  const agent = byAttr(root, 'select', 'aria-label', 'Agent for Alerts Rob'); agent.value = 'hatchet'; await byText(root, 'button', 'Approve').dispatchEvent({ type: 'click' }); await settle();
  assert.deepEqual(JSON.parse(calls.find(call => call.path === '/connections/alerts/pending/pending-alerts/approve').init.body), { agentId: 'hatchet' });
  await selectConnection(root, 'alerts'); await byText(root, 'button', 'Deny').dispatchEvent({ type: 'click' }); await settle(); assert.ok(calls.some(call => call.path === '/connections/alerts/pending/pending-alerts/deny')); cleanup();
});

test('Mappings save and delete through the selected connection', async () => {
  const root = new FakeNode('div'); const calls = []; const confirmations = [];
  globalThis.confirm = value => { confirmations.push(value); return true; };
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [{ id: 'hatchet', name: 'Hatchet' }, { id: 'smatchet', name: 'Smatchet' }], api: async (path, init = {}) => { calls.push({ path, init }); return config(); } }); await settle(); await selectConnection(root, 'alerts');
  const agent = byAttr(root, 'select', 'aria-label', 'Agent for Alerts Council'); const enabled = byAttr(root, 'input', 'aria-label', 'Enable Alerts Council'); agent.value = 'smatchet'; enabled.checked = false; await byText(root, 'button', 'Save').dispatchEvent({ type: 'click' }); await settle();
  const update = calls.find(call => call.path === '/connections/alerts/mappings/map-alerts' && call.init.method === 'PUT'); assert.deepEqual(JSON.parse(update.init.body), { agentId: 'smatchet', enabled: false });
  await selectConnection(root, 'alerts'); await byText(root, 'button', 'Delete').dispatchEvent({ type: 'click' }); await settle();
  const remove = calls.find(call => call.path === '/connections/alerts/mappings/map-alerts' && call.init.method === 'DELETE'); assert.ok(remove); assert.equal(remove.init.body, undefined);
  assert.match(confirmations.at(-1), /only this bot connection’s Switchboard mapping/); assert.match(confirmations.at(-1), /does not delete the Discord chat or affect other bots/); assert.match(confirmations.at(-1), /Inherited group or server access/); cleanup();
});

test('Mapping deletion stops when confirmation is cancelled', async () => {
  globalThis.confirm = () => false;
  const root = new FakeNode('div'); const calls = [];
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [{ id: 'hatchet', name: 'Hatchet' }], api: async (path, init = {}) => { calls.push({ path, init }); return config(); } }); await settle();
  await byText(root, 'button', 'Delete').dispatchEvent({ type: 'click' }); await settle();
  assert.equal(calls.some(call => call.init.method === 'DELETE'), false); cleanup();
});

test('Legacy top-level configuration remains the default connection and failed reads are retry-only', async () => {
  const legacy = connection('default', 'Default bot'); delete legacy.id; delete legacy.name;
  const root = new FakeNode('div'); const cleanup = mountSettings({ section: 'diagnostics', primary: { replace: nodes => root.replaceChildren(nodes) }, api: async () => ({ ...legacy, coreAgentTurns: { available: true } }) }); await settle(); assert.match(root.textContent, /Default bot/); assert.match(root.textContent, /@switchboard_bot/); cleanup();
  assert.equal(mountSettings({ section: 'other', primary: { replace() { throw Error('must not mount'); } }, api: async () => ({}) }), undefined);
  const failedRoot = new FakeNode('div'); const failedCleanup = mountSettings({ section: 'bots', primary: { replace: nodes => failedRoot.replaceChildren(nodes) }, api: async () => { throw Error('offline'); } }); await settle();
  assert.equal(descendants(failedRoot).find(node => node.getAttribute('role') === 'alert')?.textContent, 'offline'); assert.ok(byText(failedRoot, 'button', 'Retry')); assert.equal(byText(failedRoot, 'button', 'Save connection'), undefined); failedCleanup();
});

test('Bots saves the assigned goblin and approvals inherit it without an explicit override', async () => {
  const root = new FakeNode('div'); const calls = [];
  const data = config(); data.connections[0].agentId = 'hatchet';
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [{ id: 'hatchet', name: 'Hatchet' }], api: async (path, init = {}) => { calls.push({ path, init }); return data; } }); await settle(); await selectConnection(root, 'default');
  assert.equal(byAttr(root, 'select', 'aria-label', 'Assigned goblin').value, 'hatchet');
  const details = byTag(root, 'details').find(node => node.textContent.includes('Room overrides')); assert.ok(details); assert.equal(details.getAttribute('open'), null);
  await byText(root, 'button', 'Approve').dispatchEvent({ type: 'click' }); await settle();
  assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('/approve')).init.body), {});
  const assigned = byAttr(root, 'select', 'aria-label', 'Assigned goblin'); assigned.value = '';
  await byTag(root, 'form')[0].dispatchEvent({ type: 'submit', preventDefault() {} }); await settle();
  assert.equal(JSON.parse(calls.find(call => call.path === '/connections/default' && call.init.method === 'PUT').init.body).agentId, null); cleanup();
});

test('Discord server approval, pause and revocation are connection scoped', async () => {
  const root = new FakeNode('div'); const calls = []; const data = config();
  data.connections[1].agentId = 'hatchet'; data.connections[1].servers = [{ guildId: '123', name: 'Council', enabled: true }]; data.connections[1].pendingServers = [{ guildId: '456', name: 'Workshop' }];
  const cleanup = mountSettings({ section: 'bots', primary: { replace: nodes => root.replaceChildren(nodes) }, agents: [{ id: 'hatchet', name: 'Hatchet' }], api: async (path, init = {}) => { calls.push({ path, init }); return data; } }); await settle(); await selectConnection(root, 'alerts');
  await byText(root, 'button', 'Approve server').dispatchEvent({ type: 'click' }); await settle();
  await byText(root, 'button', 'Pause server').dispatchEvent({ type: 'click' }); await settle();
  await byText(root, 'button', 'Revoke').dispatchEvent({ type: 'click' }); await settle();
  assert.ok(calls.some(call => call.path === '/connections/alerts/servers/456' && JSON.parse(call.init.body).enabled === true));
  assert.ok(calls.some(call => call.path === '/connections/alerts/servers/123' && call.init.method === 'PUT' && JSON.parse(call.init.body).enabled === false));
  assert.ok(calls.some(call => call.path === '/connections/alerts/servers/123' && call.init.method === 'DELETE')); cleanup();
});

 test('Legacy settings links render the unified Bots view', async () => {
  for (const section of ['configuration', 'pending-admissions', 'chat-mappings']) {
    const root = new FakeNode('div');
    const cleanup = mountSettings({ section, primary: { replace: nodes => root.replaceChildren(nodes) }, api: async () => config() });
    await settle(); assert.ok(byText(root, 'h2', 'Bots')); assert.ok(byText(root, 'h3', 'Chat access') || byText(root, 'h3', 'Server access')); cleanup();
  }
 });
