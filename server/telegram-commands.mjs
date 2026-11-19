const MENU = [
  { command: 'help', description: 'Show Switchboard commands' },
  { command: 'status', description: 'Show this chat or topic session status' },
  { command: 'stop', description: 'Cancel pending turns in this session' },
  { command: 'new', description: 'Start a fresh session and keep the old history' },
  { command: 'model', description: 'Show, list or change the session model' },
];
const NAMES = new Set(MENU.map(item => item.command));
const STATUS = new Set(['queued', 'running', 'submitting', 'processing', 'succeeded', 'failed', 'interrupted']);
const TERMINAL = new Set(['succeeded', 'failed', 'interrupted']);
const UNAVAILABLE = new Set(['mod_capability_unavailable', 'mod_external_turns_unavailable']);
const KNOWN = new Set(['agent_not_found', 'agent_disabled', 'mod_busy', 'mod_capability_timeout', 'mod_capability_cancelled',
  'mod_external_turn_not_found', 'mod_session_not_found', 'model_connection_auth_required', 'telegram_auth_failed',
  'telegram_rate_limited', 'telegram_request_failed', 'telegram_request_timeout', 'telegram_response_invalid', 'telegram_command_response_invalid']);

export function telegramCommand(message) {
  // Only a leading Telegram text command, not a quoted command, caption, or
  // slash-looking text embedded in ordinary conversation.
  const text = message.text;
  if (typeof text !== 'string' || !Array.isArray(message.entities)) return null;
  const entity = message.entities.find(item => item?.type === 'bot_command' && item.offset === 0);
  if (!Number.isSafeInteger(entity?.length) || entity.length < 2 || entity.length > text.length) return null;
  const [, name, username] = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/i.exec(text.slice(0, entity.length)) || [];
  const rest = text.slice(entity.length);
  if (!NAMES.has(name?.toLowerCase()) || (rest && !/^\s/u.test(rest))) return null;
  return { name: name.toLowerCase(), username: username?.toLowerCase(), args: rest.trim() };
}

export function commandTargetsBot(command, message, bot) {
  if (command.username) return command.username === bot.username?.replace(/^@/, '').toLowerCase();
  if (message.chat.type === 'private') return true;
  // In shared chats an operational command must select exactly one bot.
  return bot.id != null && String(message.reply_to_message?.from?.id) === String(bot.id);
}

export async function registerTelegramCommands(api, signal) {
  const current = await api.getMyCommands({ signal });
  if (!Array.isArray(current)) throw new Error('telegram_response_invalid');
  const commands = [...current.filter(item => !MENU.some(command => command.command === item.command)), ...MENU];
  if (JSON.stringify(commands) !== JSON.stringify(current)) {
    if (await api.setMyCommands(commands, { signal }) !== true) throw new Error('telegram_response_invalid');
  }
}

async function modelChoices(context) {
  if (!context.models?.list) throw new Error('mod_capability_unavailable');
  const inventory = await context.models.list();
  if (!Array.isArray(inventory)) throw new Error('telegram_command_response_invalid');
  return inventory.filter(item => typeof item?.connectionId === 'string' && typeof item?.model === 'string')
    .map(item => ({ ...item, value: `${item.connectionId}:${item.model}` }));
}

export async function runTelegramCommand({ command, message, mapping, sessionId, context, api, signal, pending, interrupt, reset }) {
  const { name, args } = command;
  const usage = name === 'model' ? '/model, /model list, or /model <connectionId>:<model>' : `/${name}`;
  if (args && name !== 'model') return `Usage: ${usage}`;
  try {
    if (name === 'help') return [
      '/help — show these commands',
      '/status — show this bot’s session and pending turns',
      '/stop — cancel queued or running turns in this session',
      '/new — start fresh without deleting prior history',
      '/model — show the current selection; use /model list for choices or /model <connectionId>:<model> to change it',
      ...(mapping.chatType === 'direct' ? [] : [`In groups use /new${command.username ? `@${command.username}` : '@BotUsername'} or reply to this bot. Only group owners and administrators can reset, stop, or change models.`]),
    ].join('\n');
    if ((name === 'stop' || name === 'new' || (name === 'model' && args && args !== 'list')) && mapping.chatType !== 'direct') {
      const deadline = AbortSignal.timeout(10_000);
      const admins = await api.getChatAdministrators(message.chat.id, { signal: AbortSignal.any([signal, deadline]) }).catch(error => {
        if (deadline.aborted && !signal.aborted) throw new Error('telegram_request_timeout');
        throw error;
      });
      if (!Array.isArray(admins)) throw new Error('telegram_response_invalid');
      if (!admins.some(member => String(member.user?.id) === String(message.from.id) && ['creator', 'administrator'].includes(member.status))) {
        return 'Only a Telegram group owner or administrator can change this session.';
      }
    }
    signal.throwIfAborted();
    if (name === 'status') {
      const turns = await pending();
      const states = [];
      for (const item of turns) {
        signal.throwIfAborted();
        let status = item.status;
        if (item.turnId) {
          try { status = (await context.agents.turns.read(item.turnId))?.status; }
          catch { status = 'unavailable'; }
        }
        states.push(STATUS.has(status) ? status : 'unavailable');
      }
      return `Agent: ${mapping.agentId}\nSession: ${sessionId}\nPending deliveries: ${turns.length}\nTurn states: ${states.join(', ') || 'idle'}`;
    }
    if (name === 'new') {
      if (!context.agents.sessions?.create) throw new Error('mod_capability_unavailable');
      await reset();
      return 'Started a fresh session for this bot and chat or topic. The previous Burrow conversation is preserved.';
    }
    if (name === 'stop') {
      if (!context.agents.turns?.cancel) throw new Error('mod_capability_unavailable');
      let cancelled = 0, alreadyFinished = 0, unresolved = 0;
      const failures = new Set();
      for (const item of await pending()) {
        signal.throwIfAborted();
        // Never replay an ambiguous submission here: that could start a turn.
        if (!item.turnId) { unresolved++; continue; }
        try {
          const result = await context.agents.turns.cancel(item.turnId);
          const terminal = TERMINAL.has(result?.turn?.status);
          if (result?.cancellationRequested || terminal) {
            await interrupt(item);
            if (result.cancellationRequested) cancelled++;
            else alreadyFinished++;
          } else unresolved++;
        } catch (error) {
          signal.throwIfAborted();
          if (UNAVAILABLE.has(error?.message)) throw error;
          unresolved++;
          failures.add(KNOWN.has(error?.message) ? error.message : 'telegram_command_failed');
        }
      }
      return `Cancellation requested for ${cancelled} turn(s).${alreadyFinished ? ` ${alreadyFinished} already finished; unsent replies suppressed.` : ''}${unresolved ? ` ${unresolved} still unresolved${failures.size ? ` (${[...failures].join(', ')})` : ''}; retry /stop.` : ''}`;
    }
    if (name === 'model') {
      if (args === 'list') {
        const models = await modelChoices(context);
        return models.length ? `Available models (use /model <choice>):\n${models.map(item => item.value).join('\n')}` : 'No models are available.';
      }
      if (!mapping.sessionId) return args ? 'Use /new first to change the model. This session uses the agent default.' : 'Model: agent default. Use /new first to change it.';
      const input = { agentId: mapping.agentId, sessionId };
      if (!args) {
        if (!context.agents.sessions?.model) throw new Error('mod_capability_unavailable');
        const result = await context.agents.sessions.model(input);
        return result?.selection ? `Model: ${result.selection.connectionId}:${result.selection.model}` : 'Model: agent default';
      }
      if (!context.agents.sessions?.setModel) throw new Error('mod_capability_unavailable');
      const choice = (await modelChoices(context)).find(item => item.value === args);
      if (!choice) return 'That model is not available. Use /model list to see the available choices.';
      signal.throwIfAborted();
      await context.agents.sessions.setModel({ ...input, connectionId: choice.connectionId, model: choice.model });
      return `Model set to ${choice.value}.`;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (UNAVAILABLE.has(error?.message)) return `Core does not support /${name} (${error.message}).`;
    return `/${name} failed (${KNOWN.has(error?.message) ? error.message : 'telegram_command_failed'}).`;
  }
}
