export const settingsSections = Object.freeze([{ id: 'bots', label: 'Bots' }, { id: 'diagnostics', label: 'Diagnostics' }]);

let selectedConnectionId = 'default';

const styles = `
.switchboard-settings{display:grid;gap:14px;min-width:0}.switchboard-settings h2,.switchboard-settings h3{margin:0}.switchboard-settings summary{cursor:pointer;padding:10px 0;font-weight:650}.switchboard-settings details[open]>summary{margin-bottom:10px}.switchboard-item-head>div{min-width:0;overflow-wrap:anywhere}.switchboard-settings button{flex-shrink:0}.switchboard-settings *{box-sizing:border-box}.switchboard-settings :is(input,select,button){font:inherit}.switchboard-settings :is(input:not([type=checkbox]),select){width:100%;min-height:34px;padding:0 9px;border:1px solid var(--line);border-radius:6px;background:var(--surface-input);color:var(--text)}.switchboard-settings :is(input,select,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}.switchboard-fields{display:grid;gap:12px}.switchboard-field{display:grid;gap:5px;color:var(--text-strong);font-weight:650}.switchboard-field small{color:var(--muted);font-weight:400}.switchboard-toggle{display:flex;align-items:flex-start;gap:9px;padding:11px 12px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text)}.switchboard-toggle input{flex:0 0 auto;margin-top:3px;accent-color:var(--accent)}.switchboard-toggle span{display:grid;gap:2px}.switchboard-toggle strong{color:var(--text-strong)}.switchboard-toggle small{color:var(--muted)}.switchboard-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line-soft)}.switchboard-actions>div{display:flex;gap:8px}.switchboard-settings button{min-height:32px;padding:0 11px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text-strong);cursor:pointer}.switchboard-settings button:hover:not(:disabled){background:var(--surface-hover)}.switchboard-settings button.primary{border-color:var(--accent);background:var(--accent-subtle);color:var(--accent-strong)}.switchboard-settings button.danger{border-color:color-mix(in srgb,var(--danger) 45%,var(--line));color:var(--danger)}.switchboard-settings button:disabled{cursor:not-allowed;opacity:.52}.switchboard-feedback{margin:0;color:var(--muted);font-size:12px}.switchboard-feedback.error{color:var(--danger)}.switchboard-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.switchboard-summary div{padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--panel)}.switchboard-summary strong,.switchboard-summary small{display:block;overflow:hidden;text-overflow:ellipsis}.switchboard-summary strong{color:var(--text-strong)}.switchboard-summary small{margin-top:2px;color:var(--muted);font-size:10px}.switchboard-list{display:grid;gap:8px}.switchboard-item{display:grid;gap:10px;padding:11px 12px;border:1px solid var(--line);border-radius:7px;background:var(--panel)}.switchboard-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.switchboard-item-head strong,.switchboard-item-head small{display:block}.switchboard-item-head strong{color:var(--text-strong)}.switchboard-item-head small{margin-top:2px;color:var(--muted);font-size:11px}.switchboard-item-meta{color:var(--muted);font-size:11px;text-align:right}.switchboard-item-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}.switchboard-mapping-controls{grid-template-columns:minmax(0,1fr) auto auto auto}.switchboard-empty{margin:0;padding:20px;color:var(--muted);text-align:center}.switchboard-settings-note{margin:0;color:var(--muted);font-size:11px}.switchboard-destructive{padding:12px;border:1px solid color-mix(in srgb,var(--danger) 30%,var(--line));border-radius:7px;background:color-mix(in srgb,var(--danger) 5%,var(--panel))}.switchboard-diagnostic-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.switchboard-diagnostic{min-width:0;border:1px solid var(--line);border-radius:7px;background:var(--panel);overflow:hidden}.switchboard-diagnostic header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border-bottom:1px solid var(--line-soft)}.switchboard-diagnostic h3{margin:0;color:var(--text-strong);font-size:12px}.switchboard-count{min-width:22px;padding:2px 6px;border-radius:999px;background:var(--accent-subtle);color:var(--accent-strong);font-size:10px;font-weight:800;text-align:center}.switchboard-delivery{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:9px 11px;border-bottom:1px solid var(--line-soft)}.switchboard-delivery:last-child{border-bottom:0}.switchboard-delivery strong,.switchboard-delivery small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.switchboard-delivery small{margin-top:2px;color:var(--muted);font-size:10px}.switchboard-state{color:var(--muted);font-size:11px;white-space:nowrap}.switchboard-warning{margin:0;padding:10px 11px;border:1px solid color-mix(in srgb,var(--warning,#eab308) 40%,var(--line));border-radius:7px;background:color-mix(in srgb,var(--warning,#eab308) 7%,var(--panel));color:var(--text)}.switchboard-destructive strong{display:block;color:var(--text-strong)}.switchboard-destructive p{margin:3px 0 10px;color:var(--muted);font-size:11px}.switchboard-connection-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:7px;background:var(--panel)}.switchboard-connection-bar .switchboard-field{margin:0}.switchboard-create{padding:12px;border:1px solid var(--accent);border-radius:7px;background:var(--accent-subtle)}.switchboard-create h3{margin:0;color:var(--text-strong);font-size:13px}.switchboard-create-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:650px){.switchboard-summary{grid-template-columns:1fr}.switchboard-item-controls,.switchboard-mapping-controls,.switchboard-connection-bar{grid-template-columns:1fr}.switchboard-item-controls button,.switchboard-connection-bar button{width:100%}.switchboard-actions{align-items:stretch;flex-direction:column}.switchboard-actions>div,.switchboard-create-actions{display:grid}.switchboard-actions button,.switchboard-create-actions button{width:100%}.switchboard-item-head{flex-direction:column}.switchboard-item-meta{text-align:left}.switchboard-diagnostic-grid{grid-template-columns:1fr}.switchboard-delivery{grid-template-columns:1fr}.switchboard-state{white-space:normal}}
`;

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
function message(error, fallback) { return error instanceof Error && error.message ? error.message.replaceAll('_', ' ') : fallback; }
function label(item) { return String(item?.chatTitle || item?.title || item?.chatId || 'Unnamed chat'); }
function topic(item) { return item?.topicId !== null && item?.topicId !== undefined ? ` · topic ${item.topicId}` : ''; }
function date(value) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString(); }
function transportType(value) { return value === 'discord' ? 'discord' : 'telegram'; }
function transportName(value) { return transportType(value) === 'discord' ? 'Discord' : 'Telegram'; }
function normalizeConnection(value = {}, core = {}) {
  const transport = value.transport || {};
  return { agentId: value.agentId ?? null, servers: value.servers || [], pendingServers: value.pendingServers || [], id: String(value.id || 'default'), name: String(value.name || (value.id === 'default' || !value.id ? 'Default bot' : value.id)), transportType: transportType(value.transportType), enabled: value.enabled === true || transport.enabled === true, tokenConfigured: value.tokenConfigured === true || value.bot?.configured === true, bot: value.bot || value.botIdentity || {}, transport, core: { available: core.available === true, reason: core.reason }, mappings: Array.isArray(value.mappings) ? value.mappings : [], pending: Array.isArray(value.pending) ? value.pending : Array.isArray(value.pendingAdmissions) ? value.pendingAdmissions : [], deliveries: Array.isArray(value.deliveries) ? value.deliveries : Array.isArray(value.recentDeliveries) ? value.recentDeliveries : [] };
}
function normalize(value = {}) {
  const core = value.coreAgentTurns || value.core || {};
  const source = Array.isArray(value.connections) && value.connections.length ? value.connections : [{ ...value, id: 'default', name: value.name || 'Default bot' }];
  return { core, connections: source.map(item => normalizeConnection(item, core)) };
}
function agentOptions(agents, selected = '') {
  return [{ id: '', name: 'Select an agent' }, ...agents.filter(agent => agent.enabled !== false).map(agent => ({ id: String(agent.id), name: String(agent.name || agent.id) }))].map(agent => { const option = el('option', { value: agent.id, text: agent.name }); option.selected = agent.id === selected; return option; });
}
function request(api, controller, path, init = {}) { return api(path, { ...init, signal: controller.signal, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }); }

export function mountSettings({ section, primary, agents = [], api }) {
  if (['status', 'configuration', 'pending-admissions', 'chat-mappings'].includes(section)) section = section === 'status' ? 'diagnostics' : 'bots';
  if (!settingsSections.some(item => item.id === section)) return;
  const controller = new AbortController(); let mounted = true; let loading = true; let busy = false; let failed = ''; let feedback = ''; let aggregate = null; let adding = false;
  const panel = el('section', { className: 'setting-section switchboard-settings', 'aria-labelledby': `switchboard-${section}-heading` });
  const style = el('style', { text: styles }); primary.replace([style, panel]);
  const connection = () => aggregate?.connections.find(item => item.id === selectedConnectionId) || aggregate?.connections[0] || null;
  const reconcileSelection = preferred => { const ids = aggregate?.connections.map(item => item.id) || []; selectedConnectionId = ids.includes(preferred) ? preferred : ids.includes(selectedConnectionId) ? selectedConnectionId : ids[0] || 'default'; };
  const setFeedback = (value, error = false) => { feedback = value; failed = error ? value : ''; render(); };
  async function load(success = '') {
    loading = true; failed = ''; feedback = ''; render();
    try { aggregate = normalize(await request(api, controller, '/configuration')); reconcileSelection(selectedConnectionId); feedback = success; }
    catch (error) { if (!mounted || controller.signal.aborted) return; failed = message(error, 'Could not load Switchboard configuration.'); }
    finally { if (mounted) { loading = false; busy = false; render(); } }
  }
  async function mutate(path, init, success, preferred = selectedConnectionId) {
    busy = true; failed = ''; feedback = ''; render();
    try { const response = await request(api, controller, path, init); if (!mounted) return; aggregate = normalize(response); reconcileSelection(preferred); adding = false; busy = false; feedback = success; render(); }
    catch (error) { if (!mounted || controller.signal.aborted) return; busy = false; setFeedback(message(error, 'The change could not be saved.'), true); }
  }
  function heading(title) { return [el('h2', { id: `switchboard-${section}-heading`, text: title })]; }
  function feedbackNode() { return failed ? el('p', { className: 'switchboard-feedback error', role: 'alert', text: failed }) : feedback ? el('p', { className: 'switchboard-feedback', role: 'status', 'aria-live': 'polite', text: feedback }) : null; }
  function connectionBar(allowAdd = false) {
    const select = el('select', { id: `switchboard-${section}-connection`, 'aria-label': 'Bot connection' }, ...aggregate.connections.map(item => { const suffix = item.bot?.username ? ` (@${String(item.bot.username).replace(/^@/, '')})` : ''; const option = el('option', { value: item.id, text: `${item.name} · ${transportName(item.transportType)}${suffix}` }); option.selected = item.id === selectedConnectionId; return option; }));
    select.value = selectedConnectionId; select.disabled = busy;
    select.addEventListener('change', () => { selectedConnectionId = select.value; failed = ''; feedback = ''; adding = false; render(); });
    const children = [el('label', { className: 'switchboard-field', htmlFor: select.id }, document.createTextNode('Bot connection'), select)];
    if (allowAdd) { const add = el('button', { type: 'button', text: 'Add bot connection' }); add.disabled = busy; add.addEventListener('click', () => { adding = true; failed = ''; feedback = ''; render(); }); children.push(add); }
    return el('div', { className: 'switchboard-connection-bar' }, ...children);
  }
  function renderStatus() {
    const state = connection(); if (!state) return renderNoConnections('Switchboard status');
    const provider = transportName(state.transportType);
    const botName = state.bot.username ? `@${String(state.bot.username).replace(/^@/, '')}` : state.tokenConfigured ? String(state.bot.displayName || 'Configured') : 'Not configured';
    const polling = String(state.transport.polling || (state.enabled ? 'unknown' : 'stopped'));
    const summary = el('div', { className: 'switchboard-summary' },
      el('div', {}, el('strong', { text: String(state.transport.health || (state.enabled ? 'unknown' : 'stopped')) }), el('small', { text: `${provider} transport` })),
      el('div', {}, el('strong', { text: polling }), el('small', { text: state.transport.lastPollAt ? `Last ${state.transportType === 'discord' ? 'gateway activity' : 'poll'} ${date(state.transport.lastPollAt)}` : state.transportType === 'discord' ? 'Gateway state' : 'Polling state' })),
      el('div', {}, el('strong', { text: botName }), el('small', { text: state.bot.id ? `Bot ID ${state.bot.id}` : `${provider} bot` })),
      el('div', {}, el('strong', { text: state.core.available ? 'Available' : 'Unavailable' }), el('small', { text: state.core.available ? 'Core agent turns' : String(state.core.reason || 'Core agent turns') }))
    );
    const list = (title, items, renderItem, empty) => { const body = el('div'); if (!items.length) body.append(el('p', { className: 'switchboard-empty', text: empty })); else items.forEach(item => body.append(renderItem(item))); return el('section', { className: 'switchboard-diagnostic' }, el('header', {}, el('h3', { text: title }), el('span', { className: 'switchboard-count', text: String(items.length), 'aria-label': `${items.length} items` })), body); };
    const diagnostics = el('div', { className: 'switchboard-diagnostic-grid' },
      list('Approved mappings', state.mappings, item => el('article', { className: 'switchboard-delivery' }, el('div', {}, el('strong', { text: label(item) }), el('small', { text: `${String(item.chatType || 'chat')}${topic(item)} · ${String(item.agentName || item.agentId || 'Unassigned')}` })), el('span', { className: 'switchboard-state', text: item.enabled === false ? 'Disabled' : 'Enabled' })), 'No approved mappings.'),
      list('Pending admissions', state.pending, item => el('article', { className: 'switchboard-delivery' }, el('div', {}, el('strong', { text: label(item) }), el('small', { text: `${String(item.chatType || 'chat')}${topic(item)}` })), el('span', { className: 'switchboard-state', text: date(item.requestedAt) })), 'No pending admissions.'));
    const deliveries = list('Recent deliveries', state.deliveries, item => el('article', { className: 'switchboard-delivery' }, el('div', {}, el('strong', { text: `${item.direction === 'outbound' ? 'To' : 'From'} ${label(item)}` }), el('small', { text: `${String(item.agentName || item.agentId || 'Unassigned')} · ${date(item.at || item.createdAt || item.updatedAt)}` })), el('span', { className: 'switchboard-state', text: String(item.status || 'unknown') })), 'No deliveries recorded yet.');
    const warnings = [];
    if (state.transport.error) warnings.push(el('p', { className: 'switchboard-warning', role: 'alert', text: `${provider} transport: ${state.transport.error}` }));
    if (!state.core.available) warnings.push(el('p', { className: 'switchboard-warning', text: `New messages cannot reach agents: ${String(state.core.reason || 'Core external agent turns are unavailable.')}` }));
    panel.replaceChildren(...heading('Switchboard status', 'Transport and routing diagnostics for the selected bot connection.'), connectionBar(), ...(feedbackNode() ? [feedbackNode()] : []), ...warnings, summary, diagnostics, deliveries);
  }
  function renderCreate() {
    const provider = el('select', { id: 'switchboard-new-transport', 'aria-label': 'Transport' }, el('option', { value: 'telegram', text: 'Telegram' }), el('option', { value: 'discord', text: 'Discord' })); provider.value = 'telegram';
    const name = el('input', { id: 'switchboard-new-name', required: 'required', maxlength: '80', placeholder: 'Hatchet bot' });
    const token = el('input', { id: 'switchboard-new-token', type: 'password', required: 'required', autocomplete: 'new-password', maxlength: '4096', placeholder: 'Paste Telegram bot token' });
    const assigned = el('select', { 'aria-label': 'Assigned goblin for new bot' }, ...agentOptions(agents));
    const enabled = el('input', { type: 'checkbox' }); enabled.checked = true;
    const tokenNote = el('small', { text: 'Write-only. A Telegram bot can belong to only one connection.' });
    const enabledTitle = el('strong', { text: 'Enable polling' });
    const enabledNote = el('small', { text: 'Start receiving updates after the connection is created.' });
    const discordSetup = el('p', { className: 'switchboard-warning', text: 'Before connecting Discord, enable the Message Content intent and invite the bot with View Channels, Send Messages, Read Message History, and Send Messages in Threads permissions.' }); discordSetup.hidden = true;
    const updateProvider = () => { const discord = provider.value === 'discord'; token.setAttribute('placeholder', `Paste ${discord ? 'Discord' : 'Telegram'} bot token`); tokenNote.textContent = discord ? 'Write-only. Use a dedicated bot for this goblin connection.' : 'Write-only. A Telegram bot can belong to only one connection.'; enabledTitle.textContent = discord ? 'Enable gateway' : 'Enable polling'; enabledNote.textContent = discord ? 'Connect to Discord after the connection is created.' : 'Start receiving updates after the connection is created.'; discordSetup.hidden = !discord; };
    provider.addEventListener('change', updateProvider);
    const cancel = el('button', { type: 'button', text: 'Cancel' }); const create = el('button', { type: 'submit', className: 'primary', text: busy ? 'Adding…' : 'Add connection' });
    for (const input of [provider, name, token, assigned, enabled, cancel, create]) input.disabled = busy;
    cancel.addEventListener('click', () => { adding = false; render(); });
    const form = el('form', { className: 'switchboard-create switchboard-fields' }, el('h3', { text: 'New bot connection' }), el('label', { className: 'switchboard-field', htmlFor: provider.id }, document.createTextNode('Transport'), provider), el('label', { className: 'switchboard-field', htmlFor: name.id }, document.createTextNode('Connection name'), name), el('label', { className: 'switchboard-field', htmlFor: token.id }, document.createTextNode('Bot token'), token, tokenNote), el('label', { className: 'switchboard-field' }, document.createTextNode('Assigned goblin'), assigned), discordSetup, el('label', { className: 'switchboard-toggle' }, enabled, el('span', {}, enabledTitle, enabledNote)), el('div', { className: 'switchboard-create-actions' }, cancel, create));
    form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; void mutate('/connections', { method: 'POST', body: JSON.stringify({ name: name.value.trim(), token: token.value.trim(), enabled: enabled.checked, transport: provider.value, agentId: assigned.value || null }) }, `${name.value.trim()} added.`); });
    return form;
  }
  function renderConfiguration() {
    const state = connection();
    const parts = [...heading('Bots'), connectionBar(true)];
    if (adding) parts.push(renderCreate());
    if (!state) { if (feedbackNode()) parts.push(feedbackNode()); parts.push(el('p', { className: 'switchboard-empty', text: 'Add a bot connection to begin.' })); panel.replaceChildren(...parts); return; }
    const provider = transportName(state.transportType);
    const assigned = el('select', { 'aria-label': 'Assigned goblin' }, ...agentOptions(agents, state.agentId || '')); assigned.value = state.agentId || ''; assigned.disabled = busy;
    const name = el('input', { id: 'switchboard-name', required: 'required', maxlength: '80' }); name.value = state.name; name.disabled = busy;
    const enabled = el('input', { id: 'switchboard-enabled', type: 'checkbox' }); enabled.checked = state.enabled; enabled.disabled = busy;
    const token = el('input', { id: 'switchboard-token', type: 'password', autocomplete: 'new-password', maxlength: '4096', placeholder: state.tokenConfigured ? 'Leave blank to keep the current token' : `Paste ${provider} bot token` }); token.disabled = busy;
    const save = el('button', { type: 'submit', className: 'primary', text: busy ? 'Saving…' : 'Save connection' }); save.disabled = busy;
    const setup = state.transportType === 'discord' && !state.tokenConfigured ? el('p', { className: 'switchboard-warning', text: 'Discord requires the Message Content intent and an invite with View Channels, Send Messages, Read Message History, and Send Messages in Threads permissions.' }) : null;
    const form = el('form', { className: 'switchboard-fields' }, el('label', { className: 'switchboard-field' }, document.createTextNode('Assigned goblin'), assigned), el('label', { className: 'switchboard-field' }, document.createTextNode('Transport'), el('input', { value: provider, disabled: 'disabled', 'aria-label': 'Connection transport' }), ), el('label', { className: 'switchboard-field', htmlFor: name.id }, document.createTextNode('Connection name'), name), el('label', { className: 'switchboard-toggle' }, enabled, el('span', {}, el('strong', { text: `Enable ${state.transportType === 'discord' ? 'Discord gateway' : 'Telegram polling'}` }), el('small', { text: `This connection receives ${provider} messages only while enabled.` }))), el('label', { className: 'switchboard-field', htmlFor: token.id }, document.createTextNode('Bot token'), token, el('small', { text: state.tokenConfigured ? 'A token is configured. Leave blank to preserve it. A different bot must be added as a new connection.' : 'Write-only. The saved token is never returned to this page.' })), ...(setup ? [setup] : []), el('div', { className: 'switchboard-summary' }, el('div', {}, el('strong', { text: state.bot.username ? `@${String(state.bot.username).replace(/^@/, '')}` : state.tokenConfigured ? 'Configured' : 'Not configured' }), el('small', { text: `${provider} bot` })), el('div', {}, el('strong', { text: String(state.transport.health || (state.enabled ? 'unknown' : 'stopped')) }), el('small', { text: 'Transport' })), el('div', {}, el('strong', { text: state.core.available ? 'Available' : 'Unavailable' }), el('small', { text: state.core.available ? 'Core agent turns' : String(state.core.reason || 'Core agent turns') }))), ...(feedbackNode() ? [feedbackNode()] : []), el('div', { className: 'switchboard-actions' }, el('p', { className: 'switchboard-settings-note', text: state.transportType === 'discord' ? 'DMs route every approved message. Each channel or thread shares context among its approved bots and route mentions of, or replies to, this bot.' : 'Groups include topics. Unmentioned messages reach participating goblins; mentions and replies target specific goblins.' }), el('div', {}, save)));
    form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; const body = { name: name.value.trim(), enabled: enabled.checked, agentId: assigned.value || null }; if (token.value.trim()) body.token = token.value.trim(); void mutate(`/connections/${encodeURIComponent(state.id)}`, { method: 'PUT', body: JSON.stringify(body) }, 'Connection saved.'); });
    const clear = el('button', { type: 'button', className: 'danger', text: busy ? 'Clearing…' : 'Clear configured token' }); clear.disabled = busy || !state.tokenConfigured;
    clear.addEventListener('click', () => { if (!confirm(`Clear the ${provider} bot token for “${state.name}”? ${state.transportType === 'discord' ? 'The gateway' : 'Polling'} will stop until a token is saved.`)) return; void mutate(`/connections/${encodeURIComponent(state.id)}/token/clear`, { method: 'POST' }, `${provider} bot token cleared.`); });
    const remove = el('button', { type: 'button', className: 'danger', text: busy ? 'Removing…' : 'Remove connection' }); remove.disabled = busy;
    remove.addEventListener('click', () => { if (!confirm(`Remove “${state.name}”? Its credential, admissions, mappings, and delivery state will be permanently deleted.`)) return; const fallback = aggregate.connections.find(item => item.id !== state.id)?.id || 'default'; void mutate(`/connections/${encodeURIComponent(state.id)}`, { method: 'DELETE' }, `${state.name} removed.`, fallback); });
    parts.push(form, el('div', { className: 'switchboard-destructive' }, el('strong', { text: 'Connection credential' }), el('p', { text: 'Clearing removes only this bot token. Blank token fields never clear it.' }), clear), el('div', { className: 'switchboard-destructive' }, el('strong', { text: 'Remove connection' }), el('p', { text: 'Permanently deletes this connection credential and its Switchboard state without affecting other bots.' }), remove));
    panel.replaceChildren(...parts);
  }
  function renderPending() {
    const state = connection(); if (!state) return renderNoConnections('Pending admissions');
    const list = el('div', { className: 'switchboard-list' });
    if (!state.pending.length) list.append(el('p', { className: 'switchboard-empty', text: 'No chats are waiting for approval for this bot.' }));
    for (const item of state.pending) {
      const select = el('select', { 'aria-label': `Agent for ${label(item)}` }, ...agentOptions(agents)); select.children[0].textContent = state.agentId ? 'Use assigned goblin' : 'Select an agent'; select.disabled = busy;
      const approve = el('button', { type: 'button', className: 'primary', text: 'Approve' }); const deny = el('button', { type: 'button', className: 'danger', text: 'Deny' }); approve.disabled = busy; deny.disabled = busy;
      approve.addEventListener('click', () => { if (!select.value && !state.agentId) { select.setCustomValidity?.('Choose an agent.'); select.reportValidity?.(); return; } select.setCustomValidity?.(''); void mutate(`/connections/${encodeURIComponent(state.id)}/pending/${encodeURIComponent(item.id)}/approve`, { method: 'POST', body: JSON.stringify(select.value ? { agentId: select.value } : {}) }, `${label(item)} approved.`); });
      deny.addEventListener('click', () => { if (!confirm(`Deny “${label(item)}”?`)) return; void mutate(`/connections/${encodeURIComponent(state.id)}/pending/${encodeURIComponent(item.id)}/deny`, { method: 'POST' }, `${label(item)} denied.`); });
      list.append(el('article', { className: 'switchboard-item' }, el('div', { className: 'switchboard-item-head' }, el('div', {}, el('strong', { text: label(item) }), el('small', { text: `${String(item.chatType || 'chat')}${topic(item)} · ${String(item.chatId || 'unknown ID')}` })), el('span', { className: 'switchboard-item-meta', text: `Requested ${date(item.requestedAt)}` })), el('div', { className: 'switchboard-item-controls' }, select, el('div', {}, approve, document.createTextNode(' '), deny))));
    }
    panel.replaceChildren(...heading('Pending admissions', `Approve a ${transportName(state.transportType)} chat for the selected bot and choose its Burrow agent.`), connectionBar(), ...(feedbackNode() ? [feedbackNode()] : []), list);
  }
  function renderMappings() {
    const state = connection(); if (!state) return renderNoConnections('Chat mappings');
    const list = el('div', { className: 'switchboard-list' });
    if (!state.mappings.length) list.append(el('p', { className: 'switchboard-empty', text: 'No approved chat mappings for this bot.' }));
    for (const item of state.mappings) {
      const select = el('select', { 'aria-label': `Agent for ${label(item)}` }, ...agentOptions(agents, String(item.agentId || ''))); select.value = String(item.agentId || ''); select.disabled = busy;
      const enabled = el('input', { type: 'checkbox', 'aria-label': `Enable ${label(item)}` }); enabled.checked = item.enabled !== false; enabled.disabled = busy;
      const save = el('button', { type: 'button', className: 'primary', text: 'Save' }); save.disabled = busy;
      save.addEventListener('click', () => { if (!select.value) { select.setCustomValidity?.('Choose an agent.'); select.reportValidity?.(); return; } select.setCustomValidity?.(''); void mutate(`/connections/${encodeURIComponent(state.id)}/mappings/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify({ agentId: select.value, enabled: enabled.checked }) }, `${label(item)} updated.`); });
      const remove = el('button', { type: 'button', className: 'danger', text: 'Delete' }); remove.disabled = busy;
      remove.addEventListener('click', () => { if (!confirm(`Delete the “${label(item)}” mapping from “${state.name}”? This removes only this bot connection’s Switchboard mapping. It does not delete the ${transportName(state.transportType)} chat or affect other bots. Inherited group or server access may still permit future messages.`)) return; void mutate(`/connections/${encodeURIComponent(state.id)}/mappings/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, `${label(item)} mapping deleted.`); });
      list.append(el('article', { className: 'switchboard-item' }, el('div', { className: 'switchboard-item-head' }, el('div', {}, el('strong', { text: label(item) }), el('small', { text: `${String(item.chatType || 'chat')}${topic(item)} · ${String(item.chatId || 'unknown ID')}` })), el('span', { className: 'switchboard-item-meta', text: `${item.enabled === false ? 'Disabled' : 'Enabled'}${item.inheritedAgent ? ' · Uses assigned goblin' : ''}` })), el('div', { className: 'switchboard-item-controls switchboard-mapping-controls' }, select, el('label', { className: 'switchboard-toggle' }, enabled, el('span', {}, el('strong', { text: 'Enabled' }), el('small', { text: 'Pause routing without deleting' }))), save, remove)));
    }
    const discord = state.transportType === 'discord';
    panel.replaceChildren(...heading('Chat mappings', `Route approved ${transportName(state.transportType)} chats for the selected bot to one enabled Burrow agent.`), connectionBar(), el('p', { className: 'switchboard-settings-note', text: discord ? 'DMs route every approved message. Each channel or thread shares context among its approved bots; mentions and replies trigger the bot.' : 'Direct chats route every message. Group approval includes topics; room overrides take precedence.' }), ...(feedbackNode() ? [feedbackNode()] : []), list);
  }
  function renderBots() {
    renderConfiguration();
    const configuration = [...panel.children];
    const state = connection();
    if (!state) return;
    renderPending();
    const pending = panel.children[panel.children.length - 1];
    renderMappings();
    const mappings = panel.children[panel.children.length - 1];
    const access = el('section', { className: 'switchboard-fields' }, el('h3', { text: state.transportType === 'discord' ? 'Server access' : 'Chat access' }));
    if (!state.agentId) access.append(el('p', { className: 'switchboard-warning', text: 'Assign a goblin before approving access.' }));
    if (state.transportType === 'discord') {
      for (const server of [...state.servers, ...state.pendingServers.filter(item => !state.servers.some(saved => saved.guildId === item.guildId))]) {
        const approved = state.servers.some(item => item.guildId === server.guildId);
        const toggle = el('button', { type: 'button', className: 'primary', text: !approved ? 'Approve server' : server.enabled === false ? 'Enable server' : 'Pause server' });
        toggle.disabled = busy || !state.agentId;
        const path = `/connections/${encodeURIComponent(state.id)}/servers/${encodeURIComponent(server.guildId)}`;
        toggle.addEventListener('click', () => void mutate(path, { method: 'PUT', body: JSON.stringify({ enabled: !approved || server.enabled === false }) }, 'Server access saved.'));
        const row = el('article', { className: 'switchboard-item switchboard-item-head' }, el('div', {}, el('strong', { text: server.name || server.guildId }), el('small', { text: !approved ? 'Awaiting approval' : server.enabled === false ? 'Paused' : 'Approved' })), toggle);
        if (approved) { const revoke = el('button', { type: 'button', className: 'danger', text: 'Revoke' }); revoke.disabled = busy; revoke.addEventListener('click', () => { if (confirm(`Revoke access to “${server.name || server.guildId}”?`)) void mutate(path, { method: 'DELETE' }, 'Server access revoked.'); }); row.append(revoke); }
        access.append(row);
      }
      if (!state.servers.length && !state.pendingServers.length) access.append(el('p', { className: 'switchboard-empty', text: 'Invite the bot to a server to approve it here.' }));
    }
    access.append(pending);
    const rooms = el('div', { className: 'switchboard-list' });
    if (state.transportType === 'telegram') {
      [...mappings.children].forEach((row, index) => { const item = state.mappings[index]; if (item && item.topicId == null) access.append(row); else rooms.append(row); });
    } else rooms.append(mappings);
    const overrides = el('details', { className: 'switchboard-fields' }, el('summary', { text: 'Room overrides' }), rooms);
    // Keep credentials and destructive actions secondary to day-to-day access.
    const destructive = el('details', {}, el('summary', { text: 'Remove or clear bot' }), ...configuration.filter(node => node.className === 'switchboard-destructive'));
    panel.replaceChildren(...configuration.filter(node => node.className !== 'switchboard-destructive'), access, overrides, destructive);
  }
  function renderNoConnections(title) { panel.replaceChildren(...heading(title, 'No bot connections are configured.'), el('p', { className: 'switchboard-empty', text: 'Open Bots to add a bot connection.' })); }
  function render() {
    if (!mounted) return;
    if (loading && !aggregate) { panel.replaceChildren(...heading('Switchboard', 'Loading bot connections and chat routing…'), el('p', { className: 'switchboard-empty', role: 'status', text: 'Loading…' })); return; }
    if (failed && !aggregate) { const retry = el('button', { type: 'button', text: 'Retry' }); retry.addEventListener('click', () => void load()); panel.replaceChildren(...heading('Switchboard', 'Configuration is unavailable.'), feedbackNode(), retry); return; }
    if (section === 'diagnostics') renderStatus(); else renderBots();
  }
  void load();
  return () => { mounted = false; controller.abort(); panel.remove(); style.remove(); };
}
