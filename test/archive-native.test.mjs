import test from 'node:test';
import assert from 'node:assert/strict';
import { mountArchive } from '../ui/archive.js';

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

const record = (id, extra = {}) => ({ id, recordId: `in:${id}`, connectionId: 'one', connectionName: 'Primary', transportType: 'telegram', direction: 'inbound', status: 'completed', chatTitle: `Chat ${id}`, agentId: 'goblin-42', sessionId: 'session-1', at: '2026-11-04T12:00:00Z', ...extra });
const snapshot = () => ({ records: [record('first'), record('second', { connectionId: 'two', connectionName: 'Alerts', transportType: 'discord', direction: 'outbound', status: 'delivered' })], coverage: { kind: 'retained', count: 2, limit: 10000, truncated: false, legacyImported: true } });
test.beforeEach(() => { globalThis.document = makeDocument(); });
test.afterEach(() => { delete globalThis.document; });
const mount = (t, state, options = {}) => {
  const root = new FakeNode('div'); root.contains = node => descendants(root).includes(node);
  let header, tick, cleared = false, requests = [];
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (callback, ms) => { assert.equal(ms, 10000); tick = callback; return 123; };
  globalThis.clearInterval = () => { cleared = true; };
  const mounted = mountArchive({ root, api: async (path, init) => { requests.push({ path, init }); return structuredClone(state); }, configureHeader: value => { header = value; }, ...options });
  t.after(() => { mounted.unmount(); globalThis.setInterval = realSet; globalThis.clearInterval = realClear; });
  return { root, mounted, header: () => header, tick: async () => { tick(); await settle(); }, requests, cleared: () => cleared };
};
const cards = root => byClass(root, 'archive-session-card');

test('Archive uses native host controls and historical work only, never current configuration', async t => {
  const state = snapshot(); state.connections = [{ name: 'CURRENT SECRET', pending: [{ chatTitle: 'Pending admissions' }] }];
  const f = mount(t, state); await settle();
  assert.deepEqual(f.header().categories.map(x => x.id), ['work', 'inbound', 'outbound']);
  assert.equal(f.header().participantLabel, 'Historical bot'); assert.equal(f.header().participantsDisabled, false);
  assert.equal(f.header().participants.length, 2); assert.equal(byTag(f.root, 'input').length, 0); assert.equal(byTag(f.root, 'select').length, 0);
  const reader = named(f.root, 'section', 'Switchboard work details');
  assert.equal(reader.children[0].className, 'archive-reader-toolbar'); assert.equal(reader.children[1].className, 'archive-content-body');
  assert.equal(cards(f.root)[0].getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(f.root.textContent, /Pending admissions|CURRENT SECRET|Approved mappings|Refresh|Connected|Settings/);
  assert.deepEqual(f.requests.map(r => r.path), ['/archive']); assert.ok(f.requests.every(r => !r.init.method));
  assert.match(f.root.textContent, /1 completed · 1 delivered/); assert.match(f.root.textContent, /not unique conversations or lifetime totals/);
  assert.match(f.root.textContent, /Message bodies and completed work artifacts are not stored/);
  assert.equal(byClass(f.root, 'archive-session-card').some(node => byClass(node, 'archive-session-card').length > 1), false);
});

test('Search and outcome statistics cover retained records before pagination and combine filters', async t => {
  const state = snapshot(); state.records = Array.from({ length: 125 }, (_, i) => record(`d${i}`));
  state.records.push(record('needle', { chatTitle: 'Needle beyond first page', direction: 'outbound', status: 'delivered', connectionId: 'two' }));
  const f = mount(t, state); await settle(); assert.equal(cards(f.root).length, 50); assert.match(f.root.textContent, /126 records/);
  assert.match(f.root.textContent, /125 completed · 1 delivered/);
  await click(named(f.root, 'button', 'Load more historical records')); assert.equal(cards(f.root).length, 100); assert.equal(document.activeElement, cards(f.root)[50]);
  f.mounted.update({ filters: { search: 'Needle', category: 'outbound' } }); assert.match(f.root.textContent, /1 records/); assert.match(f.root.textContent, /1 delivered/);
  f.mounted.update({ filters: { search: 'Needle', participantId: 'one' } }); assert.match(f.root.textContent, /0 records/); assert.match(f.root.textContent, /No matching records/);
  assert.doesNotMatch(named(f.root, 'section', 'Switchboard work details').textContent, /Needle/);
  f.mounted.update({ filters: { search: 'session-1', category: 'inbound' } }); assert.match(f.root.textContent, /125 records/);
});

test('Calendar applies to every category in the host timezone including DST and unknown timestamps', async t => {
  const state = snapshot(); state.records = [
    record('before', { at: '2026-11-01T03:59:00Z' }), record('first', { at: '2026-11-01T05:30:00Z' }),
    record('second', { at: '2026-11-01T06:30:00Z' }), record('after', { at: '2026-11-02T05:00:00Z' }), record('unknown', { at: null }),
  ];
  const f = mount(t, state, { date: '2026-11-01', timeZone: 'America/New_York' }); await settle(); assert.match(f.root.textContent, /2 records/);
  assert.deepEqual(cards(f.root).map(n => n.getAttribute('data-record-id')), ['first', 'second']);
  f.mounted.update({ filters: { category: 'inbound' }, date: '1900-01-01' }); assert.match(f.root.textContent, /0 records/);
  f.mounted.update({ filters: {}, date: '' }); assert.match(f.root.textContent, /5 records/);
});

test('Historical names are disambiguated and header is stable across searches', async t => {
  const state = snapshot(); state.records[1].connectionName = 'Primary'; let calls = 0, header;
  const f = mount(t, state, { configureHeader: h => { calls++; header = h; } }); await settle();
  assert.deepEqual(header.participants.map(x => x.label), ['Primary (one) · Telegram', 'Primary (two) · Discord']);
  const before = calls; f.mounted.update({ filters: { search: 'Primary' } }); assert.equal(calls, before);
});

test('No old /configuration fallback; unsupported host response stays unavailable and retries', async t => {
  const f = mount(t, { connections: [] }); await settle(); assert.match(f.root.textContent, /History unknown/); assert.match(f.root.textContent, /History unavailable/);
  assert.doesNotMatch(f.root.textContent, /0 records|No historical work recorded/); await f.tick(); assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.path === '/archive'));
});

for (const empty of [false, true]) test(`Initial failures automatically recover to ${empty ? 'empty history' : 'work'}`, async t => {
  let reads = 0; const state = snapshot(); if (empty) state.records = [];
  const f = mount(t, state, { api: async () => { if (++reads === 1) throw Error('offline'); return state; } }); await settle();
  assert.match(f.root.textContent, /History unknown/); assert.match(f.root.textContent, /Automatic retry pending: offline/); assert.equal(f.header().participantsDisabled, true);
  await f.tick(); assert.equal(reads, 2); assert.doesNotMatch(f.root.textContent, /offline|History unknown/);
  assert.match(f.root.textContent, empty ? /No historical work recorded yet/ : /2 records/);
});

test('Polling respects visibility, prevents overlap, preserves reader and aborts late requests', async t => {
  const requests = []; const f = mount(t, null, { api: (path, init) => { assert.equal(path, '/archive'); return new Promise(resolve => requests.push({ resolve, signal: init.signal })); } });
  f.mounted.update({ filters: { participantId: 'two' } }); requests[0].resolve(snapshot()); await settle(); assert.equal(cards(f.root).length, 1);
  const reader = named(f.root, 'section', 'Switchboard work details'), toolbar = reader.children[0]; reader.children[1].scrollTop = 37;
  document.hidden = true; await f.tick(); assert.equal(requests.length, 1); document.hidden = false; await f.tick(); await f.tick(); assert.equal(requests.length, 2);
  requests[1].resolve(snapshot()); await settle(); assert.equal(reader.children[0], toolbar); assert.equal(reader.children[1].scrollTop, 37);
  await f.tick(); f.mounted.unmount(); assert.equal(f.cleared(), true); assert.ok(requests.every(r => r.signal.aborted)); requests[2].resolve(snapshot()); await settle(); assert.equal(f.root.textContent, '');
});

test('Failure keeps selected stale history, then automatic recovery clears warning', async t => {
  let fail = false; const f = mount(t, null, { api: async () => { if (fail) throw Error('offline'); return snapshot(); } }); await settle();
  cards(f.root)[1].focus(); await click(cards(f.root)[1]); const reader = named(f.root, 'section', 'Switchboard work details');
  fail = true; await f.tick(); assert.match(f.root.textContent, /Showing stale history/); assert.match(reader.textContent, /Chat second/); assert.equal(document.activeElement, cards(f.root)[1]);
  fail = false; await f.tick(); assert.doesNotMatch(f.root.textContent, /stale|offline/); assert.equal(cards(f.root)[1].getAttribute('aria-pressed'), 'true');
});

test('Incoming history is deferred during selection or editing, then applied without disturbing focus', async t => {
  const requests = []; const f = mount(t, null, { api: () => new Promise(resolve => requests.push(resolve)) });
  requests[0](snapshot()); await settle(); cards(f.root)[1].focus(); await click(cards(f.root)[1]);
  await f.tick(); const edit = new FakeNode('textarea'); f.root.append(edit); edit.focus();
  const changed = snapshot(); changed.records[1].chatTitle = 'Updated outcome'; requests[1](changed); await settle(); assert.doesNotMatch(f.root.textContent, /Updated outcome/);
  document.activeElement = null; f.root.dispatchEvent({ type: 'focusout' }); await settle(); assert.match(f.root.textContent, /Updated outcome/);
  await f.tick(); const reader = named(f.root, 'section', 'Switchboard work details'); let selection = { isCollapsed: false, anchorNode: reader.children[0] }; document.getSelection = () => selection;
  const latest = snapshot(); latest.records[1].chatTitle = 'Selected outcome'; requests[2](latest); await settle(); assert.doesNotMatch(f.root.textContent, /Selected outcome/);
  selection.isCollapsed = true; f.root.dispatchEvent({ type: 'mouseup' }); assert.match(f.root.textContent, /Selected outcome/);
  for (const tag of ['input', 'select', 'textarea', 'summary', 'div']) { const control = new FakeNode(tag); if (tag === 'div') control.isContentEditable = true; f.root.append(control); control.focus(); await f.tick(); assert.equal(requests.length, 3); control.remove(); }
});

test('Untrusted historical values render only as text; retention is clearly scoped', async t => {
  const state = snapshot(); state.records[0].chatTitle = '<img src=x onerror=alert(1)>'; state.records[0].error = '<script>bad()</script>'; state.coverage.truncated = true;
  const f = mount(t, state); await settle(); assert.match(f.root.textContent, /<img src=x onerror=alert\(1\)>/); assert.match(f.root.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(byTag(f.root, 'img').length, 0); assert.equal(byTag(f.root, 'script').length, 0); assert.match(f.root.textContent, /Older archive records removed by retention/);
});

test('Capture failures show possible historical gaps separately from network stale warnings', async t => {
  const state = snapshot(); state.warning = 'archive_capture_failed'; state.coverage.byteLimit = 8000000;
  let fail = false; const f = mount(t, state, { api: async () => { if (fail) throw Error('offline'); return state; } }); await settle();
  assert.match(f.root.textContent, /Some history could not be saved/); assert.match(f.root.textContent, /8000000 bytes/); assert.doesNotMatch(f.root.textContent, /stale/);
  fail = true; await f.tick(); assert.match(f.root.textContent, /may have gaps/); assert.match(f.root.textContent, /Showing stale history/);
});

test('Browser-like HTMLCollections and changed records preserve selected row focus and reader scroll', async t => {
  class CollectionNode extends FakeNode {
    get children() { return Object.assign({ length: this.childNodes.length, [Symbol.iterator]: function* () { yield* Object.values(this).filter(x => x instanceof FakeNode); } }, Object.fromEntries(this.childNodes.filter(n => n.tagName !== '#TEXT').map((n, i) => [i, n]))); }
  }
  document.createElement = tag => new CollectionNode(tag);
  const state = snapshot(); const f = mount(t, state); await settle(); cards(f.root)[1].focus(); await click(cards(f.root)[1]);
  const reader = named(f.root, 'section', 'Switchboard work details'); reader.children[1].scrollTop = 17;
  assert.equal(reader.children.find, undefined); state.records[1] = { ...state.records[1], chatTitle: 'Changed historical title' };
  await f.tick(); assert.equal(document.activeElement, cards(f.root)[1]); assert.equal(cards(f.root)[1].getAttribute('aria-pressed'), 'true');
  assert.match(reader.textContent, /Changed historical title/); assert.equal(reader.children[1].scrollTop, 17);
});

test('Bot removal history describes bridge interruption without claiming Core cancellation or send outcome', async t => {
  const state = snapshot();
  state.records[0] = record('removed', { status: 'interrupted', error: 'connection_stopped_for_removal', connectionName: 'Removed bot' });
  const f = mount(t, state); await settle();
  const reader = named(f.root, 'section', 'Switchboard work details');
  assert.match(reader.textContent, /The bridge stopped for bot removal\. This does not establish whether the Core work stopped or an uncertain send reached its destination\./);
  assert.match(reader.textContent, /Recorded delivery metadata/);
  assert.match(reader.textContent, /Message bodies and completed work artifacts are not stored/);
  assert.doesNotMatch(f.root.textContent, /Pending admissions|Approved mappings|Settings|Needs token|Connection problem/);
  assert.equal(byTag(reader, 'input').length, 0); assert.equal(byTag(reader, 'select').length, 0); assert.equal(byTag(reader, 'button').length, 0);
  await click(cards(f.root)[1]);
  assert.doesNotMatch(reader.textContent, /The bridge stopped for bot removal/);
});

test('10,000-record search/date updates reuse snapshot indexes and timezone formatters', async t => {
  const Original = Intl.DateTimeFormat;
  let constructors = 0, formats = 0, dayFormats = 0, headers = 0;
  Intl.DateTimeFormat = class extends Original {
    constructor(...args) { super(...args); constructors++; }
    get format() { const format = super.format; return value => { formats++; return format(value); }; }
    formatToParts(...args) { dayFormats++; return super.formatToParts(...args); }
  };
  t.after(() => { Intl.DateTimeFormat = Original; });
  const state = snapshot(); state.records = Array.from({ length: 10000 }, (_, i) => record(`large-${i}`, {
    at: new Date(Date.UTC(2026, 10, 1 + i % 4, 12, 0, i % 60, i % 1000)).toISOString(),
    chatTitle: `Large historical room ${i}`,
  }));
  const f = mount(t, state, { configureHeader: () => { headers++; } }); await settle();
  assert.equal(constructors, 2); assert.ok(formats > 0 && dayFormats > 0);
  const counts = [constructors, formats, dayFormats, headers];
  for (let i = 0; i < 6; i++) {
    f.mounted.update({ filters: { search: `Large historical room ${9999 - i}` }, timeZone: 'UTC' });
    assert.equal(cards(f.root).length, 1); assert.equal(cards(f.root)[0].getAttribute('data-record-id'), `large-${9999 - i}`);
    f.mounted.update({ filters: {}, date: `2026-11-0${1 + i % 4}`, timeZone: 'UTC' });
    assert.match(f.root.textContent, /2500 records/);
  }
  assert.deepEqual([constructors, formats, dayFormats, headers], counts, 'filter changes do not format or rebuild the bot header');
  await f.tick(); assert.deepEqual([constructors, formats, dayFormats, headers], counts, 'unchanged polling does not rebuild indexes');
  f.mounted.update({ filters: {}, date: '2026-11-01', timeZone: 'America/New_York' });
  assert.equal(constructors, 4); assert.ok(formats > counts[1] && dayFormats > counts[2]); assert.equal(headers, counts[3]);
  const zoneCounts = [constructors, formats, dayFormats];
  f.mounted.update({ filters: { search: 'Large historical room 9999' }, timeZone: 'America/New_York' });
  assert.deepEqual([constructors, formats, dayFormats], zoneCounts);
});

test('List keeps compact scope and retention warnings; full limitations belong to the reader', async t => {
  const state = snapshot(); state.coverage.truncated = true; state.coverage.byteLimit = 8000000;
  const f = mount(t, state); await settle();
  const list = named(f.root, 'section', 'Switchboard historical work');
  const notes = Array.from(list.children).filter(n => n.className === 'archive-snapshot-note');
  assert.equal(notes.length, 2); assert.ok(notes.map(n => n.textContent).join(' ').length < 180);
  assert.match(list.textContent, /Matching retained:/); assert.match(list.textContent, /Older archive records removed by retention/);
  assert.doesNotMatch(list.textContent, /Earlier versions|8000000 bytes|unique conversations/);
  const reader = named(f.root, 'section', 'Switchboard work details');
  assert.match(reader.textContent, /not unique conversations or lifetime totals/); assert.match(reader.textContent, /8000000 bytes/);
});

test('Coverage-only polling updates reader limits without changing selected historical record', async t => {
  const state = snapshot(); state.coverage.byteLimit = 8000000;
  const f = mount(t, state); await settle();
  await click(cards(f.root)[1]);
  const reader = named(f.root, 'section', 'Switchboard work details'); reader.children[1].scrollTop = 41;
  assert.match(reader.textContent, /up to 10000 records \/ 8000000 bytes/);
  state.coverage.limit = 9000; state.coverage.byteLimit = 7000000;
  await f.tick();
  assert.equal(cards(f.root)[1].getAttribute('aria-pressed'), 'true');
  assert.match(reader.textContent, /up to 9000 records \/ 7000000 bytes/);
  assert.doesNotMatch(reader.textContent, /10000|8000000/);
  assert.equal(reader.children[1].scrollTop, 41);
});
