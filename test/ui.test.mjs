import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSettings, settingsSections } from '../ui/settings.js';

// This is a deliberately small DOM for exercising rendered source and event handlers;
// it is not a browser, layout, or accessibility-tree acceptance test.
class FakeNode {
  constructor(tagName = '#text', text = '') {
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentNode = null;
    this._text = text;
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.selected = false;
    this.className = '';
    this.validityMessage = '';
  }
  get children() { return this.childNodes.filter(node => node.tagName !== '#TEXT'); }
  append(...values) {
    for (const value of values.flat()) {
      if (value === null || value === undefined) continue;
      const node = typeof value === 'string' ? new FakeNode('#text', value) : value;
      node.remove(); // append moves existing nodes, including the optional detail panel.
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this._text = '';
    this.append(...nodes);
  }
  setAttribute(name, value) {
    assert.notEqual(name.toLowerCase(), 'style', 'mod-local inline styles are forbidden');
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id' || name === 'type') this[name] = normalized;
    if (name === 'value') this.value = normalized;
    if (name === 'disabled') this.disabled = true;
    if (name === 'required') this.required = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get value() {
    if (this.tagName === 'SELECT') return this.children.find(option => option.selected)?.value ?? '';
    return this._value;
  }
  set value(value) {
    const normalized = String(value);
    if (this.tagName === 'SELECT') {
      let found = false;
      for (const option of this.children) {
        option.selected = !found && option.value === normalized;
        if (option.selected) found = true;
      }
    } else this._value = normalized;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }
  querySelectorAll(selector) {
    assert.equal(selector, '[data-focus]', `Unsupported fixture selector: ${selector}`);
    return descendants(this).slice(1).filter(node => node.getAttribute('data-focus') !== null);
  }
  focus() { document.activeElement = this; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
    this.parentNode = null;
  }
  reportValidity() {
    return descendants(this).every(node => node.disabled || (!node.validityMessage && (!node.required || Boolean(node.value))));
  }
  setCustomValidity(value) { this.validityMessage = value; }
  set innerHTML(_value) { assert.fail('Settings must not render untrusted data with innerHTML'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
}

const makeDocument = () => ({
  createElement: tag => { assert.notEqual(String(tag).toLowerCase(), 'style', 'mod-local styles are forbidden'); return new FakeNode(tag); },
  createTextNode: text => new FakeNode('#text', String(text)),
  activeElement: null,
  hidden: false,
});
const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
const byTag = (root, tag) => descendants(root).filter(node => node.tagName === tag.toUpperCase());
const byText = (root, tag, text) => byTag(root, tag).find(node => node.textContent === text);
const byAttr = (root, tag, name, value) => byTag(root, tag).find(node => node.getAttribute(name) === value);
const byClass = (root, className) => descendants(root).filter(node => node.className?.split(/\s+/).includes(className));
const need = (node, description) => { assert.ok(node, `Expected ${description}`); return node; };
const button = (root, text) => need(byText(root, 'button', text), `button ${JSON.stringify(text)}`);
const named = (root, tag, name) => need(byAttr(root, tag, 'aria-label', name), `${tag} named ${JSON.stringify(name)}`);
const form = (root, name) => named(root, 'form', name);
const input = (root, id) => need(byAttr(root, 'input', 'id', id), `input #${id}`);
const settle = () => new Promise(resolve => setImmediate(resolve));
const click = async node => {
  need(node, 'click target');
  assert.equal(node.disabled, false, `Cannot user-click disabled ${node.getAttribute('aria-label') || node.textContent}`);
  node.dispatchEvent({ type: 'click' });
  await settle();
};
const setValue = async (node, value, event = 'change') => {
  need(node, 'control');
  node.value = value;
  node.dispatchEvent({ type: event });
  await settle();
};
const setChecked = async (node, value) => {
  node.checked = value;
  node.dispatchEvent({ type: 'change' });
  await settle();
};
const submit = async node => { node.dispatchEvent({ type: 'submit' }); await settle(); };
const body = call => JSON.parse(call.init.body);
const writes = calls => calls.filter(call => call.init.method && call.init.method !== 'GET');
const clone = value => structuredClone(value);

const agents = [
  { id: 'hatchet', name: 'Hatchet', enabled: true },
  { id: 'smatchet', name: 'Smatchet', enabled: true },
  { id: 'sleepy', name: 'Sleepy', enabled: false },
];
const connection = (id, name, overrides = {}) => ({
  id, name, transportType: 'telegram', enabled: true, agentId: null, tokenConfigured: true,
  bot: { configured: true, id: id === 'default' ? '42' : '84', username: id === 'default' ? 'switchboard_bot' : 'alerts_bot' },
  transport: { enabled: true, health: 'healthy', polling: 'active', lastPollAt: '2026-10-22T15:00:00Z' },
  mappings: [{ id: `map-${id}`, chatId: `-${id}`, chatTitle: `${name} Council`, chatType: 'group', agentId: 'hatchet', agentName: 'Hatchet', inheritedAgent: false, enabled: true }],
  pending: [{ id: `pending-${id}`, chatId: id, chatTitle: `${name} Rob`, chatType: 'direct', requestedAt: '2026-10-22T14:00:00Z' }],
  deliveries: [{ id: `delivery-${id}`, direction: 'inbound', chatTitle: `${name} Rob`, agentId: 'hatchet', status: 'delivered', at: '2026-10-22T15:01:00Z' }],
  ...overrides,
});
const config = () => ({
  connections: [
    connection('default', 'Primary'),
    connection('alerts', 'Alerts', {
      transportType: 'discord',
      transport: { enabled: true, health: 'healthy', polling: 'connected', lastPollAt: '2026-10-22T15:00:00Z' },
      mappings: [{ id: 'map-alerts', chatId: 'channel-84', chatTitle: 'Alerts Council', chatType: 'channel', topicId: 'thread-7', agentId: 'hatchet', inheritedAgent: false, enabled: true }],
    }),
  ],
  coreAgentTurns: { available: true },
});

function setup(t, { section = 'bots', initial = config(), overflow = false, onRequest, availableAgents = agents, hostMethods = true } = {}) {
  let state = clone(initial);
  const calls = [];
  const root = new FakeNode('div');
  const primary = new FakeNode('div');
  const overflowRoot = new FakeNode('div');
  root.append(primary, overflowRoot);
  const region = node => ({ replace: value => node.replaceChildren(...(Array.isArray(value) ? value : [value])) });
  const api = async (path, init = {}) => {
    const call = { path, init };
    calls.push(call);
    const result = onRequest ? await onRequest({ call, calls, state, setState: next => { state = next; } }) : state;
    return clone(result);
  };
  // Small adapter, not the Burrow-UI provider: capture the mod's live scope and
  // simulate a host decision only when navigate is called. Provider behavior is
  // tested in Burrow-UI, not inferred from this fake.
  const host = {
    draft: null, snapshots: [], confirmations: [], navigations: [],
    decisions: [], confirmDecisions: [], disposed: false,
    setDraft(snapshot) {
      if (host.disposed) return;
      host.draft = snapshot;
      host.snapshots.push(snapshot);
    },
    async confirm(options) {
      if (host.disposed) return false;
      host.confirmations.push(options);
      const answer = await (host.confirmDecisions.length ? host.confirmDecisions.shift() : true);
      return !host.disposed && answer === true;
    },
    navigate(proceed) {
      if (host.disposed) return;
      const snapshot = host.draft;
      host.navigations.push({ dirty: !!snapshot?.dirty, busy: !!snapshot?.busy });
      if (snapshot?.busy) return;
      if (!snapshot?.dirty) { proceed(); return; }
      const decision = host.decisions.shift() || 'stay';
      if (decision === 'discard') { snapshot.discard(); if (!host.disposed) proceed(); }
      if (decision === 'save') void snapshot.save().then(ok => {
        if (ok && !host.disposed && !host.draft?.dirty && !host.draft?.busy) proceed();
      });
    },
  };
  const methods = Object.fromEntries(['confirm', 'navigate', 'setDraft'].filter(key => hostMethods === true || (Array.isArray(hostMethods) && hostMethods.includes(key))).map(key => [key, host[key]]));
  const cleanup = mountSettings({ section, primary: region(primary), ...(overflow ? { overflow: region(overflowRoot) } : {}), agents: availableAgents, api, ...methods });
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; cleanup?.(); host.disposed = true; } };
  t.after(unmount);
  return { root, primary, overflowRoot, calls, host, unmount, state: () => state, setState: next => { state = next; } };
}
const chooseBot = async (fixture, name) => click(named(fixture.root, 'button', `Manage ${name}`));
const openBot = async (fixture, name = 'Primary') => { await chooseBot(fixture, name); form(fixture.primary, 'Edit bot'); };
const row = (root, name) => named(root, 'article', name);
const requestRow = (root, name) => row(root, `Request from ${name}`);
const changeChat = async (root, name) => click(named(row(root, name), 'button', `Change ${name}`));
const selectOptionWithText = (select, text) => need(select.children.find(option => option.textContent.includes(text)), `option containing ${text}`);

// Capture the actual polling callback so races can be driven without wall-clock timers.
function setupAutoRefresh(t, options = {}) {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const handle = { unref() {} };
  let tick, delay;
  globalThis.setInterval = (callback, ms) => { tick = callback; delay = ms; return handle; };
  globalThis.clearInterval = value => { assert.equal(value, handle); };
  const restore = () => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; };
  let fixture;
  try { fixture = setup(t, options); } catch (error) { restore(); throw error; }
  // Explicit unmount keeps timer cleanup correct regardless of after-hook ordering.
  t.after(() => { try { fixture.unmount(); } finally { restore(); } });
  return { ...fixture, tick: () => { assert.equal(delay, 10_000); need(tick, 'refresh timer')(); } };
}

const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};

test.beforeEach(() => { globalThis.document = makeDocument(); globalThis.confirm = () => { throw Error('native confirm is not permitted'); }; globalThis.alert = () => { throw Error('native alert is not permitted'); }; globalThis.prompt = () => { throw Error('native prompt is not permitted'); }; });
test.afterEach(() => { delete globalThis.document; delete globalThis.confirm; delete globalThis.alert; delete globalThis.prompt; });

for (const overflow of [false, true]) {
  test(`Primary Add form and compact inventory use shared Settings composition (${overflow ? 'overflow' : 'fallback'})`, async t => {
    assert.deepEqual(settingsSections.map(item => item.id), ['bots', 'diagnostics']);
    const f = setup(t, { overflow }); await settle();
    const panel = named(f.primary, 'section', 'Switchboard bots');
    assert.ok(byClass(panel, 'setting-section').includes(panel));
    const add = form(f.primary, 'Add bot');
    assert.equal(input(add, 'switchboard-name').value, '');
    assert.equal(input(add, 'switchboard-token').value, '');
    assert.ok(byClass(add, 'settings-form').includes(add));
    assert.equal(byClass(add, 'settings-field-pair').length, 1);
    assert.equal(byTag(add, 'h2').length, 0);
    assert.equal(byTag(panel, 'h2')[0].textContent, 'Add bot');
    const support = overflow ? f.overflowRoot : f.primary;
    const list = need(byClass(support, 'memory-connection-list')[0], 'compact inventory');
    assert.equal(byClass(list, 'memory-connection').length, 2);
    const primaryCard = named(list, 'button', 'Manage Primary');
    assert.ok(byClass(primaryCard, 'memory-connection-select').includes(primaryCard));
    assert.equal(primaryCard.getAttribute('aria-pressed'), 'false');
    assert.match(primaryCard.textContent, /Telegram · Connected/);
    assert.match(primaryCard.textContent, /Hatchet · set per chat/);
    assert.match(primaryCard.textContent, /1 waiting for approval/);
    assert.equal(byClass(f.primary, 'memory-connection-list').length, overflow ? 0 : 1);
    assert.equal(byClass(f.overflowRoot, 'memory-connection-list').length, overflow ? 1 : 0);
    if (!overflow) {
      const fallback = need(byTag(f.primary, 'details').find(node => node.textContent.includes('Saved bots')), 'disclosed fallback');
      assert.ok(byClass(fallback, 'saved-accordion').includes(fallback));
      assert.ok(descendants(fallback).includes(list));
    }
    await chooseBot(f, 'Primary');
    const edit = form(f.primary, 'Edit bot');
    assert.equal(input(edit, 'switchboard-name').value, 'Primary');
    assert.equal(named(support, 'button', 'Manage Primary').getAttribute('aria-pressed'), 'true');
    assert.match(f.primary.textContent, /Primary Council/);
    assert.match(f.primary.textContent, /Hatchet answers/);
    assert.match(f.primary.textContent, /Existing chats keep their own assignments/);
    assert.equal(byText(f.root, 'button', 'Edit bot'), undefined, 'Manage opens the complete editor directly');
    assert.equal(byTag(f.root, 'style').length, 0);
    assert.equal(byTag(f.root, 'link').length, 0);
    await chooseBot(f, 'Alerts');
    assert.equal(named(support, 'button', 'Manage Alerts').getAttribute('aria-pressed'), 'true');
    assert.match(f.primary.textContent, /Alerts Council/);
    assert.doesNotMatch(f.primary.textContent, /Primary Council/);
    assert.match(f.primary.textContent, /Channel and thread exceptions/);
    const signal = f.calls[0].init.signal;
    f.unmount();
    assert.equal(signal.aborted, true);
    assert.equal(f.host.draft, null);
    assert.equal(f.primary.childNodes.length, 0);
    assert.equal(f.overflowRoot.childNodes.length, 0);
  });
}

test('Edit bot scopes the form save, keeps a blank token, and permits an explicit replacement token', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/alerts' && call.init.method === 'PUT') {
      const update = body(call);
      Object.assign(state.connections[1], { name: update.name, enabled: update.enabled, ...(Object.hasOwn(update, 'agentId') ? { agentId: update.agentId } : {}) });
      state.connections[1].transport.enabled = update.enabled;
    }
    return state;
  } }); await settle(); await openBot(f, 'Alerts');
  let edit = form(f.root, 'Edit bot');
  assert.equal(byAttr(edit, 'select', 'aria-label', 'Messaging app'), undefined, 'transport is immutable on edit');
  assert.match(edit.textContent, /Discord/);
  assert.equal(input(edit, 'switchboard-token').value, '');
  assert.equal(input(edit, 'switchboard-name').parentNode.tagName, 'LABEL');
  assert.equal(input(edit, 'switchboard-token').parentNode.tagName, 'LABEL');
  await setValue(input(edit, 'switchboard-name'), '  Alerts renamed  ', 'input');
  await setChecked(named(edit, 'input', 'Receive messages'), false);
  await setValue(named(edit, 'select', 'Who answers new chats'), 'hatchet');
  await submit(edit);
  assert.equal(writes(f.calls).length, 1);
  assert.equal(writes(f.calls)[0].path, '/connections/alerts');
  assert.equal(writes(f.calls)[0].init.method, 'PUT');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Alerts renamed', enabled: false, agentId: 'hatchet' });
  edit = form(f.primary, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'Alerts renamed');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(button(edit, 'Save bot').disabled, true);
  await submit(edit); assert.equal(writes(f.calls).length, 1, 'unchanged resubmission makes no write');
  await openBot(f, 'Alerts renamed'); edit = form(f.root, 'Edit bot');
  await setValue(input(edit, 'switchboard-token'), '  replacement-token  ', 'input');
  await submit(edit);
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Alerts renamed', enabled: false, token: 'replacement-token' });
  assert.doesNotMatch(f.root.textContent, /replacement-token/);
});

for (const transport of ['telegram', 'discord']) {
  test(`Add bot creates ${transport} and selects the newly returned connection`, async t => {
    const f = setup(t, { onRequest: ({ call, state }) => {
      if (call.path === '/connections' && call.init.method === 'POST') {
        return { ...state, connections: [...state.connections, connection('new-id', 'Support', { transportType: transport, agentId: 'smatchet', enabled: false, transport: { enabled: false, health: 'paused' } })] };
      }
      return state;
    } });
    await settle(); await chooseBot(f, 'Primary'); await click(button(f.root, 'Add bot'));
    let add = form(f.root, 'Add bot');
    const provider = named(add, 'select', 'Messaging app');
    assert.equal(provider.value, 'telegram');
    if (transport === 'discord') {
      await setValue(provider, 'discord'); add = form(f.root, 'Add bot');
      assert.match(add.textContent, /Message Content Intent/);
      assert.match(add.textContent, /view channels, send messages, read message history and send messages in threads/i);
      assert.equal(input(add, 'switchboard-token').getAttribute('placeholder'), 'Paste Discord bot token');
    } else assert.match(add.textContent, /BotFather/);
    await setValue(input(add, 'switchboard-name'), 'Support', 'input');
    await setValue(input(add, 'switchboard-token'), 'secret', 'input');
    await setValue(named(add, 'select', 'Who answers new chats'), 'smatchet');
    await setChecked(named(add, 'input', 'Receive messages'), false);
    await submit(add);
    assert.deepEqual(body(writes(f.calls)[0]), { name: 'Support', enabled: false, agentId: 'smatchet', token: 'secret', transport });
    assert.equal(named(f.root, 'button', 'Manage Support').getAttribute('aria-pressed'), 'true');
    assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Support');
    assert.equal(named(form(f.primary, 'Edit bot'), 'input', 'Receive messages').checked, false);
    assert.equal(named(form(f.primary, 'Edit bot'), 'select', 'Who answers new chats').value, 'smatchet');
    assert.equal(f.host.draft.dirty, false);
    assert.equal(button(form(f.primary, 'Edit bot'), 'Save bot').disabled, true);
    assert.doesNotMatch(f.root.textContent, /secret/);
  });
}

test('An explicit empty connections array stays empty even when legacy top-level fields exist', async t => {
  const initial = { ...connection('default', 'Legacy ghost'), connections: [], coreAgentTurns: { available: true } };
  const f = setup(t, { initial }); await settle();
  assert.match(f.root.textContent, /No bots connected yet/);
  assert.ok(form(f.primary, 'Add bot'));
  assert.equal(byAttr(f.root, 'button', 'aria-label', 'Manage Legacy ghost'), undefined);
  assert.doesNotMatch(f.root.textContent, /@switchboard_bot/);
  const d = setup(t, { section: 'diagnostics', initial }); await settle();
  assert.match(d.root.textContent, /Open Bots to add a bot/);
  assert.equal(byTag(d.root, 'select').length, 0);
});

test('Pending approval distinguishes inherited default, explicit agent, and no default', async t => {
  const initial = config(); initial.connections[0].agentId = 'hatchet';
  const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Primary');
  let pending = requestRow(f.root, 'Primary Rob');
  let select = named(pending, 'select', 'Who answers in Primary Rob');
  assert.match(selectOptionWithText(select, 'bot default').textContent, /Hatchet/);
  assert.equal(select.value, selectOptionWithText(select, 'bot default').value);
  assert.equal(select.children.some(option => option.value === 'sleepy'), false);
  await click(button(pending, 'Allow chat'));
  assert.deepEqual(body(writes(f.calls).at(-1)), {});
  assert.equal(writes(f.calls).at(-1).path, '/connections/default/pending/pending-default/approve');
  pending = requestRow(f.root, 'Primary Rob'); select = named(pending, 'select', 'Who answers in Primary Rob');
  await setValue(select, 'smatchet'); await click(button(pending, 'Allow chat'));
  assert.deepEqual(body(writes(f.calls).at(-1)), { agentId: 'smatchet' });
  await chooseBot(f, 'Alerts'); pending = requestRow(f.root, 'Alerts Rob');
  select = named(pending, 'select', 'Who answers in Alerts Rob');
  assert.equal(select.value, '');
  const before = writes(f.calls).length;
  await click(button(pending, 'Allow chat'));
  assert.equal(writes(f.calls).length, before);
  assert.equal(select.validityMessage, 'Choose an enabled goblin.');
  await setValue(select, 'hatchet'); await click(button(pending, 'Allow chat'));
  assert.equal(writes(f.calls).at(-1).path, '/connections/alerts/pending/pending-alerts/approve');
  assert.deepEqual(body(writes(f.calls).at(-1)), { agentId: 'hatchet' });
});

test('Pause and resume send only enabled and retain inherited mapping assignment', async t => {
  const initial = config(); initial.connections[0].agentId = 'hatchet'; initial.connections[0].mappings[0].inheritedAgent = true;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      state.connections[0].mappings[0].enabled = body(call).enabled;
    }
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary');
  assert.match(row(f.root, 'Primary Council').textContent, /Hatchet answers · uses bot default/);
  await click(named(f.root, 'button', 'Pause Primary Council'));
  assert.deepEqual(body(writes(f.calls)[0]), { enabled: false });
  assert.equal(f.state().connections[0].mappings[0].inheritedAgent, true);
  assert.match(row(f.root, 'Primary Council').textContent, /Paused/);
  await click(named(f.root, 'button', 'Resume Primary Council'));
  assert.deepEqual(body(writes(f.calls)[1]), { enabled: true });
  assert.equal(writes(f.calls)[1].path, '/connections/default/mappings/map-default');
  assert.equal(f.state().connections[0].mappings[0].inheritedAgent, true);
  assert.match(row(f.root, 'Primary Council').textContent, /uses bot default/);
});

test('Edit chat saves an explicit override or null for the bot default', async t => {
  const initial = config(); initial.connections[0].agentId = 'hatchet'; initial.connections[0].mappings[0].inheritedAgent = true;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      const update = body(call); Object.assign(state.connections[0].mappings[0], { enabled: update.enabled, inheritedAgent: update.agentId === null, agentId: update.agentId ?? state.connections[0].agentId });
    }
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary'); await changeChat(f.root, 'Primary Council');
  let select = named(f.root, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, selectOptionWithText(select, 'bot default').value);
  assert.equal(byText(form(f.primary, 'Edit Primary Council'), 'button', 'Save chat'), undefined);
  await setValue(select, 'smatchet');
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: 'smatchet', enabled: true });
  assert.ok(form(f.primary, 'Edit Primary Council'), 'successful chat save keeps the primary editor open');
  assert.equal(f.host.draft.dirty, false);
  assert.match(form(f.primary, 'Edit Primary Council').textContent, /saved/i);
  assert.equal(byText(form(f.primary, 'Edit Primary Council'), 'button', 'Retry saving'), undefined);
  select = named(f.root, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, 'smatchet');
  await setValue(select, selectOptionWithText(select, 'bot default').value);
  assert.deepEqual(body(writes(f.calls)[1]), { agentId: null, enabled: true });
  assert.equal(named(f.root, 'select', 'Who answers in Primary Council').value, '__bot_default__');
  assert.equal(f.host.draft.dirty, false);
  await click(button(form(f.root, 'Edit Primary Council'), 'Cancel'));
  assert.match(row(f.root, 'Primary Council').textContent, /Hatchet answers · uses bot default/);
});

test('Bot draft survives refresh and a failed save; retry uses the preserved values', async t => {
  let failSave = true;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      if (failSave) { failSave = false; throw Error('telegram_auth_failed'); }
      const update = body(call); Object.assign(state.connections[0], { name: update.name, enabled: update.enabled, agentId: update.agentId });
      state.connections[0].transport.enabled = update.enabled;
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.root, 'Edit bot');
  await setValue(input(edit, 'switchboard-name'), 'Unfinished name', 'input');
  await setValue(input(edit, 'switchboard-token'), 'unfinished-token', 'input');
  await setValue(named(edit, 'select', 'Who answers new chats'), 'smatchet');
  await setChecked(named(edit, 'input', 'Receive messages'), false);
  f.state().connections[0].pending.push({ id: 'another', chatTitle: 'New request', chatType: 'direct' });
  await click(button(f.root, 'Refresh'));
  edit = form(f.root, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'Unfinished name');
  assert.equal(input(edit, 'switchboard-token').value, 'unfinished-token');
  assert.equal(named(edit, 'select', 'Who answers new chats').value, 'smatchet');
  assert.equal(named(edit, 'input', 'Receive messages').checked, false);
  await submit(edit);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'save error').textContent, /Telegram rejected this token/);
  edit = form(f.root, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'Unfinished name');
  assert.equal(input(edit, 'switchboard-token').value, 'unfinished-token');
  assert.equal(named(edit, 'select', 'Who answers new chats').value, 'smatchet');
  assert.equal(named(edit, 'input', 'Receive messages').checked, false);
  await submit(edit);
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Unfinished name', enabled: false, agentId: 'smatchet', token: 'unfinished-token' });
  edit = form(f.root, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'Unfinished name');
  assert.equal(input(edit, 'switchboard-token').value, '');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(button(edit, 'Save bot').disabled, true);
});

test('A chat-only draft survives refresh and a failed save, then accepts the saved baseline', async t => {
  let failSave = true;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      if (failSave) { failSave = false; throw Error('agent_disabled'); }
      state.connections[0].mappings[0].agentId = body(call).agentId;
    }
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary'); await changeChat(f.root, 'Primary Council');
  assert.ok(form(f.primary, 'Edit Primary Council'));
  assert.equal(byAttr(f.primary, 'form', 'aria-label', 'Edit bot'), undefined);
  assert.equal(byAttr(f.primary, 'article', 'aria-label', 'Primary Council'), undefined);
  await setValue(named(f.root, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(writes(f.calls).length, 1, 'selection immediately attempts the save');
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'save error').textContent, /disabled/);
  assert.equal(f.host.draft.dirty, true);
  f.state().connections[0].pending.push({ id: 'new', chatTitle: 'New arrival', chatType: 'direct' });
  await click(button(f.root, 'Refresh'));
  assert.equal(named(f.root, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.match(named(f.root, 'button', 'Manage Primary').textContent, /2 waiting/);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'preserved save error').textContent, /disabled/);
  assert.equal(f.host.draft.dirty, true);
  const captured = f.host.draft;
  assert.equal(await captured.save(), true);
  assert.equal(writes(f.calls).length, 2);
  assert.deepEqual(body(writes(f.calls).at(-1)), { agentId: 'smatchet', enabled: true });
  assert.ok(form(f.primary, 'Edit Primary Council'));
  assert.equal(f.host.draft.dirty, false);
  assert.equal(byText(form(f.primary, 'Edit Primary Council'), 'button', 'Retry saving'), undefined);
  await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.match(row(f.primary, 'Primary Council').textContent, /Smatchet answers/);
});

test('Host guard sees dirty bot/chat scopes; Stay and Discard control editor transitions', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } }); await settle(); await openBot(f);
  assert.equal(f.host.draft.dirty, false);
  const before = f.host.navigations.length;
  await chooseBot(f, 'Primary');
  assert.equal(f.host.navigations.length, before, 'reselecting the active bot is a no-op');
  await setValue(input(f.root, 'switchboard-name'), 'Draft', 'input');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(button(form(f.root, 'Edit bot'), 'Save bot').disabled, false);
  f.host.decisions.push('stay'); await chooseBot(f, 'Alerts');
  assert.equal(input(f.root, 'switchboard-name').value, 'Draft');
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  f.host.decisions.push('stay'); await changeChat(f.root, 'Primary Council');
  assert.equal(input(f.primary, 'switchboard-name').value, 'Draft');
  f.host.decisions.push('stay'); await click(button(f.root, 'Add bot'));
  assert.equal(input(f.primary, 'switchboard-name').value, 'Draft');
  f.host.decisions.push('stay'); await click(button(form(f.root, 'Edit bot'), 'Cancel'));
  assert.equal(input(f.root, 'switchboard-name').value, 'Draft');
  f.host.decisions.push('discard'); await click(button(form(f.root, 'Edit bot'), 'Cancel'));
  assert.ok(form(f.primary, 'Add bot'));
  assert.equal(f.host.draft.dirty, false);
  await chooseBot(f, 'Primary'); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.root, 'select', 'Who answers in Primary Council'), 'smatchet');
  f.host.decisions.push('stay'); await chooseBot(f, 'Alerts');
  assert.equal(named(f.root, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(writes(f.calls).length, 1, 'the automatic write failed before navigation');
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: 'smatchet', enabled: true });
  f.host.decisions.push('discard'); await chooseBot(f, 'Alerts');
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Alerts');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(writes(f.calls).length, 1, 'Discard never retries the failed edit');
});

test('Reverted edits and host discard publish a clean scope without writing', async t => {
  const f = setup(t); await settle(); await openBot(f);
  const edit = form(f.primary, 'Edit bot');
  const name = input(edit, 'switchboard-name');
  assert.equal(button(edit, 'Save bot').disabled, true);
  await setValue(name, 'Different', 'input'); assert.equal(f.host.draft.dirty, true);
  await setValue(name, 'Primary', 'input');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(button(edit, 'Save bot').disabled, true);
  await setValue(name, 'Draft', 'input');
  await setValue(input(edit, 'switchboard-token'), 'secret', 'input');
  f.host.draft.discard();
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Primary');
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-token').value, '');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(writes(f.calls).length, 0);
  f.unmount(); assert.equal(f.host.draft, null);
});

test('Pending dismissal and chat removal confirm scope and honor cancellation', async t => {
  const f = setup(t); const confirmations = f.host.confirmations; await settle(); await chooseBot(f, 'Alerts');
  f.host.confirmDecisions.push(false);
  await click(button(requestRow(f.root, 'Alerts Rob'), 'Dismiss'));
  assert.equal(writes(f.calls).length, 0);
  assert.match(confirmations.at(-1).message, /later message can request access again/);
  f.host.confirmDecisions.push(true);
  await click(button(requestRow(f.root, 'Alerts Rob'), 'Dismiss'));
  assert.equal(writes(f.calls).at(-1).path, '/connections/alerts/pending/pending-alerts/deny');
  assert.equal(writes(f.calls).at(-1).init.method, 'POST');
  assert.equal(writes(f.calls).at(-1).init.body, undefined);
  await changeChat(f.root, 'Alerts Council');
  assert.ok(form(f.primary, 'Edit Alerts Council'));
  assert.match(f.primary.textContent, /Chat details and removal/);
  f.host.confirmDecisions.push(false); await click(button(f.primary, 'Remove chat access'));
  assert.equal(writes(f.calls).length, 1);
  assert.match(confirmations.at(-1).message, /Alerts Council/);
  assert.match(confirmations.at(-1).message, /Alerts/);
  assert.match(confirmations.at(-1).message, /does not delete the chat or affect other bots/);
  assert.match(confirmations.at(-1).message, /parent group or server/);
  assert.match(confirmations.at(-1).message, /Pause this chat instead/);
  f.host.confirmDecisions.push(true); await click(button(f.primary, 'Remove chat access'));
  assert.equal(writes(f.calls).at(-1).path, '/connections/alerts/mappings/map-alerts');
  assert.equal(writes(f.calls).at(-1).init.method, 'DELETE');
  assert.equal(writes(f.calls).at(-1).init.body, undefined);
});

test('Clearing a token and removing a bot are separate scoped confirmations', async t => {
  const f = setup(t); const confirmations = f.host.confirmations; await settle(); await openBot(f, 'Alerts');
  f.host.confirmDecisions.push(false);
  await click(button(f.root, 'Clear saved token'));
  assert.equal(writes(f.calls).length, 0);
  assert.match(confirmations.at(-1).message, /Alerts/);
  assert.match(confirmations.at(-1).message, /keeps its chats and assignments/i);
  f.host.confirmDecisions.push(true); await click(button(f.root, 'Clear saved token'));
  assert.equal(writes(f.calls)[0].path, '/connections/alerts/token/clear');
  assert.equal(writes(f.calls)[0].init.method, 'POST');
  await openBot(f, 'Alerts'); f.host.confirmDecisions.push(false);
  await click(button(f.root, 'Remove bot')); assert.equal(writes(f.calls).length, 1);
  assert.match(confirmations.at(-1).message, /Alerts/);
  assert.match(confirmations.at(-1).message, /does not delete Telegram\/Discord chats or Burrow conversations/);
  assert.match(confirmations.at(-1).message, /Other bots are not affected/);
  f.host.confirmDecisions.push(true); await click(button(f.root, 'Remove bot'));
  assert.equal(writes(f.calls)[1].path, '/connections/alerts');
  assert.equal(writes(f.calls)[1].init.method, 'DELETE');
});

test('Discord servers gate allow/resume on enabled bot default, but permit pause/revoke', async t => {
  const initial = config();
  initial.connections[1].servers = [{ guildId: '123', name: 'Council', enabled: true }, { guildId: '234', name: 'Dormant', enabled: false }];
  initial.connections[1].pendingServers = [{ guildId: '456', name: 'Workshop' }];
  const f = setup(t, { initial }); const confirmations = f.host.confirmations; await settle(); await chooseBot(f, 'Alerts');
  assert.equal(named(f.root, 'button', 'Allow Workshop').disabled, true);
  assert.equal(named(f.root, 'button', 'Resume Dormant').disabled, true);
  assert.equal(named(f.root, 'button', 'Pause Council').disabled, false);
  assert.equal(named(f.root, 'button', 'Revoke Council').disabled, false);
  await click(named(f.root, 'button', 'Pause Council'));
  assert.equal(writes(f.calls)[0].path, '/connections/alerts/servers/123');
  assert.equal(writes(f.calls)[0].init.method, 'PUT');
  assert.deepEqual(body(writes(f.calls)[0]), { enabled: false });
  f.host.confirmDecisions.push(false); await click(named(f.root, 'button', 'Revoke Council')); assert.equal(writes(f.calls).length, 1);
  assert.match(confirmations.at(-1).message, /removes inherited access/);
  assert.match(confirmations.at(-1).message, /Explicit chat exceptions still apply/);
  f.host.confirmDecisions.push(true); await click(named(f.root, 'button', 'Revoke Council'));
  assert.equal(writes(f.calls)[1].path, '/connections/alerts/servers/123');
  assert.equal(writes(f.calls)[1].init.method, 'DELETE');
  f.state().connections[1].agentId = 'sleepy'; await click(button(f.root, 'Refresh'));
  assert.equal(named(f.root, 'button', 'Allow Workshop').disabled, true, 'a disabled default is not sufficient');
  assert.equal(named(f.root, 'button', 'Pause Council').disabled, false);
  f.state().connections[1].agentId = 'hatchet'; await click(button(f.root, 'Refresh'));
  assert.equal(named(f.root, 'button', 'Allow Workshop').disabled, false);
  assert.equal(named(f.root, 'button', 'Resume Dormant').disabled, false);
  await click(named(f.root, 'button', 'Allow Workshop'));
  assert.equal(writes(f.calls).at(-1).path, '/connections/alerts/servers/456');
  assert.deepEqual(body(writes(f.calls).at(-1)), { enabled: true });
  await click(named(f.root, 'button', 'Resume Dormant'));
  assert.equal(writes(f.calls).at(-1).path, '/connections/alerts/servers/234');
  assert.deepEqual(body(writes(f.calls).at(-1)), { enabled: true });
});

test('Controls have accessible names and selected unavailable agents remain visible but disabled', async t => {
  const initial = config();
  initial.connections[0].agentId = 'sleepy';
  initial.connections[0].mappings[0].agentId = 'missing';
  const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Primary');
  assert.match(f.root.textContent, /Sleepy is unavailable/);
  const pending = named(requestRow(f.root, 'Primary Rob'), 'select', 'Who answers in Primary Rob');
  assert.equal(selectOptionWithText(pending, 'Sleepy · bot default').disabled, true);
  assert.equal(pending.children.some(option => option.value === 'sleepy'), false);
  assert.equal(named(f.root, 'button', 'Pause Primary Council').disabled, false);
  await changeChat(f.root, 'Primary Council');
  let select = named(f.root, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, 'missing');
  assert.match(selectOptionWithText(select, 'missing').textContent, /unavailable/);
  assert.equal(selectOptionWithText(select, 'missing').disabled, true);
  assert.equal(selectOptionWithText(select, 'Sleepy · bot default').disabled, true);
  await submit(form(f.root, 'Edit Primary Council'));
  assert.equal(writes(f.calls).length, 0, 'unchanged assignment must not submit');
  // Simulate an attempted disabled option: validation blocks the autosave.
  await setValue(select, '__bot_default__');
  assert.equal(await f.host.draft.save(), false);
  assert.equal(writes(f.calls).length, 0);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'unavailable default warning').textContent, /enabled goblin/);
  select = named(f.root, 'select', 'Who answers in Primary Council');
  await setValue(select, 'hatchet');
  assert.equal(body(writes(f.calls).at(-1)).agentId, 'hatchet');
  if (byAttr(f.primary, 'form', 'aria-label', 'Edit Primary Council')) await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  await openBot(f); select = named(form(f.root, 'Edit bot'), 'select', 'Who answers new chats');
  assert.equal(select.value, 'sleepy');
  assert.equal(selectOptionWithText(select, 'Sleepy (unavailable)').disabled, true);
});

test('Diagnostics are scoped by bot and retain useful legacy data and section aliases', async t => {
  const f = setup(t, { section: 'diagnostics' }); await settle();
  await chooseBot(f, 'Alerts');
  assert.match(f.root.textContent, /@alerts_bot/);
  assert.match(f.root.textContent, /Alerts Council/);
  assert.match(f.root.textContent, /Alerts Rob/);
  assert.match(f.root.textContent, /Recent deliveries/);
  assert.doesNotMatch(f.root.textContent, /Primary Council/);
  assert.ok(named(f.root, 'button', 'Manage Alerts'));
  const legacy = connection('default', 'Default bot');
  delete legacy.id; delete legacy.name;
  legacy.botIdentity = legacy.bot; delete legacy.bot;
  legacy.pendingAdmissions = legacy.pending; delete legacy.pending;
  legacy.recentDeliveries = legacy.deliveries; delete legacy.deliveries;
  const initial = { ...legacy, coreAgentTurns: { available: true } };
  const d = setup(t, { section: 'status', initial }); await settle();
  assert.match(d.root.textContent, /Diagnostics/);
  assert.match(d.root.textContent, /@switchboard_bot/);
  assert.match(d.root.textContent, /Default bot Council/);
  assert.match(d.root.textContent, /Default bot Rob/);
  assert.match(d.root.textContent, /Recent deliveries/);
  for (const section of ['configuration', 'pending-admissions', 'chat-mappings']) {
    const alias = setup(t, { section, initial }); await settle();
    assert.ok(form(alias.primary, 'Add bot'));
    assert.ok(named(alias.root, 'button', 'Manage Default bot'));
    await chooseBot(alias, 'Default bot');
    assert.match(alias.primary.textContent, /Default bot Council/);
    alias.unmount();
  }
  assert.equal(mountSettings({ section: 'other', primary: { replace() { throw Error('must not mount'); } }, api: async () => ({}) }), undefined);
});

test('Initial read error is retryable; later refresh errors keep the usable editor and draft', async t => {
  let reads = 0;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration') { reads++; if (reads === 1 || reads === 3) throw Error('offline'); }
    return state;
  } });
  await settle();
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'initial error').textContent, /offline/);
  assert.equal(byAttr(f.root, 'button', 'aria-label', 'Manage Primary'), undefined);
  await click(button(f.root, 'Retry'));
  assert.ok(named(f.root, 'button', 'Manage Primary'));
  await openBot(f);
  await setValue(input(f.root, 'switchboard-name'), 'Safe draft', 'input');
  await click(button(f.root, 'Refresh'));
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'refresh error').textContent, /offline/);
  assert.equal(input(form(f.root, 'Edit bot'), 'switchboard-name').value, 'Safe draft');
  await click(button(f.root, 'Refresh'));
  assert.equal(input(form(f.root, 'Edit bot'), 'switchboard-name').value, 'Safe draft');
  assert.equal(byAttr(f.root, 'p', 'role', 'alert'), undefined);
});

test('Unmount aborts an in-flight read and ignores a late success or failure', async t => {
  for (const reject of [false, true]) {
    let complete;
    const pending = new Promise((resolve, fail) => { complete = reject ? () => fail(Error('late failure')) : () => resolve(config()); });
    const f = setup(t, { onRequest: () => pending });
    const signal = f.calls[0].init.signal;
    assert.equal(signal.aborted, false);
    f.unmount(); assert.equal(signal.aborted, true);
    assert.equal(f.primary.childNodes.length, 0);
    complete(); await settle();
    assert.equal(f.primary.childNodes.length, 0);
    assert.equal(f.overflowRoot.childNodes.length, 0);
  }
});

test('Unmount aborts an in-flight mutation and ignores its late response', async t => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const f = setup(t, { overflow: true, onRequest: ({ call, state }) => call.init.method === 'PUT' ? pending : state });
  await settle(); await openBot(f);
  await setValue(input(f.root, 'switchboard-name'), 'Changed', 'input');
  await submit(form(f.root, 'Edit bot'));
  const call = writes(f.calls)[0]; assert.ok(call); assert.equal(call.init.signal.aborted, false);
  f.unmount(); assert.equal(call.init.signal.aborted, true);
  complete(config()); await settle();
  assert.equal(f.primary.childNodes.length, 0); assert.equal(f.overflowRoot.childNodes.length, 0);
});

test('Automatic refresh runs only while idle and its interval is cleared on cleanup', async t => {
  const realSetInterval = globalThis.setInterval; const realClearInterval = globalThis.clearInterval;
  const token = { unref() {} }; let tick; let delay; const cleared = [];
  globalThis.setInterval = (callback, ms) => { tick = callback; delay = ms; return token; };
  globalThis.clearInterval = value => cleared.push(value);
  t.after(() => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; });
  const f = setup(t); await settle();
  assert.equal(delay, 10_000); assert.equal(f.calls.length, 1);
  document.hidden = true; tick(); await settle(); assert.equal(f.calls.length, 1);
  document.hidden = false;
  for (const tag of ['input', 'select', 'textarea', 'summary']) {
    document.activeElement = new FakeNode(tag); tick(); await settle(); assert.equal(f.calls.length, 1, `must not refresh while a ${tag} has focus`);
  }
  document.activeElement = null; tick(); await settle(); assert.equal(f.calls.length, 2);
  await openBot(f); document.activeElement = null; tick(); await settle(); assert.equal(f.calls.length, 3, 'a clean, unfocused editor remains refreshable');
  await setValue(input(f.primary, 'switchboard-name'), 'Dirty', 'input');
  assert.equal(f.host.draft.dirty, true, 'the visible form must remain connected after an unchanged quiet refresh');
  document.activeElement = null; tick(); await settle(); assert.equal(f.calls.length, 3, 'dirty editor suppresses auto-refresh');
  f.unmount(); assert.deepEqual(cleared, [token]);
  tick(); await settle(); assert.equal(f.calls.length, 3, 'no callback may load after unmount');
});

test('A failed immediate chat mutation stays visible without losing the bot draft', async t => {
  const initial = config();
  initial.connections[0].mappings.push({ id: 'map-other', chatId: '-other', chatTitle: 'Other room', chatType: 'group', agentId: 'hatchet', enabled: true });
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-other' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(f.primary, 'switchboard-name'), 'Draft bot', 'input');
  await click(named(f.root, 'button', 'Pause Other room'));
  assert.equal(input(f.primary, 'switchboard-name').value, 'Draft bot');
  assert.equal(f.host.draft.dirty, true);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'failure from the other chat').textContent, /offline/);
  assert.match(row(f.root, 'Other room').textContent, /Allowed/);
});

test('A pending approval can inherit the bot default again after a later new request', async t => {
  const initial = config(); initial.connections[0].agentId = 'hatchet';
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path.endsWith('/approve')) { state.connections[0].pending = []; state.connections[0].mappings.push({ id: 'pending-default', chatId: 'default', chatTitle: 'Primary Rob', chatType: 'direct', agentId: body(call).agentId, enabled: true }); }
    if (call.path === '/connections/default/mappings/pending-default' && call.init.method === 'DELETE') state.connections[0].mappings = state.connections[0].mappings.filter(item => item.id !== 'pending-default');
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary');
  let pending = requestRow(f.root, 'Primary Rob');
  await setValue(named(pending, 'select', 'Who answers in Primary Rob'), 'smatchet');
  await click(button(pending, 'Allow chat'));
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: 'smatchet' });
  await changeChat(f.root, 'Primary Rob');
  await click(button(f.primary, 'Remove chat access'));
  f.state().connections[0].pending.push({ id: 'pending-default', chatId: 'default', chatTitle: 'Primary Rob', chatType: 'direct' });
  await click(button(f.root, 'Refresh'));
  pending = requestRow(f.root, 'Primary Rob');
  const select = named(pending, 'select', 'Who answers in Primary Rob');
  assert.equal(select.value, selectOptionWithText(select, 'bot default').value);
  await click(button(pending, 'Allow chat'));
  assert.deepEqual(body(writes(f.calls).at(-1)), {});
});

test('A refresh started before a bot save cannot overwrite the newer saved state', async t => {
  const initial = config();
  let reads = 0; let resolveRefresh;
  const delayed = new Promise(resolve => { resolveRefresh = resolve; });
  const old = clone(initial);
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/configuration') return ++reads === 2 ? delayed : state;
    if (call.path === '/connections/default' && call.init.method === 'PUT') state.connections[0].name = body(call).name;
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(f.root, 'switchboard-name'), 'Saved name', 'input');
  await click(button(f.root, 'Refresh'));
  await submit(form(f.root, 'Edit bot'));
  assert.ok(named(f.root, 'button', 'Manage Saved name'));
  resolveRefresh(old); await settle();
  assert.ok(named(f.root, 'button', 'Manage Saved name'));
  assert.equal(byAttr(f.root, 'button', 'aria-label', 'Manage Primary'), undefined);
});

test('A blank inherited chat with no default can be assigned explicitly', async t => {
  const initial = config();
  Object.assign(initial.connections[0].mappings[0], { agentId: null, inheritedAgent: true });
  const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Primary');
  assert.match(row(f.root, 'Primary Council').textContent, /No goblin assigned/);
  await changeChat(f.root, 'Primary Council');
  const select = named(f.root, 'select', 'Who answers in Primary Council');
  assert.equal(select.children.some(option => /bot default/.test(option.textContent)), false);
  assert.equal(select.value, '', 'no option is selected when no default or explicit agent exists');
  await submit(form(f.root, 'Edit Primary Council'));
  assert.equal(writes(f.calls).length, 0);
  await setValue(select, 'hatchet');
  assert.deepEqual(body(writes(f.calls).at(-1)), { agentId: 'hatchet', enabled: true });
});

test('Clear token consults the shared dirty guard before its scoped confirmation', async t => {
  const f = setup(t); await settle(); await openBot(f);
  await setValue(input(f.root, 'switchboard-name'), 'Unsaved name', 'input');
  f.host.decisions.push('stay');
  await click(button(f.root, 'Clear saved token'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  assert.equal(f.host.confirmations.length, 0, 'destructive confirmation is not opened on Stay');
  assert.equal(writes(f.calls).length, 0);
  assert.equal(input(f.root, 'switchboard-name').value, 'Unsaved name');
  f.host.decisions.push('discard'); f.host.confirmDecisions.push(false);
  await click(button(f.root, 'Clear saved token'));
  assert.equal(f.host.confirmations.at(-1).title, 'Clear saved token?');
  assert.equal(writes(f.calls).length, 0);
  assert.equal(f.host.draft.dirty, false);
});

test('An asynchronous quiet refresh with changed data leaves Refresh enabled and usable', async t => {
  const pending = deferred(); let reads = 0;
  const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) return pending.promise;
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary');
  const fresh = clone(f.state()); fresh.connections[0].name = 'Updated Primary';
  f.setState(fresh);
  document.activeElement = null;
  f.tick(); await settle();
  assert.equal(reads, 2, 'the idle timer started a quiet read');
  assert.equal(button(f.root, 'Refresh').disabled, false, 'quiet refresh does not disable the visible button');
  pending.resolve(fresh); await settle();
  assert.ok(named(f.root, 'button', 'Manage Updated Primary'), 'changed response was rendered');
  assert.equal(button(f.root, 'Refresh').disabled, false, 'completed quiet refresh must not leave a disabled button');
  await click(button(f.root, 'Refresh'));
  assert.equal(reads, 3, 'the button can still initiate a manual read');
  assert.equal(button(f.root, 'Refresh').disabled, false);
});

test('A successful quiet refresh clears an earlier refresh error even when data is unchanged', async t => {
  let reads = 0;
  const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) throw Error('offline');
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary');
  await click(button(f.root, 'Refresh'));
  assert.equal(reads, 2);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'refresh error').textContent, /offline/);
  document.activeElement = null;
  f.tick(); await settle();
  assert.equal(reads, 3);
  assert.equal(byAttr(f.root, 'p', 'role', 'alert'), undefined, 'quiet success removes the stale error');
  assert.ok(named(f.root, 'button', 'Manage Primary'));
  assert.equal(button(f.root, 'Refresh').disabled, false);
});

test('A quiet response started idle does not replace a bot form opened before it arrives', async t => {
  const pending = deferred(); let reads = 0;
  const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) return pending.promise;
    return state;
  } });
  await settle();
  const fresh = clone(f.state()); fresh.connections[0].name = 'Discovered Primary';
  f.setState(fresh);
  document.activeElement = null; f.tick(); await settle();
  assert.equal(reads, 2);
  await chooseBot(f, 'Primary');
  const edit = form(f.root, 'Edit bot');
  const name = input(edit, 'switchboard-name');
  await setValue(name, 'Unsaved draft', 'input');
  // An editor must be protected even if its input is not currently focused.
  document.activeElement = null;
  pending.resolve(fresh); await settle();
  assert.equal(form(f.root, 'Edit bot'), edit, 'the original form stays mounted');
  assert.equal(input(edit, 'switchboard-name'), name);
  assert.equal(name.value, 'Unsaved draft');
  assert.ok(named(f.root, 'button', 'Manage Primary'));
  assert.equal(byAttr(f.root, 'button', 'aria-label', 'Manage Discovered Primary'), undefined);
  assert.equal(writes(f.calls).length, 0);
  f.host.decisions.push('discard'); await click(button(edit, 'Cancel'));
  document.activeElement = null; f.tick(); await settle();
  assert.equal(reads, 3, 'discovery resumes after editing');
  assert.ok(named(f.root, 'button', 'Manage Discovered Primary'));
});

test('An ignored quiet response after opening an editor does not strand Refresh disabled', async t => {
  const pending = deferred(); let reads = 0;
  const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) return pending.promise;
    return state;
  } });
  await settle();
  const fresh = clone(f.state()); fresh.connections[0].name = 'Discovered Primary';
  document.activeElement = null; f.tick(); await settle();
  assert.equal(reads, 2);
  await chooseBot(f, 'Primary');
  const edit = form(f.root, 'Edit bot');
  const name = input(edit, 'switchboard-name');
  await setValue(name, 'Unsaved draft', 'input');
  name.focus();
  pending.resolve(fresh); await settle();
  assert.equal(form(f.root, 'Edit bot'), edit, 'fixing the toolbar must not replace the live form');
  assert.equal(name.value, 'Unsaved draft');
  assert.equal(document.activeElement, name);
  const refresh = need(byText(f.root, 'button', 'Refresh') || byText(f.root, 'button', 'Refreshing…'), 'Refresh control');
  assert.equal(refresh.disabled, false, `completed quiet poll must re-enable Refresh (currently ${refresh.textContent})`);
  assert.equal(refresh.textContent, 'Refresh');
  await click(refresh);
  assert.equal(reads, 3, 'manual refresh remains usable while editing');
  assert.equal(input(form(f.root, 'Edit bot'), 'switchboard-name').value, 'Unsaved draft');
});

test('A quiet response started idle does not replace a subsequently focused pending select', async t => {
  const pending = deferred(); let reads = 0;
  const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) return pending.promise;
    return state;
  } });
  await settle(); await chooseBot(f, 'Primary');
  const fresh = clone(f.state()); fresh.connections[0].name = 'Discovered Primary';
  f.setState(fresh);
  document.activeElement = null; f.tick(); await settle();
  assert.equal(reads, 2);
  const select = named(requestRow(f.root, 'Primary Rob'), 'select', 'Who answers in Primary Rob');
  select.focus(); await setValue(select, 'smatchet');
  pending.resolve(fresh); await settle();
  assert.equal(named(requestRow(f.root, 'Primary Rob'), 'select', 'Who answers in Primary Rob'), select, 'the native select is not replaced');
  assert.equal(document.activeElement, select);
  assert.equal(select.value, 'smatchet');
  assert.ok(named(f.root, 'button', 'Manage Primary'));
  assert.equal(byAttr(f.root, 'button', 'aria-label', 'Manage Discovered Primary'), undefined);
  assert.equal(writes(f.calls).length, 0);
  document.activeElement = null; f.tick(); await settle();
  assert.equal(reads, 3, 'the next idle tick gets fresh data');
  assert.ok(named(f.root, 'button', 'Manage Discovered Primary'));
  assert.equal(named(requestRow(f.root, 'Primary Rob'), 'select', 'Who answers in Primary Rob').value, 'smatchet');
});

test('Removing the original bot orphans its chat draft even when another bot has the same mapping ID', async t => {
  const initial = config();
  initial.connections[1].mappings[0].id = 'map-default';
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } }); await settle(); await chooseBot(f, 'Primary');
  await changeChat(f.root, 'Primary Council');
  const edit = form(f.root, 'Edit Primary Council');
  await setValue(named(edit, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(writes(f.calls).length, 1, 'only the original auto-save was attempted');
  f.state().connections = f.state().connections.filter(state => state.id !== 'default');
  await click(button(f.root, 'Refresh'));
  assert.match(f.primary.textContent, /This item was removed/);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'orphaned chat error').textContent, /original bot or chat no longer exists/i);
  assert.equal(byAttr(f.root, 'form', 'aria-label', 'Edit Primary Council'), undefined);
  assert.equal(byAttr(f.root, 'form', 'aria-label', 'Edit Alerts Council'), undefined);
  await submit(edit); // A late event from the detached original form must also be harmless.
  assert.equal(await f.host.draft.save(), false);
  assert.deepEqual(writes(f.calls).map(call => call.path), ['/connections/default/mappings/map-default'], 'never retry the orphan draft on either connection');
  await click(button(f.root, 'Discard edits'));
  assert.ok(form(f.primary, 'Add bot'));
  await chooseBot(f, 'Alerts');
  assert.ok(row(f.root, 'Alerts Council'));
  assert.equal(byAttr(f.root, 'form', 'aria-label', 'Edit Alerts Council'), undefined);
  assert.equal(writes(f.calls).length, 1);
});

test('Removing the original mapping shows an orphan message rather than silently losing the chat draft', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } }); await settle(); await chooseBot(f, 'Primary');
  await changeChat(f.root, 'Primary Council');
  const edit = form(f.root, 'Edit Primary Council');
  await setValue(named(edit, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(writes(f.calls).length, 1);
  f.state().connections[0].mappings = [];
  await click(button(f.root, 'Refresh'));
  assert.ok(named(f.root, 'button', 'Manage Primary'), 'the connection still exists');
  assert.match(f.primary.textContent, /This item was removed/);
  assert.match(need(byAttr(f.root, 'p', 'role', 'alert'), 'removed mapping warning').textContent, /unsaved edits cannot be applied/i);
  assert.equal(byAttr(f.root, 'form', 'aria-label', 'Edit Primary Council'), undefined);
  await submit(edit);
  assert.equal(await f.host.draft.save(), false);
  assert.deepEqual(writes(f.calls).map(call => call.path), ['/connections/default/mappings/map-default']);
  await click(button(f.root, 'Discard edits'));
  assert.equal(byAttr(f.root, 'p', 'role', 'alert'), undefined);
  assert.match(f.root.textContent, /Chats/);
});

test('Unavailable explicit chat assignments are labeled unavailable in the row and bot card', async t => {
  for (const [agentId, agentLabel] of [['sleepy', 'Sleepy'], ['missing-goblin', 'missing-goblin']]) {
    const initial = config(); initial.connections[0].mappings[0].agentId = agentId;
    const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Primary');
    assert.ok(named(f.root, 'button', 'Manage Primary').textContent.includes(`${agentLabel} (unavailable) · set per chat`));
    assert.ok(row(f.root, 'Primary Council').textContent.includes(`${agentLabel} is unavailable`));
    assert.ok(!row(f.root, 'Primary Council').textContent.includes(`${agentLabel} answers`));
    assert.equal(writes(f.calls).length, 0);
    f.unmount();
  }
});

test('Saving a bot pause omits an unchanged disabled default but an explicit clear sends null', async t => {
  const initial = config(); initial.connections[0].agentId = 'sleepy';
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      const update = body(call);
      Object.assign(state.connections[0], update);
      state.connections[0].transport.enabled = update.enabled;
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.root, 'Edit bot');
  let assigned = named(edit, 'select', 'Who answers new chats');
  assert.equal(assigned.value, 'sleepy');
  assert.equal(selectOptionWithText(assigned, 'Sleepy (unavailable)').disabled, true);
  await setChecked(named(edit, 'input', 'Receive messages'), false);
  await submit(edit);
  assert.equal(writes(f.calls)[0].path, '/connections/default');
  assert.equal(writes(f.calls)[0].init.method, 'PUT');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Primary', enabled: false });
  assert.equal(f.state().connections[0].agentId, 'sleepy');
  await openBot(f); edit = form(f.root, 'Edit bot');
  assigned = named(edit, 'select', 'Who answers new chats');
  await setValue(assigned, ''); await submit(edit);
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Primary', enabled: false, agentId: null });
  assert.equal(f.state().connections[0].agentId, null);
});

test('A paused tokenless bot can be edited without a token until receiving is enabled', async t => {
  const initial = config();
  Object.assign(initial.connections[0], { enabled: false, tokenConfigured: false });
  initial.connections[0].bot.configured = false;
  initial.connections[0].transport.enabled = false;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      const update = body(call);
      Object.assign(state.connections[0], { name: update.name, enabled: update.enabled });
      state.connections[0].transport.enabled = update.enabled;
      if (update.token) { state.connections[0].tokenConfigured = true; state.connections[0].bot.configured = true; }
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.root, 'Edit bot');
  let token = input(edit, 'switchboard-token');
  assert.equal(named(edit, 'input', 'Receive messages').checked, false);
  assert.notEqual(token.required, true);
  await setValue(input(edit, 'switchboard-name'), 'Renamed paused bot', 'input');
  await submit(edit);
  assert.equal(writes(f.calls)[0].path, '/connections/default');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Renamed paused bot', enabled: false });
  await openBot(f, 'Renamed paused bot'); edit = form(f.root, 'Edit bot');
  token = input(edit, 'switchboard-token');
  const receive = named(edit, 'input', 'Receive messages');
  await setChecked(receive, true);
  assert.equal(token.required, true, 'enabling receive requires a token');
  await submit(edit);
  assert.equal(writes(f.calls).length, 1, 'blank token must not enable the bot');
  await setChecked(receive, false); assert.equal(token.required, false);
  await setChecked(receive, true); assert.equal(token.required, true);
  await setValue(token, 'new-token', 'input'); await submit(edit);
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Renamed paused bot', enabled: true, token: 'new-token' });
  assert.doesNotMatch(f.root.textContent, /new-token/);
});

test('Discord inheritedAgent false overrides the legacy inherited flag for explicit mappings', async t => {
  const initial = config();
  const discord = initial.connections[1]; discord.agentId = 'smatchet';
  Object.assign(discord.mappings[0], { inherited: true, inheritedAgent: false, agentId: 'hatchet' });
  discord.mappings.push({ id: 'legacy-map', chatId: 'dm-1', chatTitle: 'Legacy DM', chatType: 'direct', agentId: 'smatchet', inherited: true, enabled: true });
  const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Alerts');
  assert.match(row(f.root, 'Alerts Council').textContent, /Hatchet answers/);
  assert.doesNotMatch(row(f.root, 'Alerts Council').textContent, /uses bot default/);
  assert.match(row(f.root, 'Legacy DM').textContent, /Smatchet answers · uses bot default/, 'legacy inherited is still honored if inheritedAgent is absent');
  await changeChat(f.root, 'Alerts Council');
  let select = named(f.root, 'select', 'Who answers in Alerts Council');
  assert.equal(select.value, 'hatchet', 'explicit assignment must not be confused with the Discord server default');
  await submit(form(f.root, 'Edit Alerts Council'));
  assert.equal(writes(f.calls).length, 0, 'unchanged chat must not submit');
  select = named(f.root, 'select', 'Who answers in Alerts Council');
  await setValue(select, selectOptionWithText(select, 'bot default').value);
  assert.equal(writes(f.calls)[0].path, '/connections/alerts/mappings/map-alerts');
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: null, enabled: true }, 'choosing the default is an explicit assignment change');
});

test('Discord generated chat shows paused server access without confusing its custom responder', async t => {
  const initial = config(); const state = initial.connections[1]; state.agentId = 'smatchet';
  state.servers = [{ guildId: '123', name: 'Council server', enabled: false }];
  Object.assign(state.mappings[0], { guildId: '123', inherited: true, inheritedAgent: false, agentId: 'hatchet' });
  const f = setup(t, { initial }); await settle(); await chooseBot(f, 'Alerts');
  const chat = row(f.root, 'Alerts Council');
  assert.match(chat.textContent, /Server access paused/);
  assert.match(chat.textContent, /Hatchet answers/);
  assert.doesNotMatch(chat.textContent, /uses bot default|all topics included/);
  assert.match(chat.textContent, /Access follows Council server/);
  assert.equal(named(chat, 'button', 'Pause Alerts Council').disabled, false);
});

test('Every missing host guard method produces an honest blocker, not an unguarded editor', async t => {
  for (const missing of ['confirm', 'navigate', 'setDraft']) {
    const f = setup(t, { overflow: true, hostMethods: ['confirm', 'navigate', 'setDraft'].filter(key => key !== missing) });
    await settle();
    assert.match(f.primary.textContent, /Switchboard settings unavailable/);
    assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'host incompatibility alert').textContent, /updated Burrow Settings host/i);
    assert.match(f.primary.textContent, /Existing bots continue running/);
    assert.equal(byTag(f.root, 'form').length, 0);
    assert.equal(f.calls.length, 0, 'an unsupported host must not load an unguarded editor');
    assert.equal(f.overflowRoot.childNodes.length, 0);
    f.unmount(); assert.equal(f.primary.childNodes.length, 0);
  }
});

test('Captured draft Save validates and failed guarded Save stays put; retry commits before navigation', async t => {
  let fail = true;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      if (fail) { fail = false; throw Error('telegram_auth_failed'); }
      const update = body(call);
      state.connections[0].name = update.name;
      state.connections[0].enabled = update.enabled;
      state.connections[0].transport.enabled = update.enabled;
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.primary, 'Edit bot');
  await setValue(input(edit, 'switchboard-name'), '   ', 'input');
  assert.equal(await f.host.draft.save(), false);
  assert.equal(writes(f.calls).length, 0);
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'validation error').textContent, /Enter a bot name/);
  edit = form(f.primary, 'Edit bot');
  await setValue(input(edit, 'switchboard-name'), 'Saved', 'input');
  await setValue(input(edit, 'switchboard-token'), 'private-token', 'input');
  assert.deepEqual(Object.keys(f.host.draft).sort(), ['busy', 'dirty', 'discard', 'save']);
  assert.doesNotMatch(JSON.stringify(f.host.draft), /private-token/);
  f.host.decisions.push('save'); await chooseBot(f, 'Alerts');
  assert.equal(writes(f.calls).length, 1);
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'save error').textContent, /Telegram rejected/);
  assert.equal(input(f.primary, 'switchboard-token').value, 'private-token');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(named(f.root, 'button', 'Manage Primary').getAttribute('aria-pressed'), 'true');
  f.host.decisions.push('save'); await chooseBot(f, 'Alerts');
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Saved', enabled: true, token: 'private-token' });
  assert.ok(f.host.snapshots.some(snapshot => snapshot?.busy === true && snapshot.dirty === true));
  assert.equal(f.host.draft.busy, false); assert.equal(f.host.draft.dirty, false);
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Alerts');
  assert.doesNotMatch(f.root.textContent, /private-token/);
});

test('In-flight save publishes busy immediately, blocks duplicate submissions and navigation, and resets baseline', async t => {
  const pending = deferred();
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') return pending.promise;
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.primary, 'Edit bot');
  await setValue(input(edit, 'switchboard-name'), 'Changed', 'input');
  const scope = f.host.draft;
  const result = scope.save();
  assert.equal(f.host.draft.busy, true, 'busy is published synchronously');
  assert.equal(writes(f.calls).length, 1);
  assert.equal(await scope.save(), false);
  edit = form(f.primary, 'Edit bot');
  assert.equal(button(edit, 'Saving…').disabled, true);
  assert.equal(named(f.root, 'button', 'Manage Alerts').disabled, true);
  edit.dispatchEvent({ type: 'submit' });
  named(f.root, 'button', 'Manage Alerts').dispatchEvent({ type: 'click' });
  assert.equal(writes(f.calls).length, 1);
  const updated = clone(f.state()); updated.connections[0].name = 'Changed';
  pending.resolve(updated);
  assert.equal(await result, true);
  assert.equal(f.host.draft.busy, false); assert.equal(f.host.draft.dirty, false);
  edit = form(f.primary, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'Changed');
  assert.equal(button(edit, 'Save bot').disabled, true);
  assert.equal(await f.host.draft.save(), true);
  assert.equal(writes(f.calls).length, 1, 'a clean repeated save is a no-op');
});

test('Unmount during async confirmation aborts its action and never republishes draft', async t => {
  const pending = deferred();
  const f = setup(t, { overflow: true }); await settle(); await openBot(f);
  f.host.confirmDecisions.push(pending.promise);
  const control = button(f.primary, 'Remove bot');
  await click(control);
  assert.equal(f.host.confirmations.length, 1);
  assert.equal(f.host.confirmations[0].title, 'Remove bot?');
  assert.equal(f.host.confirmations[0].tone, 'danger');
  assert.equal(f.host.draft.busy, true);
  control.dispatchEvent({ type: 'click' });
  assert.equal(f.host.confirmations.length, 1, 'repeat confirmation is ignored');
  f.unmount();
  assert.equal(f.host.draft, null);
  const snapshots = f.host.snapshots.length;
  pending.resolve(true); await settle();
  assert.equal(writes(f.calls).length, 0);
  assert.equal(f.host.snapshots.length, snapshots);
  assert.equal(f.primary.childNodes.length, 0); assert.equal(f.overflowRoot.childNodes.length, 0);
});

test('Zero agents and zero bots still offer a safe validated Add form and cannot approve without a responder', async t => {
  const empty = setup(t, { initial: { connections: [], coreAgentTurns: { available: true } }, availableAgents: [] });
  await settle();
  const add = form(empty.primary, 'Add bot');
  assert.match(empty.root.textContent, /No bots connected yet/);
  const choices = named(add, 'select', 'Who answers new chats');
  assert.deepEqual(choices.children.map(option => option.value), ['']);
  assert.equal(await empty.host.draft.save(), true, 'unchanged blank draft is a no-op');
  await setValue(input(add, 'switchboard-name'), 'New bot', 'input');
  assert.equal(await empty.host.draft.save(), false, 'missing token is invalid');
  assert.equal(writes(empty.calls).length, 0);
  const f = setup(t, { availableAgents: [] }); await settle(); await openBot(f);
  const pending = requestRow(f.root, 'Primary Rob');
  await click(button(pending, 'Allow chat'));
  assert.equal(writes(f.calls).length, 0);
  assert.match(named(pending, 'select', 'Who answers in Primary Rob').validityMessage, /enabled goblin/);
});

test('Long untrusted names and data render as inert text, never HTML or local styles', async t => {
  const payload = `<img src=x onerror=alert(1)>${'very-long-name-'.repeat(60)}<script>boom()</script>`;
  const initial = config();
  initial.connections[0].name = payload;
  initial.connections[0].mappings[0].chatTitle = payload;
  initial.connections[0].pending[0].chatTitle = payload;
  initial.connections[0].bot.username = payload;
  const f = setup(t, { initial, overflow: true }); await settle();
  assert.ok(named(f.overflowRoot, 'button', `Manage ${payload}`).textContent.includes(payload));
  await chooseBot(f, payload);
  assert.ok(row(f.primary, payload).textContent.includes(payload));
  assert.ok(requestRow(f.primary, payload).textContent.includes(payload));
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, payload);
  assert.equal(byTag(f.root, 'img').length, 0);
  assert.equal(byTag(f.root, 'script').length, 0);
  assert.equal(byTag(f.root, 'style').length, 0);
  assert.equal(byTag(f.root, 'link').length, 0);
  await changeChat(f.root, payload);
  assert.ok(form(f.primary, `Edit ${payload}`));
  assert.equal(byTag(f.root, 'img').length, 0);
  assert.equal(byTag(f.root, 'script').length, 0);
});

for (const kind of ['bot', 'chat']) {
  test(`An unchanged quiet read leaves the ${kind} controls live, with dirty reversion`, async t => {
    const f = setupAutoRefresh(t, { onRequest: ({ call, state }) => {
      if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
      return state;
    } }); await settle(); await openBot(f);
    if (kind === 'chat') await changeChat(f.root, 'Primary Council');
    document.activeElement = null; f.tick(); await settle();
    const name = kind === 'chat' ? 'Who answers in Primary Council' : 'Who answers new chats';
    let select = named(form(f.primary, kind === 'chat' ? 'Edit Primary Council' : 'Edit bot'), 'select', name);
    await setValue(select, 'smatchet');
    assert.equal(f.host.draft.dirty, true, `${kind} select must still update the live draft`);
    assert.equal(writes(f.calls).length, kind === 'chat' ? 1 : 0);
    select = named(f.primary, 'select', name);
    await setValue(select, kind === 'chat' ? 'hatchet' : '');
    assert.equal(f.host.draft.dirty, false, 'reverting clears dirty after polling');
    assert.equal(writes(f.calls).length, kind === 'chat' ? 1 : 0, 'reverting a failed change to its accepted value needs no write');
  });
}

test('A removed bot never redirects its dirty editor save to another connection', async t => {
  const f = setup(t); await settle(); await openBot(f);
  const edit = form(f.primary, 'Edit bot');
  await setValue(input(edit, 'switchboard-name'), 'Private draft', 'input');
  await setValue(input(edit, 'switchboard-token'), 'secret', 'input');
  f.state().connections = f.state().connections.filter(item => item.id !== 'default');
  await click(button(f.root, 'Refresh'));
  assert.match(f.primary.textContent, /This item was removed/);
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'orphan warning').textContent, /original bot or chat no longer exists/);
  assert.equal(await f.host.draft.save(), false);
  await submit(edit);
  assert.equal(writes(f.calls).length, 0);
  await click(button(f.root, 'Discard edits'));
  assert.ok(form(f.primary, 'Add bot'));
  assert.equal(f.host.draft.dirty, false);
  assert.doesNotMatch(f.root.textContent, /secret/);
});

test('Unmount during a guard-triggered save cannot resume the pending destination', async t => {
  const pending = deferred();
  const f = setup(t, { overflow: true, onRequest: ({ call, state }) => call.init.method === 'PUT' ? pending.promise : state });
  await settle(); await openBot(f);
  await setValue(input(f.primary, 'switchboard-name'), 'Draft', 'input');
  f.host.decisions.push('save'); await chooseBot(f, 'Alerts');
  assert.equal(writes(f.calls).length, 1); assert.equal(f.host.draft.busy, true);
  const signal = writes(f.calls)[0].init.signal;
  f.unmount(); assert.equal(signal.aborted, true); assert.equal(f.host.draft, null);
  const count = f.host.snapshots.length;
  pending.resolve(f.state()); await settle();
  assert.equal(f.host.snapshots.length, count);
  assert.equal(f.primary.childNodes.length, 0); assert.equal(f.overflowRoot.childNodes.length, 0);
});

test('Change chat after guard Save resolves the latest mapping and bot default', async t => {
  const initial = config();
  initial.connections[0].agentId = null;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections[0].name = body(call).name;
      // Simulate another client changing both fields while the bot save completes.
      state.connections[0].agentId = 'hatchet';
      Object.assign(state.connections[0].mappings[0], { agentId: 'smatchet', inheritedAgent: false });
    } else if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      Object.assign(state.connections[0].mappings[0], body(call));
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.primary, 'Edit bot');
  assert.match(row(f.primary, 'Primary Council').textContent, /Hatchet answers/);
  await setValue(named(edit, 'select', 'Who answers new chats'), 'smatchet');
  f.host.decisions.push('save');
  await changeChat(f.root, 'Primary Council');
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  assert.equal(writes(f.calls).length, 1);
  assert.equal(writes(f.calls)[0].path, '/connections/default');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Primary', enabled: true, agentId: 'smatchet' });
  edit = form(f.primary, 'Edit Primary Council');
  const select = named(edit, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, 'smatchet', 'the post-save explicit mapping replaces the stale Hatchet mapping');
  assert.match(selectOptionWithText(select, 'bot default').textContent, /Hatchet/, 'the returned default replaces the just-submitted default');
  assert.equal(f.host.draft.dirty, false);
  await setValue(select, '__bot_default__');
  assert.equal(writes(f.calls)[1].path, '/connections/default/mappings/map-default');
  assert.deepEqual(body(writes(f.calls)[1]), { agentId: null, enabled: true });
});

test('Change chat after clearing the bot default uses the null-default saved aggregate', async t => {
  const initial = config();
  initial.connections[0].agentId = 'hatchet';
  initial.connections[0].mappings[0].inheritedAgent = true;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections[0].agentId = body(call).agentId;
      state.connections[0].mappings[0].agentId = body(call).agentId;
    } else if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      Object.assign(state.connections[0].mappings[0], { ...body(call), inheritedAgent: false });
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(named(form(f.primary, 'Edit bot'), 'select', 'Who answers new chats'), '');
  f.host.decisions.push('save');
  await changeChat(f.root, 'Primary Council');
  assert.equal(writes(f.calls).length, 1);
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Primary', enabled: true, agentId: null });
  const edit = form(f.primary, 'Edit Primary Council');
  const select = named(edit, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, '', 'a removed default is not retained as an inherited assignment');
  assert.equal(select.children.some(option => /bot default/.test(option.textContent)), false);
  assert.equal(f.host.draft.dirty, false);
  await setValue(select, 'smatchet');
  assert.equal(writes(f.calls)[1].path, '/connections/default/mappings/map-default');
  assert.deepEqual(body(writes(f.calls)[1]), { agentId: 'smatchet', enabled: true });
});

test('Change chat after guard Save cannot open a replacement when the original bot disappeared', async t => {
  const initial = config();
  initial.connections[1].mappings[0].id = 'map-default';
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections = state.connections.filter(item => item.id !== 'default');
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(form(f.primary, 'Edit bot'), 'switchboard-name'), 'Draft name', 'input');
  f.host.decisions.push('save');
  await changeChat(f.root, 'Primary Council');
  assert.deepEqual(writes(f.calls).map(call => [call.init.method, call.path]), [['PUT', '/connections/default']]);
  assert.equal(byAttr(f.primary, 'form', 'aria-label', 'Edit Primary Council'), undefined);
  assert.equal(byAttr(f.primary, 'form', 'aria-label', 'Edit Alerts Council'), undefined);
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'removed item warning').textContent, /removed/i);
  await f.host.draft.save();
  assert.equal(writes(f.calls).length, 1, 'never write the same mapping ID on the surviving bot');
});

test('Change chat after guard Save does not rebind a removed mapping on another bot', async t => {
  const initial = config();
  initial.connections[1].mappings[0].id = 'map-default';
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections[0].name = body(call).name;
      state.connections[0].mappings = [];
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(form(f.primary, 'Edit bot'), 'switchboard-name'), 'Renamed Primary', 'input');
  f.host.decisions.push('save');
  await changeChat(f.root, 'Primary Council');
  assert.equal(writes(f.calls).length, 1);
  assert.equal(writes(f.calls)[0].path, '/connections/default');
  assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Renamed Primary');
  assert.equal(named(f.root, 'button', 'Manage Renamed Primary').getAttribute('aria-pressed'), 'true');
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'removed chat warning').textContent, /removed/i);
  assert.equal(byAttr(f.primary, 'form', 'aria-label', 'Edit Primary Council'), undefined);
  assert.equal(byAttr(f.primary, 'form', 'aria-label', 'Edit Alerts Council'), undefined);
  assert.equal(await f.host.draft.save(), true);
  assert.equal(writes(f.calls).length, 1, 'neither the removed mapping nor the other bot was written');
});

test('Remove bot confirms the post-Save name and deletes the originally selected ID', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections[0].name = body(call).name;
      state.connections[1].name = 'Primary'; // The old name now belongs to a different ID.
    }
    if (call.path === '/connections/default' && call.init.method === 'DELETE') {
      state.connections = state.connections.filter(item => item.id !== 'default');
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(form(f.primary, 'Edit bot'), 'switchboard-name'), 'Renamed Primary', 'input');
  f.host.decisions.push('save'); f.host.confirmDecisions.push(true);
  await click(button(f.primary, 'Remove bot'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  assert.equal(f.host.confirmations.length, 1);
  const prompt = f.host.confirmations[0];
  assert.equal(prompt.title, 'Remove bot?');
  assert.match(prompt.message, /“Renamed Primary”/);
  assert.doesNotMatch(prompt.message, /“Primary”/);
  assert.deepEqual(writes(f.calls).map(call => [call.init.method, call.path]), [
    ['PUT', '/connections/default'], ['DELETE', '/connections/default'],
  ]);
  assert.deepEqual(f.state().connections.map(item => [item.id, item.name]), [['alerts', 'Primary']]);
});

test('Remove bot does not confirm or delete a different ID if the original disappears during guard Save', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      state.connections = state.connections.filter(item => item.id !== 'default');
      state.connections[0].name = 'Primary';
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(form(f.primary, 'Edit bot'), 'switchboard-name'), 'Renamed Primary', 'input');
  f.host.decisions.push('save'); f.host.confirmDecisions.push(true);
  await click(button(f.primary, 'Remove bot'));
  assert.deepEqual(writes(f.calls).map(call => [call.init.method, call.path]), [['PUT', '/connections/default']]);
  assert.equal(f.host.confirmations.length, 0);
  assert.match(need(byAttr(f.primary, 'p', 'role', 'alert'), 'removed bot warning').textContent, /removed/i);
  assert.deepEqual(f.state().connections.map(item => [item.id, item.name]), [['alerts', 'Primary']]);
});

test('Manual Refresh rebases an untouched receive flag without overwriting a dirty bot name', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      Object.assign(state.connections[0], body(call));
      state.connections[0].transport.enabled = body(call).enabled;
    }
    return state;
  } });
  await settle(); await openBot(f);
  await setValue(input(form(f.primary, 'Edit bot'), 'switchboard-name'), 'My rename', 'input');
  f.state().connections[0].enabled = false;
  f.state().connections[0].transport.enabled = false;
  await click(button(f.root, 'Refresh'));
  const edit = form(f.primary, 'Edit bot');
  assert.equal(input(edit, 'switchboard-name').value, 'My rename');
  assert.equal(named(edit, 'input', 'Receive messages').checked, false);
  assert.equal(f.host.draft.dirty, true);
  await submit(edit);
  assert.equal(writes(f.calls)[0].path, '/connections/default');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'My rename', enabled: false });
  assert.equal(f.host.draft.dirty, false);
});

test('Mutation response explicit enabled false wins over legacy transport.enabled true', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default' && call.init.method === 'PUT') {
      Object.assign(state.connections[0], body(call));
      state.connections[0].transport.enabled = true; // Contradictory legacy field must not re-enable the bot.
    }
    return state;
  } });
  await settle(); await openBot(f);
  let edit = form(f.primary, 'Edit bot');
  await setChecked(named(edit, 'input', 'Receive messages'), false);
  await submit(edit);
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Primary', enabled: false });
  assert.equal(f.state().connections[0].enabled, false);
  assert.equal(f.state().connections[0].transport.enabled, true);
  edit = form(f.primary, 'Edit bot');
  assert.equal(named(edit, 'input', 'Receive messages').checked, false);
  assert.match(named(f.root, 'button', 'Manage Primary').textContent, /Paused/);
  assert.equal(f.host.draft.dirty, false);
  await setValue(input(edit, 'switchboard-name'), 'Still paused', 'input');
  await submit(edit);
  assert.deepEqual(body(writes(f.calls)[1]), { name: 'Still paused', enabled: false });
});

for (const target of ['typing in name', 'focusing editor select', 'focusing pending select']) {
  for (const outcome of ['success', 'failure']) {
    test(`Delayed manual Refresh ${outcome} preserves the same node when ${target}`, async t => {
      let resolveRefresh, rejectRefresh, reads = 0;
      const pending = new Promise((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
      const f = setup(t, { onRequest: ({ call, state }) => {
        if (call.path === '/configuration' && ++reads === 2) return pending;
        return state;
      } });
      await settle(); await openBot(f);
      const fresh = clone(f.state()); fresh.connections[0].name = 'Discovered Primary'; f.setState(fresh);
      const edit = form(f.primary, 'Edit bot');
      const active = target === 'typing in name' ? input(edit, 'switchboard-name')
        : target === 'focusing editor select' ? named(edit, 'select', 'Who answers new chats')
          : named(requestRow(f.primary, 'Primary Rob'), 'select', 'Who answers in Primary Rob');
      const refresh = button(f.root, 'Refresh'); refresh.focus();
      await click(refresh);
      assert.equal(reads, 2);
      assert.equal(refresh.textContent, 'Refreshing…');
      assert.equal(refresh.disabled, true);
      active.focus();
      if (target === 'typing in name') await setValue(active, 'Local draft', 'input');
      if (outcome === 'success') resolveRefresh(fresh); else rejectRefresh(Error('offline'));
      await settle();
      const live = target === 'typing in name' ? input(f.primary, 'switchboard-name')
        : target === 'focusing editor select' ? named(form(f.primary, 'Edit bot'), 'select', 'Who answers new chats')
          : named(requestRow(f.primary, 'Primary Rob'), 'select', 'Who answers in Primary Rob');
      assert.ok(live === active, 'the focused control must remain the same connected node');
      assert.ok(document.activeElement === active, 'the same control must retain focus');
      assert.ok(form(f.primary, 'Edit bot') === edit, 'response must not replace the editing form');
      if (target === 'typing in name') {
        assert.equal(active.value, 'Local draft');
        assert.equal(f.host.draft.dirty, true);
      }
      assert.ok(named(f.root, 'button', 'Manage Primary'), 'the interactive response is deferred');
      const nextRefresh = button(f.root, 'Refresh');
      assert.equal(nextRefresh.disabled, false);
      nextRefresh.focus(); await click(nextRefresh);
      assert.equal(reads, 3, 'a subsequent manual refresh is usable');
      assert.equal(button(f.root, 'Refresh').disabled, false);
      assert.ok(named(f.root, 'button', 'Manage Discovered Primary'));
      if (target === 'typing in name') assert.equal(input(form(f.primary, 'Edit bot'), 'switchboard-name').value, 'Local draft');
      assert.equal(writes(f.calls).length, 0);
    });
  }
}

test('Late submit from a detached bot form cannot save the current chat editor', async t => {
  let fail = true;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      if (fail) { fail = false; throw Error('offline'); }
      Object.assign(state.connections[0].mappings[0], body(call));
    }
    return state;
  } });
  await settle(); await openBot(f);
  const oldForm = form(f.primary, 'Edit bot');
  await changeChat(f.root, 'Primary Council');
  assert.equal(descendants(f.primary).includes(oldForm), false);
  const current = form(f.primary, 'Edit Primary Council');
  await setValue(named(current, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(writes(f.calls).length, 1, 'the automatic attempt failed');
  const failedForm = form(f.primary, 'Edit Primary Council');
  await submit(oldForm);
  assert.equal(writes(f.calls).length, 1, 'a stale bot submit must not retry the chat');
  assert.equal(form(f.primary, 'Edit Primary Council'), failedForm);
  assert.equal(f.host.draft.dirty, true);
  assert.equal(await f.host.draft.save(), true);
  assert.equal(writes(f.calls)[1].path, '/connections/default/mappings/map-default');
  assert.deepEqual(body(writes(f.calls)[1]), { agentId: 'smatchet', enabled: true });
});

test('Late submit from a detached chat form cannot save a different bot editor', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/alerts' && call.init.method === 'PUT') Object.assign(state.connections[1], body(call));
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  const oldForm = form(f.primary, 'Edit Primary Council');
  await chooseBot(f, 'Alerts');
  assert.equal(descendants(f.primary).includes(oldForm), false);
  const current = form(f.primary, 'Edit bot');
  await setValue(input(current, 'switchboard-name'), 'Alerts pending', 'input');
  assert.equal(f.host.draft.dirty, true);
  await submit(oldForm);
  assert.equal(writes(f.calls).length, 0, 'a stale chat submit must not save the other bot');
  assert.equal(form(f.primary, 'Edit bot'), current);
  assert.equal(f.host.draft.dirty, true);
  await submit(current);
  assert.equal(writes(f.calls)[0].path, '/connections/alerts');
  assert.deepEqual(body(writes(f.calls)[0]), { name: 'Alerts pending', enabled: true });
});

test('Chat responder autosaves immediately, publishes busy, suppresses duplicates and retains every chat', async t => {
  const initial = config();
  Object.assign(initial.connections[0], { agentId: 'hatchet' });
  Object.assign(initial.connections[0].mappings[0], { inheritedAgent: true, enabled: false });
  initial.connections[0].mappings.push({ id: 'map-other', chatId: '-other', chatTitle: 'Other room', chatType: 'group', agentId: 'hatchet', inheritedAgent: false, enabled: true });
  const pending = deferred();
  const f = setup(t, { initial, overflow: true, onRequest: ({ call, state }) => call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT' ? pending.promise : state });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  let edit = form(f.primary, 'Edit Primary Council');
  const select = named(edit, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, '__bot_default__');
  assert.equal(byText(edit, 'button', 'Save chat'), undefined);
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
  const cleanScope = f.host.draft;
  await setValue(select, '__bot_default__');
  assert.equal(await cleanScope.save(), true);
  assert.equal(writes(f.calls).length, 0, 'an unchanged selection never writes');

  select.focus();
  select.value = 'smatchet';
  select.dispatchEvent({ type: 'change' });
  assert.equal(writes(f.calls).length, 1, 'the change event starts PUT synchronously');
  assert.equal(writes(f.calls)[0].init.method, 'PUT');
  assert.equal(writes(f.calls)[0].path, '/connections/default/mappings/map-default');
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: 'smatchet', enabled: false });
  assert.equal(f.host.draft.busy, true);
  assert.equal(f.host.draft.dirty, true);
  edit = form(f.primary, 'Edit Primary Council');
  const busySelect = named(edit, 'select', 'Who answers in Primary Council');
  assert.equal(busySelect.disabled, true);
  assert.equal(button(edit, 'Cancel').disabled, true);
  assert.equal(named(f.root, 'button', 'Manage Alerts').disabled, true);
  assert.match(need(byAttr(edit, 'p', 'role', 'status'), 'saving status').textContent, /Saving/);
  assert.doesNotMatch(edit.textContent, /saved\./i, 'no success is shown before the response');
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
  assert.equal(await f.host.draft.save(), false);
  select.dispatchEvent({ type: 'change' }); // The detached first control is also harmless.
  busySelect.value = '__bot_default__'; busySelect.dispatchEvent({ type: 'change' });
  edit.dispatchEvent({ type: 'submit' });
  const navigations = f.host.navigations.length;
  named(f.root, 'button', 'Manage Alerts').dispatchEvent({ type: 'click' });
  button(edit, 'Cancel').dispatchEvent({ type: 'click' });
  assert.equal(f.host.navigations.length, navigations);
  assert.equal(writes(f.calls).length, 1);

  const accepted = clone(f.state());
  Object.assign(accepted.connections[0].mappings[0], { agentId: 'smatchet', inheritedAgent: false });
  pending.resolve(accepted); await settle();
  edit = form(f.primary, 'Edit Primary Council');
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').disabled, false);
  assert.equal(f.host.draft.dirty, false); assert.equal(f.host.draft.busy, false);
  assert.match(edit.textContent, /Primary Council saved\./);
  assert.equal(byText(edit, 'button', 'Save chat'), undefined);
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
  assert.equal(await f.host.draft.save(), true);
  assert.equal(writes(f.calls).length, 1);
  await click(button(edit, 'Cancel'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: false, busy: false });
  assert.match(row(f.primary, 'Primary Council').textContent, /Paused/);
  assert.match(row(f.primary, 'Primary Council').textContent, /Smatchet answers/);
  assert.match(row(f.primary, 'Other room').textContent, /Hatchet answers/);
});

test('Failed chat autosave shows actionable error, preserves Retry across refresh, and retries only that choice', async t => {
  let attempts = 0; const pending = deferred();
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      if (++attempts === 1) throw Error('agent_disabled');
      return pending.promise;
    }
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  let edit = form(f.primary, 'Edit Primary Council');
  assert.equal(writes(f.calls).length, 1);
  assert.match(need(byAttr(edit, 'p', 'role', 'alert'), 'request failure').textContent, /Could not save chat.*disabled/);
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(f.host.draft.dirty, true); assert.equal(f.host.draft.busy, false);
  assert.equal(byText(edit, 'button', 'Save chat'), undefined);
  assert.ok(button(edit, 'Retry saving'));
  await click(button(f.root, 'Refresh'));
  edit = form(f.primary, 'Edit Primary Council');
  assert.match(need(byAttr(edit, 'p', 'role', 'alert'), 'failure after refresh').textContent, /disabled/);
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(f.host.draft.dirty, true);
  assert.equal(writes(f.calls).length, 1, 'refresh does not retry the failed save');
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');

  const retry = button(edit, 'Retry saving');
  retry.dispatchEvent({ type: 'click' });
  assert.equal(writes(f.calls).length, 2);
  assert.deepEqual(writes(f.calls).map(body), [{ agentId: 'smatchet', enabled: true }, { agentId: 'smatchet', enabled: true }]);
  assert.equal(f.host.draft.busy, true); assert.equal(f.host.draft.dirty, true);
  edit = form(f.primary, 'Edit Primary Council');
  assert.match(need(byAttr(edit, 'p', 'role', 'status'), 'retry saving status').textContent, /Saving/);
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').disabled, true);
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
  retry.dispatchEvent({ type: 'click' });
  assert.equal(await f.host.draft.save(), false);
  assert.equal(writes(f.calls).length, 2);
  const accepted = clone(f.state()); accepted.connections[0].mappings[0].agentId = 'smatchet';
  pending.resolve(accepted); await settle();
  edit = form(f.primary, 'Edit Primary Council');
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(f.host.draft.dirty, false); assert.equal(f.host.draft.busy, false);
  assert.match(edit.textContent, /saved/i);
  assert.equal(byAttr(edit, 'p', 'role', 'alert'), undefined);
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
});

test('Failed chat autosave uses host guard Stay and failed or successful Save before Cancel', async t => {
  let attempts = 0;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      if (++attempts < 3) throw Error('offline');
      Object.assign(state.connections[0].mappings[0], body(call));
    }
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(f.host.draft.dirty, true); assert.equal(writes(f.calls).length, 1);
  f.host.decisions.push('stay'); await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  assert.equal(writes(f.calls).length, 1);
  assert.equal(named(f.primary, 'select', 'Who answers in Primary Council').value, 'smatchet');
  f.host.decisions.push('save'); await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.equal(writes(f.calls).length, 2);
  assert.equal(f.host.draft.dirty, true);
  assert.match(need(byAttr(form(f.primary, 'Edit Primary Council'), 'p', 'role', 'alert'), 'retry error').textContent, /offline/);
  assert.equal(named(f.primary, 'select', 'Who answers in Primary Council').value, 'smatchet');
  f.host.decisions.push('save'); await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.deepEqual(writes(f.calls).map(body), Array(3).fill({ agentId: 'smatchet', enabled: true }));
  assert.ok(form(f.primary, 'Edit bot'));
  assert.equal(f.host.draft.dirty, false); assert.equal(f.host.draft.busy, false);
  assert.match(row(f.primary, 'Primary Council').textContent, /Smatchet answers/);
});

test('Failed chat autosave uses Discard without retry when returning to bot', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  f.host.decisions.push('discard'); await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: true, busy: false });
  assert.equal(writes(f.calls).length, 1);
  assert.equal(f.host.draft.dirty, false);
  assert.match(row(f.primary, 'Primary Council').textContent, /Hatchet answers/);
  await changeChat(f.root, 'Primary Council');
  assert.equal(named(f.primary, 'select', 'Who answers in Primary Council').value, 'hatchet', 'Discard restored the accepted value');
  assert.equal(f.host.draft.dirty, false);
});

test('Unmount during chat autosave aborts the write and ignores a late completion', async t => {
  const pending = deferred();
  const f = setup(t, { overflow: true, onRequest: ({ call, state }) => call.init.method === 'PUT' ? pending.promise : state });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.equal(f.host.draft.busy, true);
  const signal = writes(f.calls)[0].init.signal;
  f.unmount(); assert.equal(signal.aborted, true); assert.equal(f.host.draft, null);
  const snapshots = f.host.snapshots.length;
  pending.resolve(f.state()); await settle();
  assert.equal(f.host.snapshots.length, snapshots);
  assert.equal(f.primary.childNodes.length, 0); assert.equal(f.overflowRoot.childNodes.length, 0);
});

test('Chat default and explicit selection of the same effective goblin remain distinct', async t => {
  const initial = config(); initial.connections[0].agentId = 'hatchet'; initial.connections[0].mappings[0].inheritedAgent = true;
  const f = setup(t, { initial, onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') {
      const update = body(call);
      Object.assign(state.connections[0].mappings[0], { agentId: update.agentId ?? state.connections[0].agentId, inheritedAgent: update.agentId === null });
    }
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  let select = named(f.primary, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, '__bot_default__');
  await setValue(select, 'hatchet');
  assert.deepEqual(body(writes(f.calls)[0]), { agentId: 'hatchet', enabled: true }, 'same effective agent can still be a new explicit override');
  select = named(f.primary, 'select', 'Who answers in Primary Council');
  assert.equal(select.value, 'hatchet');
  await setValue(select, '__bot_default__');
  assert.deepEqual(body(writes(f.calls)[1]), { agentId: null, enabled: true }, 'restoring inherited mode writes null explicitly');
  assert.equal(named(f.primary, 'select', 'Who answers in Primary Council').value, '__bot_default__');
  assert.equal(f.host.draft.dirty, false);
  await click(button(form(f.primary, 'Edit Primary Council'), 'Cancel'));
  assert.match(row(f.primary, 'Primary Council').textContent, /Hatchet answers · uses bot default/);
});

test('A chat save failure and a subsequent refresh failure are both visible and retryable', async t => {
  let reads = 0;
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/configuration' && ++reads === 2) throw Error('refresh offline');
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('agent_disabled');
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  await click(button(f.root, 'Refresh'));
  const edit = form(f.primary, 'Edit Primary Council');
  const errors = byTag(edit, 'p').filter(node => node.getAttribute('role') === 'alert').map(node => node.textContent);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Could not save chat.*disabled/);
  assert.match(errors[1], /Could not refresh bots.*refresh offline/);
  assert.ok(button(edit, 'Retry saving'));
  assert.equal(f.host.draft.dirty, true);
  assert.equal(named(edit, 'select', 'Who answers in Primary Council').value, 'smatchet');
  assert.equal(writes(f.calls).length, 1);
});

test('Cancel remains guarded after a failed chat edit is abandoned by selecting its accepted value', async t => {
  const f = setup(t, { onRequest: ({ call, state }) => {
    if (call.path === '/connections/default/mappings/map-default' && call.init.method === 'PUT') throw Error('offline');
    return state;
  } });
  await settle(); await openBot(f); await changeChat(f.root, 'Primary Council');
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'smatchet');
  assert.ok(button(form(f.primary, 'Edit Primary Council'), 'Retry saving'));
  await setValue(named(f.primary, 'select', 'Who answers in Primary Council'), 'hatchet');
  const edit = form(f.primary, 'Edit Primary Council');
  assert.equal(f.host.draft.dirty, false);
  assert.equal(writes(f.calls).length, 1, 'revert to the accepted value performs no new write');
  assert.equal(byAttr(edit, 'p', 'role', 'alert'), undefined);
  assert.equal(byText(edit, 'button', 'Retry saving'), undefined);
  await click(button(edit, 'Cancel'));
  assert.deepEqual(f.host.navigations.at(-1), { dirty: false, busy: false });
  assert.match(row(f.primary, 'Primary Council').textContent, /Hatchet answers/);
});
