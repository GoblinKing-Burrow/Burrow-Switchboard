// Read-only, current bounded Switchboard snapshot; independent of Archive's global date filter.
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
const date = value => value ? (Number.isNaN(new Date(value).getTime()) ? String(value) : new Date(value).toLocaleString()) : '—';
const title = item => String(item?.chatTitle || item?.title || item?.chatId || 'Unnamed chat');
const identity = item => String(item?.id || 'default');
const name = item => String(item?.name || 'Default bot');
const transport = item => item.transportType === 'discord' ? 'Discord' : 'Telegram';
const status = item => !item.tokenConfigured && !item.bot?.configured ? 'Needs token' : item.enabled === false ? 'Paused' : item.transport?.error || ['degraded', 'error', 'failed'].includes(item.transport?.health) ? 'Connection problem' : item.transport?.health === 'healthy' ? 'Connected' : 'Connecting';
const entries = (item, key, legacy) => item[key] || item[legacy] || [];

export function mountArchive({ root, api }) {
  const controller = new AbortController();
  let mounted = true, loading = false, hasSnapshot = false, selected = '', records = [], error = '', deferred = null;
  const shell = el('div', 'archive-split-view');
  const results = el('section', 'archive-results-pane');
  results.setAttribute('aria-label', 'Switchboard bots');
  const reader = el('section', 'archive-reader-pane');
  reader.setAttribute('aria-label', 'Switchboard diagnostics');
  shell.append(results, reader); root.replaceChildren(shell);
  function detail(item) {
    reader.replaceChildren();
    if (!item) { reader.append(el('section', 'archive-empty-state archive-reader-placeholder', !hasSnapshot && error ? 'Diagnostics unavailable. Refresh to try again.' : 'Select a bot to inspect its diagnostics.')); return; }
    const body = el('div', 'archive-content-body archive-reader-body');
    const header = el('header', 'archive-content-toolbar');
    header.append(el('span', 'eyebrow', `${transport(item)} · ${status(item)}`), el('h2', '', name(item)));
    body.append(header);
    const facts = el('dl', 'archive-reader-summary');
    for (const [key, value] of [
      ['Connection', status(item)], ['Transport', `${transport(item)} · ${item.transport?.health || 'unknown'}`],
      ['Activity', `${item.transport?.polling || 'unknown'} · ${date(item.transport?.lastPollAt)}`],
      ['Bot', item.bot?.username || item.botIdentity?.username ? `@${item.bot?.username || item.botIdentity?.username}` : 'Not configured'],
      ['Burrow', (item.coreAgentTurns || item.core || {}).available ? 'Available' : (item.coreAgentTurns || item.core || {}).reason || 'Unavailable'],
    ]) facts.append(el('dt', '', key), el('dd', '', value));
    body.append(facts);
    if (item.transport?.error) { const warning = el('p', 'archive-error', item.transport.error); warning.setAttribute('role', 'alert'); body.append(warning); }
    const agent = entry => entry.agentName || entry.agentId || 'No goblin';
    for (const [heading, items, describe] of [
      ['Approved mappings', entries(item, 'mappings', 'chatMappings'), entry => `${entry.chatType || 'chat'}${entry.topicId != null ? ` · topic ${entry.topicId}` : ''} · ${agent(entry)}${entry.sessionId ? ` · session ${entry.sessionId}` : ''} · ${entry.enabled === false ? 'Paused' : 'Allowed'}`],
      ['Pending admissions', entries(item, 'pending', 'pendingAdmissions'), entry => `${entry.chatType || 'chat'} · ${date(entry.requestedAt)}`],
      ['Recent deliveries', entries(item, 'deliveries', 'recentDeliveries'), entry => `${agent(entry)}${entry.sessionId ? ` · session ${entry.sessionId}` : ''}${entry.topicId != null ? ` · topic ${entry.topicId}` : ''} · ${date(entry.at || entry.createdAt)} · ${entry.status || 'unknown'}${entry.error ? ` · ${entry.error}` : ''}`],
    ]) {
      const group = el('section', 'archive-reader-summary');
      group.append(el('h3', '', heading));
      if (!items.length) group.append(el('p', '', 'None recorded.'));
      for (const entry of items) {
        const row = el('article', 'archive-turn');
        row.append(el('strong', '', `${heading === 'Recent deliveries' ? entry.direction === 'outbound' ? 'To ' : 'From ' : ''}${title(entry)}`), el('p', '', describe(entry)));
        group.append(row);
      }
      body.append(group);
    }
    reader.append(body);
  }
  function render() {
    const focus = document.activeElement?.getAttribute?.('aria-label');
    const resultsScroll = results.scrollTop, readerScroll = reader.scrollTop;
    results.replaceChildren();
    const heading = el('div', 'archive-pane-heading');
    heading.append(el('span', 'eyebrow', 'Diagnostics'), el('strong', '', hasSnapshot ? `${records.length} bots` : 'Bots unknown')); results.append(heading);
    results.append(el('p', 'archive-snapshot-note', 'Current bounded snapshot · independent of Archive date filter.'));
    const refresh = el('button', 'archive-load-more', loading ? 'Refreshing…' : 'Refresh');
    refresh.type = 'button'; refresh.disabled = loading;
    refresh.setAttribute('aria-label', 'Refresh diagnostics');
    refresh.addEventListener('click', () => void load()); results.append(refresh);
    if (error) { const warning = el('p', 'archive-error', `Could not refresh diagnostics: ${error}`); warning.setAttribute('role', 'alert'); results.append(warning); }
    const list = el('div', 'archive-session-list'); results.append(list);
    if (!records.length) list.append(el('section', 'archive-empty-state', !hasSnapshot && error ? 'Diagnostics unavailable. Refresh to try again.' : loading ? 'Loading diagnostics…' : 'No bots connected yet. Open Settings → Switchboard → Bots to add one.'));
    for (const item of records) {
      const button = el('button', `archive-session-card${selected === identity(item) ? ' selected' : ''}`);
      button.type = 'button'; button.setAttribute('aria-label', `Inspect ${name(item)}`);
      const main = el('div', 'archive-session-main');
      main.append(el('h3', '', name(item)), el('p', '', `${transport(item)} · ${status(item)}`)); button.append(main);
      button.addEventListener('click', () => { if (selected !== identity(item)) { selected = identity(item); render(); } }); list.append(button);
    }
    detail(records.find(item => identity(item) === selected));
    results.scrollTop = resultsScroll; reader.scrollTop = readerScroll;
    if (focus) [refresh, ...list.children].find(node => node.getAttribute?.('aria-label') === focus)?.focus();
  }
  const interacting = () => {
    const active = document.activeElement;
    const selection = document.getSelection?.();
    return (active && root.contains?.(active) && (['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(active.tagName) || active.isContentEditable)) || (selection && !selection.isCollapsed && root.contains?.(selection.anchorNode));
  };
  async function load() {
    if (!mounted || loading) return;
    loading = true;
    if (records.length || error) { const refresh = Array.from(results.children).find(node => node.getAttribute?.('aria-label') === 'Refresh diagnostics'); if (refresh) { refresh.disabled = true; refresh.textContent = 'Refreshing…'; } }
    try {
      const value = await api('/configuration', { signal: controller.signal });
      if (!mounted) return;
      const next = Array.isArray(value.connections) ? value.connections.map(item => ({ ...item, coreAgentTurns: item.coreAgentTurns || value.coreAgentTurns })) : [value];
      if (interacting()) { deferred = next; loading = false; renderControls(); return; }
      deferred = null;
      const firstSnapshot = !hasSnapshot; hasSnapshot = true;
      const hadError = Boolean(error); error = ''; loading = false;
      if (firstSnapshot || JSON.stringify(next) !== JSON.stringify(records)) {
        records = next;
        if (!records.some(item => identity(item) === selected)) selected = records.length ? identity(records[0]) : '';
        render();
      } else if (hadError) render(); else renderControls();
    } catch (cause) {
      if (!mounted) return;
      loading = false; error = cause instanceof Error ? cause.message : 'Unknown error';
      if (interacting()) { deferred = null; renderControls(); return; }
      render();
    }
  }
  function renderControls() {
    const refresh = Array.from(results.children).find(node => node.getAttribute?.('aria-label') === 'Refresh diagnostics');
    if (refresh) { refresh.disabled = false; refresh.textContent = 'Refresh'; }
  }
  function applyDeferred() {
    if (!mounted || !deferred || interacting()) return;
    const next = deferred; deferred = null; error = '';
    const firstSnapshot = !hasSnapshot; hasSnapshot = true;
    if (firstSnapshot || JSON.stringify(next) !== JSON.stringify(records)) {
      records = next;
      if (!records.some(item => identity(item) === selected)) selected = records.length ? identity(records[0]) : '';
      render();
    } else renderControls();
  }
  const onFocusOut = () => queueMicrotask(applyDeferred);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('mouseup', applyDeferred);
  root.addEventListener('keyup', applyDeferred);
  render();
  void load();
  const timer = setInterval(() => { if (!mounted || document.hidden) return; applyDeferred(); if (!loading && !deferred && !interacting()) void load(); }, 10_000);
  timer.unref?.();
  return { unmount() { mounted = false; root.removeEventListener('focusout', onFocusOut); root.removeEventListener('mouseup', applyDeferred); root.removeEventListener('keyup', applyDeferred); controller.abort(); clearInterval(timer); shell.remove(); } };
}
