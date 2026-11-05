// Historical work only. Settings owns configuration and current connection state.
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const title = item => String(item.chatTitle || item.chatId || item.channelId || 'Recorded work');
const botName = item => String(item.connectionName || item.connectionId || 'Unknown bot');
const transport = item => item.transportType === 'discord' ? 'Discord' : 'Telegram';
const timestamp = item => item.at || item.createdAt;
const categories = { work: 'All work', inbound: 'Received work', outbound: 'Reply outcomes' };
const PAGE_SIZE = 50;

export function mountArchive({ root, api, configureHeader, filters = {}, date = '', timeZone = 'UTC' }) {
  const controller = new AbortController();
  let mounted = true, loading = false, hasSnapshot = false, selected = '', snapshot = { records: [], coverage: {} }, error = '';
  let category = Object.hasOwn(categories, filters.category) ? filters.category : 'work';
  let search = filters.search || '', botId = filters.participantId || '', selectedDate = date, zone = timeZone;
  let pageSize = PAGE_SIZE, detailKey = '', headerKey = '', readerId = '', deferred = null, deferredError = false;
  const shell = el('div', 'archive-split-view');
  const results = el('section', 'archive-results-pane'); results.setAttribute('aria-label', 'Switchboard historical work');
  const reader = el('section', 'archive-reader-pane'); reader.setAttribute('aria-label', 'Switchboard work details');
  shell.append(results, reader); root.replaceChildren(shell);
  let indexed = [], metadata = new WeakMap(), headerDirty = true;
  let dateFormatter, dayFormatter;
  function indexSnapshot() {
    // Formatting and search normalization happen once per snapshot/timezone,
    // never once per keystroke. Formatter construction is particularly costly.
    try { dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone || 'UTC' }); }
    catch { dateFormatter = null; }
    try { dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { dayFormatter = null; }
    const dates = new Map(); metadata = new WeakMap();
    indexed = snapshot.records.map(entry => {
      const stamp = timestamp(entry);
      if (!dates.has(stamp)) {
        const parsed = new Date(stamp), valid = Boolean(stamp) && !Number.isNaN(parsed.getTime());
        const formatted = valid ? dateFormatter ? dateFormatter.format(parsed) : parsed.toISOString() : 'Time not recorded';
        let day = '';
        if (valid && dayFormatter) {
          const parts = dayFormatter.formatToParts(parsed), part = type => parts.find(p => p.type === type)?.value;
          day = `${part('year')}-${part('month')}-${part('day')}`;
        }
        dates.set(stamp, { formatted, day });
      }
      const { formatted, day } = dates.get(stamp);
      const description = `${entry.direction === 'outbound' ? 'Reply' : 'Received work'} · ${entry.status || 'Unknown outcome'} · ${entry.agentName || entry.agentId || 'Goblin not recorded'} · ${formatted}`;
      const fields = [title(entry), botName(entry), entry.connectionId, transport(entry), description, entry.id, entry.recordId, entry.chatId, entry.channelId, entry.guildId, entry.topicId, entry.sessionId, entry.turnId, entry.agentId, entry.error];
      const item = { entry, formatted, day, description, search: fields.filter(value => value != null).join(' ').toLocaleLowerCase() };
      metadata.set(entry, item); return item;
    });
  }
  const formatDate = entry => metadata.get(entry)?.formatted || 'Time not recorded';
  const describe = entry => metadata.get(entry)?.description || '';
  function rows() {
    const query = search.trim().toLocaleLowerCase();
    return indexed.filter(({ entry, day, search: text }) =>
      (category === 'work' || entry.direction === category) && (!botId || entry.connectionId === botId) &&
      (!selectedDate || day === selectedDate) && (!query || text.includes(query))).map(item => item.entry);
  }
  function publishHeader() {
    if (!headerDirty || typeof configureHeader !== 'function') return;
    headerDirty = false;
    const bots = [...new Map(snapshot.records.map(entry => [entry.connectionId, entry])).values()];
    const duplicates = new Map();
    for (const bot of bots) duplicates.set(botName(bot), (duplicates.get(botName(bot)) || 0) + 1);
    const header = {
      categories: Object.entries(categories).map(([id, label]) => ({ id, label })),
      participants: bots.map(bot => ({ id: bot.connectionId, label: `${botName(bot)}${duplicates.get(botName(bot)) > 1 ? ` (${bot.connectionId})` : ''} · ${transport(bot)}` })),
      participantLabel: 'Historical bot', participantsDisabled: !hasSnapshot,
      participantsStatus: hasSnapshot ? '' : error ? 'History unavailable. Retrying automatically.' : 'Loading history…',
      searchPlaceholder: 'Search historical work and outcomes', searchMaxLength: 500,
    };
    const key = JSON.stringify(header); if (key !== headerKey) { headerKey = key; configureHeader(header); }
  }
  function detail(entry) {
    const key = JSON.stringify([zone, entry, snapshot.coverage.limit, snapshot.coverage.byteLimit, entry ? '' : error]); if (key === detailKey) return;
    const previousBody = Array.from(reader.children).find(node => node.className === 'archive-content-body');
    const scroll = readerId === entry?.id ? previousBody?.scrollTop || 0 : 0;
    readerId = entry?.id || ''; detailKey = key; reader.replaceChildren();
    if (!entry) { reader.append(el('section', 'archive-empty-state archive-reader-placeholder', !hasSnapshot && error ? 'History unavailable. Retrying automatically.' : 'Select recorded work to read its outcome.')); return; }
    const toolbar = el('header', 'archive-reader-toolbar');
    toolbar.append(el('span', 'eyebrow', `${transport(entry)} · ${entry.status || 'Unknown outcome'}`), el('h2', '', title(entry)), el('p', '', `${botName(entry)} · ${formatDate(entry)} · ${zone || 'UTC'}`));
    const body = el('div', 'archive-content-body'); const article = el('article', 'archive-reader');
    article.append(el('p', 'archive-reader-summary', describe(entry)));
    // Historical metadata, not the current bot, route, agent configuration or health.
    for (const [label, value] of [['Record ID', entry.recordId || entry.id], ['Bot ID', entry.connectionId], ['Chat ID', entry.chatId], ['Channel', entry.channelId], ['Server', entry.guildId], ['Goblin ID', entry.agentId], ['Session', entry.sessionId], ['Turn', entry.turnId], ['Topic', entry.topicId], ['Outcome detail', entry.error]]) {
      if (value == null || value === '') continue;
      const p = el('p'); p.append(el('strong', '', `${label}: `), el('span', '', String(value))); article.append(p);
    }
    if (entry.error === 'connection_stopped_for_removal') article.append(el('p', 'archive-snapshot-note', 'The bridge stopped for bot removal. This does not establish whether the Core work stopped or an uncertain send reached its destination.'));
    article.append(el('p', 'archive-snapshot-note', `Counts are matching retained records, not unique conversations or lifetime totals. Retention: up to ${snapshot.coverage.limit || 'the configured limit'} records${snapshot.coverage.byteLimit ? ` / ${snapshot.coverage.byteLimit} bytes` : ''}. Earlier versions retained only a limited delivery window; older work cannot be reconstructed.`));
    article.append(el('p', 'archive-snapshot-note', 'Recorded delivery metadata. Message bodies and completed work artifacts are not stored in this archive.'));
    body.append(article); reader.append(toolbar, body); body.scrollTop = scroll;
  }
  function render() {
    const focusId = document.activeElement?.getAttribute?.('data-record-id');
    const resultsScroll = results.scrollTop;
    const oldList = Array.from(results.children).find(node => node.className === 'archive-session-list'); const listScroll = oldList?.scrollTop || 0;
    results.replaceChildren(); const matching = rows(), visible = matching.slice(0, pageSize);
    if (!visible.some(row => row.id === selected)) selected = visible[0]?.id || '';
    const heading = el('div', 'archive-pane-heading'); const count = el('strong', '', hasSnapshot ? `${matching.length} records` : 'History unknown');
    count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); heading.append(el('span', 'eyebrow', categories[category]), count); results.append(heading);
    if (hasSnapshot) {
      const counts = new Map(); for (const entry of matching) counts.set(entry.status || 'Unknown outcome', (counts.get(entry.status || 'Unknown outcome') || 0) + 1);
      results.append(el('p', 'archive-snapshot-note', `Matching retained: ${[...counts].map(([status, n]) => `${n} ${status}`).join(' · ') || 'none'}.`));
      const coverage = snapshot.coverage;
      results.append(el('p', 'archive-snapshot-note', `${coverage.truncated ? 'Older archive records removed by retention.' : 'Retained window; older history may be missing.'} · ${zone || 'UTC'}`));
    }
    if (snapshot.warning) { const gap = el('p', 'archive-error', 'Some history could not be saved. This archive may have gaps; counts include only retained records.'); gap.setAttribute('role', 'alert'); results.append(gap); }
    if (error) { const warning = el('p', 'archive-error', `${hasSnapshot ? 'Showing stale history. ' : 'History unavailable. '}Automatic retry pending: ${error}`); warning.setAttribute('role', 'alert'); results.append(warning); }
    const list = el('div', 'archive-session-list'); results.append(list);
    if (!matching.length) list.append(el('section', 'archive-empty-state', !hasSnapshot && error ? 'History unavailable. Retrying automatically.' : !hasSnapshot ? 'Loading history…' : !snapshot.records.length ? 'No historical work recorded yet.' : 'No matching records. Try another search, bot, or date.'));
    for (const entry of visible) {
      const button = el('button', `archive-session-card${selected === entry.id ? ' selected' : ''}`); button.type = 'button';
      button.setAttribute('aria-label', `Read ${title(entry)} · ${botName(entry)} · ${entry.id}`); button.setAttribute('aria-pressed', String(selected === entry.id)); button.setAttribute('data-record-id', entry.id);
      const main = el('div', 'archive-session-main'); main.append(el('div', 'archive-session-meta', `${botName(entry)} · ${transport(entry)}`), el('h3', '', title(entry)), el('p', '', describe(entry)));
      button.append(main, el('div', 'archive-session-side', formatDate(entry)));
      button.addEventListener('click', () => { if (selected !== entry.id) { selected = entry.id; render(); } }); list.append(button);
    }
    if (matching.length > visible.length) {
      const more = el('button', 'archive-load-more', `Load more (${visible.length} of ${matching.length})`); more.type = 'button'; more.setAttribute('aria-label', 'Load more historical records');
      more.addEventListener('click', () => { const index = visible.length; pageSize += PAGE_SIZE; render(); const updated = Array.from(results.children).find(node => node.className === 'archive-session-list'); Array.from(updated?.children || [])[index]?.focus(); }); results.append(more);
    }
    detail(visible.find(row => row.id === selected)); results.scrollTop = resultsScroll; list.scrollTop = listScroll;
    if (focusId != null) Array.from(list.children).find(node => node.getAttribute?.('data-record-id') === focusId)?.focus();
    publishHeader();
  }
  const interacting = () => {
    const active = document.activeElement, selection = document.getSelection?.();
    return (active && root.contains?.(active) && (['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(active.tagName) || active.isContentEditable)) || (selection && !selection.isCollapsed && root.contains?.(selection.anchorNode));
  };
  function apply(next) {
    const changed = !hasSnapshot || JSON.stringify(next) !== JSON.stringify(snapshot), hadError = Boolean(error);
    hasSnapshot = true; error = '';
    if (changed) { snapshot = next; indexSnapshot(); headerDirty = true; }
    if (hadError) headerDirty = true;
    if (changed || hadError) render();
  }
  async function load() {
    if (!mounted || loading) return; loading = true;
    try {
      const value = await api('/archive', { signal: controller.signal }); if (!mounted) return;
      if (!Array.isArray(value?.records) || !value.coverage || typeof value.coverage !== 'object') throw Error('Historical archive response unavailable');
      const next = { records: value.records, coverage: value.coverage, warning: value.warning || '' }; loading = false;
      if (interacting()) { deferred = next; return; }
      deferred = null; deferredError = false; apply(next);
    } catch (cause) {
      if (!mounted) return; loading = false; error = cause instanceof Error ? cause.message : 'Unknown error'; headerDirty = true;
      if (interacting()) { deferred = null; deferredError = true; return; } render();
    }
  }
  function applyDeferred() {
    if (!mounted || interacting()) return;
    if (deferredError) { deferredError = false; render(); }
    if (deferred) { const next = deferred; deferred = null; apply(next); }
  }
  const onFocusOut = () => queueMicrotask(applyDeferred);
  root.addEventListener('focusout', onFocusOut); root.addEventListener('mouseup', applyDeferred); root.addEventListener('keyup', applyDeferred);
  render(); void load();
  const timer = setInterval(() => { if (!mounted || document.hidden) return; applyDeferred(); if (!loading && !deferred && !interacting()) void load(); }, 10_000); timer.unref?.();
  return {
    update(context) {
      if (!mounted) return; const previousZone = zone; const previous = JSON.stringify([category, search, botId, selectedDate, zone]);
      if (context.filters) { category = Object.hasOwn(categories, context.filters.category) ? context.filters.category : 'work'; search = context.filters.search || ''; botId = context.filters.participantId || ''; }
      selectedDate = context.date || ''; zone = context.timeZone || 'UTC';
      if (zone !== previousZone) indexSnapshot();
      if (JSON.stringify([category, search, botId, selectedDate, zone]) !== previous) { pageSize = PAGE_SIZE; render(); }
    },
    unmount() { mounted = false; root.removeEventListener('focusout', onFocusOut); root.removeEventListener('mouseup', applyDeferred); root.removeEventListener('keyup', applyDeferred); controller.abort(); clearInterval(timer); shell.remove(); },
  };
}
