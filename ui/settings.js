export const settingsSections = Object.freeze([{ id: 'bots', label: 'Bots' }]);

let selectedConnectionId = 'default';
const DEFAULT_AGENT = '__bot_default__';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'className') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name === 'htmlFor') node.htmlFor = value;
    else node.setAttribute(name, value);
  }
  node.append(...children); return node;
}
function message(error, fallback) {
  const code = error instanceof Error ? error.message : '';
  const explanations = {
    agent_required: 'Choose who answers this bot before allowing a server.',
    agent_not_found: 'That goblin is unavailable. Choose an enabled goblin.',
    agent_disabled: 'That goblin is disabled. Choose an enabled goblin.',
    telegram_auth_failed: 'Telegram rejected this token. Check the token from BotFather.',
    discord_auth_failed: 'Discord rejected this token. Check the token in the Developer Portal.',
    telegram_bot_changed_add_connection: 'That token belongs to a different bot. Use Add bot instead.',
    discord_bot_changed_add_connection: 'That token belongs to a different bot. Use Add bot instead.',
    telegram_bot_already_connected: 'This Telegram bot is already connected.',
    discord_bot_already_connected: 'This Discord bot is already connected.',
  };
  return explanations[code] || (code ? code.replaceAll('_', ' ') : fallback);
}
function label(item) { return String(item?.chatTitle || item?.title || item?.chatId || 'Unnamed chat'); }
function topic(item) { return item?.topicId != null ? ` · topic ${item.topicId}` : ''; }
function date(value) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString(); }
function transportType(value) { return value === 'discord' ? 'discord' : 'telegram'; }
function transportName(value) { return transportType(value) === 'discord' ? 'Discord' : 'Telegram'; }
function inherited(item) { return (item.inheritedAgent ?? item.inherited) === true; }
function normalizeConnection(value = {}, core = {}) {
  const transport = value.transport || {};
  return { ...value, agentId: value.agentId ?? null, servers: value.servers || [], pendingServers: value.pendingServers || [], id: String(value.id || 'default'), name: String(value.name || 'Default bot'), transportType: transportType(value.transportType), enabled: typeof value.enabled === 'boolean' ? value.enabled : transport.enabled === true, tokenConfigured: typeof value.tokenConfigured === 'boolean' ? value.tokenConfigured : value.bot?.configured === true, bot: value.bot || value.botIdentity || {}, transport, core: value.coreAgentTurns || { available: core.available === true, reason: core.reason }, mappings: value.mappings || [], pending: value.pending || value.pendingAdmissions || [], deliveries: value.deliveries || value.recentDeliveries || [] };
}
function normalize(value = {}) {
  const core = value.coreAgentTurns || value.core || {};
  // An explicitly empty registry is not a legacy default connection.
  const source = Array.isArray(value.connections) ? value.connections : [{ ...value, id: 'default', name: value.name || 'Default bot' }];
  return { core, connections: source.map(item => normalizeConnection(item, core)) };
}
function request(api, controller, path, init = {}) { return api(path, { ...init, signal: controller.signal, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }); }

// Presentation is the host's Settings API, not a second design system. See
// Burrow-UI/docs/MOD_SETTINGS_UI_API.md and Connections → MCP servers.
export function mountSettings({ section, primary, overflow = null, agents = [], api, confirm, navigate, setDraft }) {
  if (['status', 'configuration', 'pending-admissions', 'chat-mappings'].includes(section)) section = 'bots';
  if (!settingsSections.some(item => item.id === section)) return;
  const panel = el('section', { className: 'setting-section', 'aria-label': 'Switchboard bots' });
  const inventory = el('div', { className: overflow ? 'settings-overflow-content memory-saved' : '', 'aria-label': 'Your bots' });
  primary.replace(panel);
  if (![confirm, navigate, setDraft].every(value => typeof value === 'function')) {
    panel.append(el('h2', { text: 'Switchboard settings unavailable' }), el('p', { className: 'settings-request-error', role: 'alert', text: 'This Switchboard editor needs the updated Burrow Settings host. Update Burrow UI and Switchboard together. Existing bots continue running.' }));
    return () => panel.remove();
  }
  if (overflow) overflow.replace(inventory);
  const controller = new AbortController();
  let mounted = true, loading = false, busy = false, confirming = false, aggregate = null, editor = null;
  let feedback = '', failed = '', stateRevision = 0, editRevision = 0, saveControl = null, dirtyControl = null, currentForm = null;
  const pendingAgents = new Map();
  const connection = () => aggregate?.connections.find(item => item.id === selectedConnectionId) || aggregate?.connections[0] || null;
  const pathFor = state => `/connections/${encodeURIComponent(state.id)}`;
  const enabledAgent = id => agents.some(item => item.id === id && item.enabled !== false);
  const agentName = id => agents.find(item => item.id === id)?.name || id || 'No goblin';
  const responderName = id => `${agentName(id)}${enabledAgent(id) ? '' : ' (unavailable)'}`;
  const draftValues = draft => draft.kind === 'chat' ? [draft.agentId] : [draft.name, draft.transport, draft.agentId, draft.enabled, draft.token];
  const dirty = () => Boolean(editor && JSON.stringify(draftValues(editor)) !== editor.baseline);
  function botDraft(state = null) {
    const draft = { kind: state ? 'bot' : 'new', connectionId: state?.id, name: state?.name || '', transport: state?.transportType || 'telegram', agentId: state?.agentId || '', originalAgentId: state?.agentId || '', enabled: state?.enabled ?? true, token: '' };
    draft.baseline = JSON.stringify(draftValues(draft)); return draft;
  }
  function chatDraft(state, item) {
    const draft = { kind: 'chat', connectionId: state.id, id: item.id, agentId: inherited(item) && state.agentId ? DEFAULT_AGENT : item.agentId || '' };
    draft.baseline = JSON.stringify(draftValues(draft)); return draft;
  }
  function publish() {
    if (!mounted) return;
    if (saveControl) saveControl.disabled = busy || !dirty() || Boolean(editor?.orphaned);
    if (dirtyControl) {
      const chatSaving = editor?.kind === 'chat' && editor.saving && busy;
      dirtyControl.textContent = chatSaving ? 'Saving…' : dirty() ? 'Unsaved changes' : '';
      dirtyControl.hidden = !dirty() && !chatSaving;
    }
    setDraft({ dirty: dirty(), busy: busy || confirming, save: saveEditor, discard: discardDraft });
  }
  function update(draft, key, value) { if (busy || !mounted || editor !== draft) return; draft[key] = value; editRevision++; publish(); }
  function discardDraft() {
    if (!mounted || busy) return;
    if (editor?.kind === 'new') editor = botDraft();
    else if (editor) {
      const state = aggregate?.connections.find(item => item.id === editor.connectionId);
      const item = state?.mappings.find(item => item.id === editor.id);
      editor = state ? editor.kind === 'chat' && item ? chatDraft(state, item) : botDraft(state) : botDraft();
    }
    failed = ''; feedback = ''; render();
  }
  function transition(proceed) {
    if (!mounted || busy || confirming) return;
    navigate(() => { if (mounted && !busy) { editor = null; editRevision++; failed = ''; feedback = ''; proceed(); render(); focus('editor-heading'); } });
  }
  function selectBot(id) {
    if (section === 'bots' && selectedConnectionId === id && editor?.kind === 'bot') return;
    transition(() => { selectedConnectionId = id; if (section === 'bots') editor = botDraft(connection()); });
  }
  function cancelEdit() { transition(() => { editor = botDraft(); }); }
  function focus(key) { [...panel.querySelectorAll('[data-focus]'), ...inventory.querySelectorAll('[data-focus]')].find(node => node.getAttribute('data-focus') === key)?.focus(); }
  function button(text, handler, attrs = {}) {
    const node = el('button', { type: 'button', className: 'secondary', text, ...attrs }); node.disabled = busy || confirming || Object.hasOwn(attrs, 'disabled');
    node.addEventListener('click', () => { if (mounted && !busy && !confirming) handler(); }); return node;
  }
  function field(title, control, help = '') { return el('label', { className: 'field' }, document.createTextNode(title), control, ...(help ? [el('small', { className: 'settings-help', text: help })] : [])); }
  function input(attrs, value, onInput) {
    const node = el('input', attrs); node.value = value; node.disabled = busy || confirming;
    node.addEventListener('input', () => onInput(node.value)); return node;
  }
  function agentSelect(selected, first, onChange, attrs = {}) {
    const options = [...first, ...agents.filter(item => item.enabled !== false).map(item => ({ id: item.id, name: item.name || item.id }))];
    if (selected && !options.some(item => item.id === selected)) options.push({ id: selected, name: `${agentName(selected)} (unavailable)`, disabled: true });
    const node = el('select', attrs, ...options.map(item => { const option = el('option', { value: item.id, text: item.name }); option.disabled = item.disabled === true; return option; }));
    node.value = selected; node.disabled = busy || confirming;
    node.addEventListener('change', () => { node.setCustomValidity(''); onChange(node.value); }); return node;
  }
  function feedbackNode() {
    return failed ? el('p', { className: 'settings-request-error', role: 'alert', text: failed }) : feedback ? el('p', { className: 'settings-help', role: 'status', text: feedback }) : null;
  }
  function applyState(result, preferred = selectedConnectionId) {
    aggregate = result;
    selectedConnectionId = result.connections.some(item => item.id === preferred) ? preferred : result.connections[0]?.id || 'default';
    if (editor && editor.kind !== 'new') {
      const state = result.connections.find(item => item.id === editor.connectionId);
      const item = state?.mappings.find(item => item.id === editor.id);
      editor.orphaned = !state || (editor.kind === 'chat' && !item);
      if (!editor.orphaned) {
        // Rebase only untouched fields on the latest accepted state. Keep the
        // draft object: unchanged polls must not disconnect existing handlers.
        const accepted = editor.kind === 'chat' ? chatDraft(state, item) : botDraft(state);
        const before = JSON.parse(editor.baseline);
        const keys = editor.kind === 'chat' ? ['agentId'] : ['name', 'transport', 'agentId', 'enabled', 'token'];
        keys.forEach((key, i) => { if (editor[key] === before[i]) editor[key] = accepted[key]; });
        editor.baseline = accepted.baseline;
        if (editor.kind === 'bot') editor.originalAgentId = accepted.originalAgentId;
      }
    }
    const pending = new Set(result.connections.flatMap(state => state.pending.map(item => `${state.id}:${item.id}`)));
    for (const key of pendingAgents.keys()) if (!pending.has(key)) pendingAgents.delete(key);
  }
  const interacting = () => dirty() || confirming || ['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(document.activeElement?.tagName);
  async function load({ quiet = false, initial = false } = {}) {
    if (loading || busy || confirming || !mounted) return;
    loading = true; const revision = stateRevision, editAtStart = editRevision, focusAtStart = document.activeElement;
    let deferredForInteraction = false;
    if (!quiet) { failed = ''; feedback = ''; if (!aggregate) render(); else updateRefresh(); }
    const newInteraction = () => (editRevision !== editAtStart || document.activeElement !== focusAtStart) && ['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(document.activeElement?.tagName);
    let changed = false;
    try {
      const result = normalize(await request(api, controller, '/configuration'));
      if (!mounted || revision !== stateRevision || (quiet && interacting()) || (deferredForInteraction = newInteraction())) return;
      changed = JSON.stringify(result) !== JSON.stringify(aggregate) || Boolean(failed);
      failed = ''; applyState(result);
      if (section === 'bots' && !editor) editor = botDraft();
      if (!quiet && !initial) feedback = 'Up to date.';
    } catch (error) {
      if (!mounted || controller.signal.aborted || revision !== stateRevision || (quiet && interacting())) return;
      failed = `Could not refresh bots. ${message(error, 'Try again.')}`;
      deferredForInteraction = newInteraction();
      // Surface the failure without detaching the control currently being used.
      if (deferredForInteraction) panel.append(feedbackNode()); else changed = true;
    } finally { loading = false; if (mounted && !deferredForInteraction && (changed || (!quiet && editRevision === editAtStart))) render(); else if (mounted) updateRefresh(); }
  }
  function updateRefresh() {
    for (const node of [...panel.querySelectorAll('[data-focus]'), ...inventory.querySelectorAll('[data-focus]')]) if (node.getAttribute('data-focus') === 'refresh') { node.textContent = loading ? 'Refreshing…' : 'Refresh'; node.disabled = loading || busy || confirming; }
  }
  async function mutate(path, init, success, { after, onFailure, focusKey = 'editor-heading' } = {}) {
    if (busy || !mounted || editor?.orphaned) return false;
    stateRevision++; busy = true; failed = ''; feedback = ''; render();
    try {
      const result = normalize(await request(api, controller, path, init));
      if (!mounted) return false;
      applyState(result); after?.(result); feedback = success; return true;
    } catch (error) {
      if (mounted && !controller.signal.aborted) {
        failed = message(error, 'The change could not be saved. Your edits are still here.');
        onFailure?.(failed);
      }
      return false;
    } finally { busy = false; if (mounted) { render(); focus(focusKey); } }
  }
  const json = (method, body) => ({ method, body: JSON.stringify(body) });
  async function saveEditor() {
    if (!mounted || busy || confirming || editor?.orphaned || !editor) return false;
    if (!dirty()) return true;
    if (editor.kind !== 'chat' && !currentForm?.reportValidity()) { failed = 'Complete the required fields before saving.'; currentForm.append(feedbackNode()); return false; }
    const draft = editor;
    const state = aggregate.connections.find(item => item.id === draft.connectionId);
    if (draft.kind === 'chat') {
      const item = state?.mappings.find(item => item.id === draft.id);
      // Validate the chat draft itself: a change starts saving without relying on
      // a form that an asynchronous rerender may already have replaced.
      if (!item || (draft.agentId === DEFAULT_AGENT ? !enabledAgent(state.agentId) : !enabledAgent(draft.agentId))) { draft.saveError = failed = 'Choose an enabled goblin.'; render(); return false; }
      draft.saveError = ''; draft.saving = true;
      try {
        return await mutate(`${pathFor(state)}/mappings/${encodeURIComponent(item.id)}`, json('PUT', { agentId: draft.agentId === DEFAULT_AGENT ? null : draft.agentId, enabled: item.enabled !== false }), `${label(item)} saved.`, {
          after: () => { const current = aggregate.connections.find(c => c.id === draft.connectionId); const saved = current?.mappings.find(m => m.id === draft.id); editor = saved ? chatDraft(current, saved) : botDraft(current); },
          onFailure: error => { draft.saveError = failed = `Could not save chat. ${error}`; },
          focusKey: 'chat-responder',
        });
      } finally { draft.saving = false; }
    }
    const isNew = draft.kind === 'new';
    if (!draft.name.trim()) { failed = 'Enter a bot name.'; render(); return false; }
    const previousIds = aggregate.connections.map(item => item.id);
    const body = { name: draft.name.trim(), enabled: draft.enabled, ...(isNew || draft.agentId !== draft.originalAgentId ? { agentId: draft.agentId || null } : {}), ...(draft.token.trim() ? { token: draft.token.trim() } : {}), ...(isNew ? { transport: draft.transport } : {}) };
    return mutate(isNew ? '/connections' : pathFor(state), json(isNew ? 'POST' : 'PUT', body), isNew ? 'Bot connected. Allow its chats below.' : 'Bot saved.', { after: result => {
      if (isNew) selectedConnectionId = result.connections.find(item => !previousIds.includes(item.id))?.id || selectedConnectionId;
      editor = botDraft(connection());
    } });
  }
  async function confirmed(options, action) {
    if (!mounted || busy || confirming) return;
    const revision = stateRevision;
    confirming = true; publish();
    let accepted = false;
    try { accepted = await confirm(options); }
    finally { confirming = false; if (mounted) publish(); }
    if (accepted && mounted && !busy && revision === stateRevision) action();
  }
  function destructive(options, action, connectionId, mappingId) {
    // Resolve labels and identities AFTER a guard Save/Discard, not from the
    // pre-save closure. A removed item cannot be rebound to another bot.
    navigate(() => {
      if (!mounted) return;
      const state = aggregate.connections.find(c => c.id === connectionId);
      const item = mappingId ? state?.mappings.find(m => m.id === mappingId) : null;
      if (!state || (mappingId && !item)) { failed = 'This item was removed. Refresh to continue.'; render(); return; }
      void confirmed(options(state, item), () => action(state, item));
    });
  }
  function status(state) {
    if (!state.tokenConfigured) return { text: 'Needs token', tone: 'warn' };
    if (!state.enabled) return { text: 'Paused', tone: '' };
    if (!state.core.available) return { text: 'Burrow unavailable', tone: 'warn' };
    if (state.transport.error || ['degraded', 'error', 'failed'].includes(state.transport.health)) return { text: 'Connection problem', tone: 'warn' };
    return state.transport.health === 'healthy' ? { text: 'Connected', tone: 'ok' } : { text: 'Connecting', tone: 'warn' };
  }
  function responder(state) {
    if (state.agentId) return enabledAgent(state.agentId) ? `${agentName(state.agentId)} answers` : `${agentName(state.agentId)} is unavailable`;
    const ids = [...new Set(state.mappings.filter(item => item.enabled !== false && item.agentId).map(item => item.agentId))];
    return ids.length ? `${ids.map(responderName).join(', ')} · set per chat` : 'Choose who answers';
  }
  function stateNode(state) { const value = status(state); return el('span', { className: `settings-status ${value.tone}`, text: value.text }); }
  function renderBotForm(state) {
    const draft = editor, isNew = draft.kind === 'new';
    const provider = el('select', { 'aria-label': 'Messaging app' }, el('option', { value: 'telegram', text: 'Telegram' }), el('option', { value: 'discord', text: 'Discord' }));
    provider.value = draft.transport; provider.disabled = busy;
    provider.addEventListener('change', () => { update(draft, 'transport', provider.value); render(); focus('editor-heading'); });
    const name = input({ id: 'switchboard-name', required: 'required', maxlength: '80', placeholder: 'e.g. Hatchet on Telegram' }, draft.name, value => update(draft, 'name', value));
    const assigned = agentSelect(draft.agentId, [{ id: '', name: 'Choose when approving a chat' }], value => update(draft, 'agentId', value), { 'aria-label': 'Who answers new chats' });
    const token = input({ id: 'switchboard-token', type: 'password', autocomplete: 'new-password', maxlength: '4096', ...(isNew || (!state.tokenConfigured && draft.enabled) ? { required: 'required' } : {}), placeholder: isNew ? `Paste ${transportName(draft.transport)} bot token` : 'Leave blank to keep the saved token' }, draft.token, value => update(draft, 'token', value));
    const enabled = el('input', { type: 'checkbox', 'aria-label': 'Receive messages' }); enabled.checked = draft.enabled; enabled.disabled = busy;
    enabled.addEventListener('change', () => { update(draft, 'enabled', enabled.checked); token.required = isNew || (!state.tokenConfigured && enabled.checked); });
    const tokenHelp = el('p', { className: 'settings-help' });
    if (isNew || !state.tokenConfigured) {
      if (draft.transport === 'telegram') tokenHelp.append(document.createTextNode('Create a Telegram bot with '), el('a', { href: 'https://t.me/BotFather', target: '_blank', rel: 'noopener noreferrer', text: 'BotFather' }), document.createTextNode(', then paste its token here.'));
      else tokenHelp.append(document.createTextNode('Get the token in the '), el('a', { href: 'https://discord.com/developers/applications', target: '_blank', rel: 'noopener noreferrer', text: 'Discord Developer Portal' }), document.createTextNode('. Enable Message Content Intent and invite the bot with permission to view channels, send messages, read message history and send messages in threads.'));
    } else tokenHelp.textContent = 'Leave blank to keep the saved token. Use Add bot for a different bot.';
    const credentials = isNew || !state.tokenConfigured ? el('div', {}, field('Bot token', token), tokenHelp) : el('details', { className: 'settings-disclosure' }, el('summary', { text: 'Replace bot token' }), field('Replace token (optional)', token), tokenHelp);
    if (draft.token) credentials.open = true;
    saveControl = el('button', { type: 'submit', className: 'primary', text: busy ? 'Saving…' : isNew ? 'Connect bot' : 'Save bot' });
    dirtyControl = el('p', { className: 'settings-status', role: 'status' });
    currentForm = el('form', { className: 'settings-form', 'aria-label': isNew ? 'Add bot' : 'Edit bot' },
      ...(isNew ? [field('Messaging app', provider)] : [el('p', { className: 'settings-description', text: `${transportName(state.transportType)}${state.bot.username ? ` · @${String(state.bot.username).replace(/^@/, '')}` : ''} · ${status(state).text}` })]),
      el('div', { className: 'field-pair settings-field-pair' }, field('Bot name', name), field('Who answers new chats', assigned)),
      el('label', { className: 'settings-checkbox-row' }, enabled, document.createTextNode('Receive messages')),
      credentials, dirtyControl, ...(feedbackNode() ? [feedbackNode()] : []),
      el('div', { className: 'model-actions' }, button('Cancel', cancelEdit), saveControl));
    currentForm.addEventListener('submit', event => { event.preventDefault(); if (editor === draft) void saveEditor(); });
    return currentForm;
  }
  function roomType(item, state) {
    if (item.topicId != null) return `${state.transportType === 'discord' ? 'Thread' : 'Topic'} · ${item.topicId}`;
    if (item.chatType === 'direct') return 'Direct message';
    if (state.transportType === 'discord') return item.chatType === 'thread' ? 'Thread' : 'Channel';
    return ['group', 'supergroup'].includes(item.chatType) ? 'Group · all topics included' : item.chatType === 'channel' ? 'Channel' : 'Chat';
  }
  function chatRow(item, state) {
    const key = `chat-${state.id}-${item.id}`;
    const server = state.servers.find(saved => saved.guildId === item.guildId);
    const blocked = state.transportType === 'discord' && item.inherited === true && (!server || server.enabled === false);
    const row = el('article', { className: 'settings-group', 'aria-label': label(item) },
      el('div', { className: 'settings-row' }, el('strong', { text: label(item) }), el('span', { className: 'settings-status', text: item.enabled === false ? 'Paused' : blocked ? 'Server access paused' : 'Allowed' })),
      el('p', { className: 'settings-help', text: `${roomType(item, state)} · ${item.agentId ? `${enabledAgent(item.agentId) ? `${agentName(item.agentId)} answers` : `${agentName(item.agentId)} is unavailable`}${inherited(item) ? ' · uses bot default' : ''}` : 'No goblin assigned'}` }));
    if (state.transportType === 'discord' && item.inherited === true) row.append(el('p', { className: 'settings-help', text: `Access follows ${server?.name || 'the server'}; changing who answers does not bypass server access.` }));
    row.append(el('div', { className: 'memory-connection-actions' },
      button(item.enabled === false ? 'Resume' : 'Pause', () => void mutate(`${pathFor(state)}/mappings/${encodeURIComponent(item.id)}`, json('PUT', { enabled: item.enabled === false }), `${label(item)} ${item.enabled === false ? 'resumed' : 'paused'}.`, { focusKey: key }), { 'aria-label': `${item.enabled === false ? 'Resume' : 'Pause'} ${label(item)}`, 'data-focus': key }),
      button('Change', () => transition(() => { const current = aggregate.connections.find(c => c.id === state.id); const saved = current?.mappings.find(m => m.id === item.id); if (saved) editor = chatDraft(current, saved); else { editor = botDraft(current); failed = 'This chat was removed. Refresh to continue.'; } }), { 'aria-label': `Change ${label(item)}` })));
    return row;
  }
  function renderChatForm(state, item) {
    const draft = editor;
    const select = agentSelect(draft.agentId, state.agentId ? [{ id: DEFAULT_AGENT, name: `${agentName(state.agentId)} · bot default`, disabled: !enabledAgent(state.agentId) }] : [], value => {
      if (!mounted || busy || confirming || editor !== draft || draft.agentId === value) return;
      draft.saveError = ''; failed = ''; feedback = '';
      update(draft, 'agentId', value);
      if (dirty()) void saveEditor(); else render();
    }, { 'aria-label': `Who answers in ${label(item)}`, 'data-focus': 'chat-responder', required: 'required' });
    dirtyControl = el('p', { className: 'settings-status', role: 'status' });
    const notice = draft.saveError ? el('p', { className: 'settings-request-error', role: 'alert', text: draft.saveError }) : feedbackNode();
    const refreshError = draft.saveError && failed && failed !== draft.saveError ? feedbackNode() : null;
    const retry = draft.saveError && dirty() ? button('Retry saving', () => { if (editor === draft) void saveEditor(); }) : null;
    currentForm = el('form', { className: 'settings-form', 'aria-label': `Edit ${label(item)}` }, field('Who answers', select), dirtyControl, ...(notice ? [notice] : []), ...(refreshError ? [refreshError] : []), el('div', { className: 'model-actions' }, button('Cancel', () => transition(() => { editor = botDraft(connection()); })), ...(retry ? [retry] : [])));
    currentForm.addEventListener('submit', event => event.preventDefault());
    return [el('h2', { tabindex: '-1', 'data-focus': 'editor-heading', text: label(item) }), el('p', { className: 'settings-description', text: `${state.name} · ${roomType(item, state)}` }), currentForm,
      el('details', { className: 'settings-disclosure' }, el('summary', { text: 'Chat details and removal' }), el('p', { className: 'settings-help', text: `Chat ID: ${item.chatId || item.channelId || 'unknown'}${topic(item)}` }), el('div', { className: 'settings-danger-actions' }, button('Remove chat access', () => destructive((state, item) => ({ title: 'Remove chat access?', message: `Remove “${label(item)}” from “${state.name}”? This does not delete the chat or affect other bots. If a parent group or server is allowed, its access still applies. Pause this chat instead to block messages here.`, confirmLabel: 'Remove chat access', tone: 'danger' }), (state, item) => void mutate(`${pathFor(state)}/mappings/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, 'Chat access removed.', { after: () => { editor = botDraft(connection()); } }), state.id, item.id), { className: 'danger' })))];
  }
  function pendingRow(item, state) {
    const key = `${state.id}:${item.id}`;
    const selected = pendingAgents.get(key) ?? (enabledAgent(state.agentId) ? DEFAULT_AGENT : '');
    const first = [{ id: '', name: 'Choose a goblin' }, ...(state.agentId ? [{ id: DEFAULT_AGENT, name: `${agentName(state.agentId)} · bot default`, disabled: !enabledAgent(state.agentId) }] : [])];
    const select = agentSelect(selected, first, value => pendingAgents.set(key, value), { 'aria-label': `Who answers in ${label(item)}` });
    return el('article', { className: 'settings-group', 'aria-label': `Request from ${label(item)}` }, el('strong', { text: label(item) }), el('p', { className: 'settings-help', text: roomType(item, state) }), field('Who answers', select),
      el('div', { className: 'memory-connection-actions' }, button('Dismiss', () => void confirmed({ title: 'Dismiss request?', message: `Dismiss the request from “${label(item)}”? A later message can request access again.`, confirmLabel: 'Dismiss' }, () => void mutate(`${pathFor(state)}/pending/${encodeURIComponent(item.id)}/deny`, { method: 'POST' }, `${label(item)} dismissed.`))),
        button('Allow chat', () => {
          if (!select.value || (select.value === DEFAULT_AGENT ? !enabledAgent(state.agentId) : !enabledAgent(select.value))) { select.setCustomValidity('Choose an enabled goblin.'); select.reportValidity(); return; }
          pendingAgents.set(key, select.value);
          void mutate(`${pathFor(state)}/pending/${encodeURIComponent(item.id)}/approve`, json('POST', select.value === DEFAULT_AGENT ? {} : { agentId: select.value }), `${label(item)} allowed.`);
        })));
  }
  function serverRow(server, approved, state) {
    const name = server.name || server.guildId;
    const toggle = button(!approved ? 'Allow server' : server.enabled === false ? 'Resume' : 'Pause', () => void mutate(`${pathFor(state)}/servers/${encodeURIComponent(server.guildId)}`, json('PUT', { enabled: !approved || server.enabled === false }), `${name} ${!approved ? 'allowed' : server.enabled === false ? 'resumed' : 'paused'}.`), { 'aria-label': `${!approved ? 'Allow' : server.enabled === false ? 'Resume' : 'Pause'} ${name}` });
    toggle.disabled = busy || ((!approved || server.enabled === false) && !enabledAgent(state.agentId));
    const row = el('article', { className: 'settings-group', 'aria-label': name }, el('div', { className: 'settings-row' }, el('strong', { text: name }), el('span', { className: 'settings-status', text: !approved ? 'Waiting for approval' : server.enabled === false ? 'Paused' : 'Allowed' })), el('p', { className: 'settings-help', text: state.agentId ? `${agentName(state.agentId)} answers · bot default` : 'Choose who answers new chats and Save bot before allowing this server.' }));
    const actions = el('div', { className: 'memory-connection-actions' }, toggle);
    if (approved) actions.append(button('Revoke', () => void confirmed({ title: 'Revoke server access?', message: `Revoke “${name}”? This removes inherited access to its channels and threads. Explicit chat exceptions still apply.`, confirmLabel: 'Revoke', tone: 'danger' }, () => void mutate(`${pathFor(state)}/servers/${encodeURIComponent(server.guildId)}`, { method: 'DELETE' }, `${name} access revoked.`)), { 'aria-label': `Revoke ${name}`, className: 'danger' }));
    row.append(actions); return row;
  }
  function accessSections(state) {
    const parts = [];
    if (!state.agentId && state.mappings.some(item => item.agentId)) parts.push(el('p', { className: 'settings-help', text: 'Existing chats keep their own assignments. Choose who answers when allowing a new chat.' }));
    if (state.pending.length) parts.push(el('section', { className: 'settings-group', 'aria-label': 'Waiting for approval' }, el('h3', { text: 'Waiting for approval' }), ...state.pending.map(item => pendingRow(item, state))));
    if (state.transportType === 'discord') {
      const servers = [...state.servers, ...state.pendingServers.filter(item => !state.servers.some(saved => saved.guildId === item.guildId))];
      parts.push(el('section', { className: 'settings-group', 'aria-label': 'Allowed servers' }, el('h3', { text: 'Servers' }), ...servers.map(item => serverRow(item, state.servers.some(saved => saved.guildId === item.guildId), state)), ...(!servers.length ? [el('p', { className: 'settings-empty', text: 'Invite the bot to a Discord server, then allow it here.' })] : [])));
    }
    const main = state.transportType === 'telegram' ? state.mappings.filter(item => item.topicId == null) : state.mappings.filter(item => item.chatType === 'direct');
    parts.push(el('section', { className: 'settings-group', 'aria-label': 'Allowed chats' }, el('h3', { text: state.transportType === 'discord' ? 'Direct messages' : 'Chats' }), ...main.map(item => chatRow(item, state)), ...(!main.length ? [el('p', { className: 'settings-empty', text: 'Send this bot a message. The request will appear here for approval.' })] : [])));
    const exceptions = state.mappings.filter(item => !main.includes(item));
    if (exceptions.length) parts.push(el('details', { className: 'settings-disclosure' }, el('summary', { text: `${state.transportType === 'discord' ? 'Channel and thread' : 'Topic'} exceptions (${exceptions.length})` }), el('p', { className: 'settings-help', text: 'Chat-specific settings take priority over group or server access.' }), ...exceptions.map(item => chatRow(item, state))));
    return parts;
  }
  function renderEditor() {
    if (!editor) editor = botDraft();
    if (editor.orphaned) { panel.replaceChildren(el('h2', { text: 'This item was removed', tabindex: '-1', 'data-focus': 'editor-heading' }), el('p', { className: 'settings-request-error', role: 'alert', text: 'Your unsaved edits cannot be applied because the original bot or chat no longer exists.' }), button('Discard edits', discardDraft)); return; }
    const state = aggregate.connections.find(item => item.id === editor.connectionId);
    if (editor.kind === 'chat') { panel.replaceChildren(...renderChatForm(state, state.mappings.find(item => item.id === editor.id))); return; }
    panel.replaceChildren(el('h2', { tabindex: '-1', 'data-focus': 'editor-heading', text: editor.kind === 'new' ? 'Add bot' : state.name }), renderBotForm(state));
    if (state) {
      if (state.agentId && !enabledAgent(state.agentId)) panel.append(el('p', { className: 'settings-request-error', role: 'alert', text: `${agentName(state.agentId)} is unavailable. Custom chat assignments are unchanged.` }));
      panel.append(el('p', { className: 'settings-help', text: `Status: ${status(state).text} · ${transportName(state.transportType)} · ${state.transport.health || 'unknown'}` }));
      if (state.transport.error) panel.append(el('p', { className: 'settings-request-error', role: 'alert', text: message(new Error(state.transport.error), 'Connection problem.') }));
      panel.append(...accessSections(state), el('details', { className: 'settings-disclosure' }, el('summary', { text: 'Remove bot or clear token' }), el('div', { className: 'settings-danger-actions' },
        button('Clear saved token', () => destructive(state => ({ title: 'Clear saved token?', message: `Clear the token for “${state.name}”? This stops new messages, but keeps its chats and assignments.`, confirmLabel: 'Clear token', tone: 'danger' }), state => void mutate(`${pathFor(state)}/token/clear`, { method: 'POST' }, 'Token cleared. Chats and assignments kept.', { after: () => { editor = botDraft(connection()); } }), state.id), { className: 'danger', ...(!state.tokenConfigured ? { disabled: 'disabled' } : {}) }),
        button('Remove bot', () => destructive(state => ({ title: 'Remove bot?', message: `Remove “${state.name}” and its Switchboard token, access and routing settings? This does not delete Telegram/Discord chats or Burrow conversations. Other bots are not affected.`, confirmLabel: 'Remove bot', tone: 'danger' }), state => void mutate(pathFor(state), { method: 'DELETE' }, `${state.name} removed.`, { after: () => { editor = botDraft(); } }), state.id), { className: 'danger' }))));
    }
  }
  function renderInventory() {
    const list = el('div', { className: 'memory-connection-list' });
    for (const state of aggregate.connections) {
      const waiting = state.pending.length + state.pendingServers.filter(item => !state.servers.some(saved => saved.guildId === item.guildId)).length;
      const select = button('', () => selectBot(state.id), { className: 'memory-connection-select', 'aria-pressed': String(editor?.kind !== 'new' && state.id === selectedConnectionId), 'aria-label': `Manage ${state.name}`, 'data-focus': `bot-${state.id}` });
      select.append(el('strong', { text: state.name }), el('small', { text: `${transportName(state.transportType)} · ${status(state).text} · ${responder(state)}${waiting ? ` · ${waiting} waiting for approval` : ''}` }));
      list.append(el('article', { className: 'memory-connection' }, select));
    }
    const refresh = button(loading ? 'Refreshing…' : 'Refresh', () => void load(), { 'data-focus': 'refresh' }); refresh.disabled = loading || busy || confirming;
    inventory.replaceChildren(...(!aggregate.connections.length ? [el('p', { className: 'settings-empty', text: 'No bots connected yet.' })] : [list]), el('div', { className: 'settings-row settings-group' }, refresh, ...(section === 'bots' ? [button('Add bot', () => transition(() => { editor = botDraft(); }))] : [])));
  }
  function render() {
    if (!mounted) return;
    saveControl = dirtyControl = currentForm = null;
    if (!aggregate) { panel.replaceChildren(el('h2', { text: 'Bots' }), ...(failed ? [feedbackNode(), button('Retry', () => void load())] : [el('p', { className: 'settings-empty', role: 'status', text: 'Loading bots…' })])); publish(); return; }
    const focused = document.activeElement?.getAttribute?.('data-focus');
    renderEditor();
    renderInventory();
    if (!overflow) panel.append(el('details', { className: 'memory-saved saved-accordion' }, el('summary', { text: 'Saved bots' }), inventory));
    publish(); if (focused) focus(focused);
  }
  const timer = setInterval(() => { if (mounted && !busy && !loading && !document.hidden && !interacting()) void load({ quiet: true }); }, 10_000);
  timer.unref?.();
  void load({ initial: true });
  return () => { mounted = false; controller.abort(); clearInterval(timer); setDraft(null); editor = null; pendingAgents.clear(); panel.remove(); inventory.remove(); };
}
