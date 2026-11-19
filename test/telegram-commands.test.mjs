import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTelegramConnection } from '../server/telegram.mjs';

const hatchet = { id: '1', username: 'HatchetBot' };
const smatchet = { id: '2', username: 'SmatchetBot' };
const dm = { id: 42, type: 'private' };
const group = { id: -100, type: 'supergroup' };
const route = (chat, topicId = null, agentId = 'hatchet') => ({
  id: createHash('sha256').update(`telegram:${chat.id}:${topicId ?? 'root'}`).digest('hex').slice(0, 24),
  chatId: String(chat.id), topicId, chatTitle: 'Test', chatType: chat.type === 'private' ? 'direct' : chat.type,
  agentId, enabled: true, inheritedAgent: true,
});
const msg = (id, text, chat = dm, extra = {}) => ({ update_id: id, message: { message_id: id, chat, from: { id: 42 }, text, ...extra } });
const cmd = (id, text, chat = dm, extra = {}) => msg(id, text, chat, {
  entities: [{ type: 'bot_command', offset: 0, length: text.split(/\s/u)[0].length }], ...extra,
});
const ok = result => new Response(JSON.stringify({ ok: true, result }));

function fixture(t, opts = {}) {
  const settings = new Map([['mappings', opts.mappings || [route(dm)]], ['configuration', { enabled: true, agentId: 'hatchet' }]]);
  const calls = [], creates = [], submissions = [], models = [], cancelled = [], turns = new Map(), selected = new Map(), workers = [];
  const context = {
    settings: { get: async (name, fallback) => structuredClone(settings.has(name) ? settings.get(name) : fallback), set: async (name, value) => settings.set(name, structuredClone(value)) },
    secrets: { get: async () => 'fixture-only', has: async () => true },
    agents: {
      list: async () => ['hatchet', 'smatchet'].map(id => ({ id, enabled: true })),
      turns: {
        submit: async input => {
          submissions.push(input);
          const turn = { id: `turn-${submissions.length}`, status: 'running', sessionId: input.sessionId };
          turns.set(turn.id, turn);
          return { turn };
        },
        read: async id => turns.get(id),
        cancel: async id => { cancelled.push(id); const turn = turns.get(id); return { cancellationRequested: turn?.status === 'running', turn }; },
      },
      sessions: {
        create: async input => { creates.push(input); return { agentId: input.agentId, sessionId: `mod:${input.idempotencyKey}` }; },
        model: async input => ({ selection: selected.get(input.sessionId) || null }),
        setModel: async input => { models.push(input); selected.set(input.sessionId, input); },
      },
    },
    models: { list: async () => [{ connectionId: 'pool', model: 'model:fast' }] },
    logger: { warn() {}, error() {} },
  };
  const fetchImpl = async (url, init) => {
    const method = url.split('/').at(-1), body = JSON.parse(init.body);
    calls.push({ method, body });
    const result = await opts.fetch?.({ method, body, signal: init.signal });
    if (result !== undefined) return result;
    if (method === 'getChatAdministrators') return ok([{ user: { id: 42 }, status: 'creator' }]);
    if (method === 'sendMessage') return ok({ message_id: 999 });
    if (method === 'getMe') return ok(hatchet);
    throw new Error(`unexpected Telegram call: ${method}`);
  };
  function open(options = {}) {
    const worker = createTelegramConnection({ context, fetchImpl, ...options });
    workers.push(worker);
    return worker;
  }
  t.after(() => Promise.all(workers.map(worker => worker.close())));
  const worker = open(opts.workerOptions);
  const send = (update, bot = hatchet) => worker.processMessage(update, bot);
  const replies = () => calls.filter(call => call.method === 'sendMessage').map(call => call.body);
  return { worker, open, send, replies, calls, creates, submissions, turns, cancelled, models, settings, context };
}

test('DM reset preserves old Core conversation, suppresses its late replies, survives restart and fences old quotes', async t => {
  const f = fixture(t);
  await f.send(msg(1, 'old history'));
  await f.send(cmd(2, '/new'));
  assert.equal(f.creates.length, 1);
  assert.equal(f.submissions.length, 1);
  assert.match(f.replies()[0].text, /fresh session.*preserved/);
  assert.equal(f.replies()[0].reply_parameters.message_id, 2);
  assert.equal(f.cancelled.length, 0, 'reset must not claim to cancel prior Core work');
  f.turns.get('turn-1').status = 'succeeded';
  f.turns.get('turn-1').result = { answerText: 'late reply' };
  await f.worker.close();
  const reloaded = f.open();
  await reloaded.processMessage(cmd(2, '/new'), hatchet);
  await reloaded.processMessage(msg(1, 'old history'), hatchet);
  await reloaded.processMessage(msg(3, 'fresh message', dm, { reply_to_message: msg(1, 'old history').message }), hatchet);
  await reloaded.reconcile({ sendMessage: async () => assert.fail('old reply leaked after reset') });
  assert.equal(f.creates.length, 1);
  assert.equal(f.replies().length, 1);
  assert.deepEqual(f.submissions.map(x => x.sessionId), ['telegram:42:root', 'mod:telegram-default-command-2']);
  assert.doesNotMatch(f.submissions[1].message, /old history/);
  assert.equal((await reloaded.publicState()).deliveries.find(item => item.turnId === 'turn-1').status, 'interrupted');
});

test('group native commands target one bot, require admin for mutations, and isolate inherited topic sessions', async t => {
  const first = fixture(t, { mappings: [route(group)] });
  const second = fixture(t, { mappings: [route(group, null, 'smatchet')], workerOptions: { connectionId: 'second' } });
  const post = async update => { await first.send(update); await second.send(update, smatchet); };
  await post(msg(1, 'root history', group));
  await post(msg(2, 'topic history', group, { message_thread_id: 7 }));
  await post(cmd(3, '/new', group, { message_thread_id: 7 }));
  await post(cmd(4, '/new@OtherBot', group, { message_thread_id: 7 }));
  await post(cmd(5, '/new@HatchetBot', group, { message_thread_id: 7, from: { id: 77 } }));
  await post(cmd(6, '/new@HATCHETBOT', group, { message_thread_id: 7, from: { id: 42, is_bot: true } }));
  await post(cmd(7, '/new@HatchetBot', group, { message_thread_id: 7, sender_chat: group }));
  assert.equal(first.creates.length, 0);
  assert.match(first.replies()[0].text, /group owner or administrator/);
  await post(cmd(8, '/new@HATCHETBOT', group, { message_thread_id: 7, reply_to_message: { from: smatchet } }));
  await post(msg(9, 'topic after', group, { message_thread_id: 7, reply_to_message: msg(2, 'topic history', group).message }));
  await post(msg(10, 'root after', group));
  await post(msg(11, 'sibling', group, { message_thread_id: 8 }));
  assert.equal(first.creates.length, 1);
  assert.equal(second.creates.length, 0);
  assert.equal(first.replies().at(-1).message_thread_id, 7);
  assert.deepEqual(first.submissions.map(x => x.sessionId), ['telegram:-100:root', 'telegram:-100:7', 'mod:telegram-default-command-8', 'telegram:-100:root', 'telegram:-100:8']);
  assert.match(second.submissions[2].message, /topic history/);
  assert.doesNotMatch(first.submissions[2].message, /topic history|\/new/);
  assert.equal(second.submissions[2].sessionId, 'telegram:second:-100:7');
  // A bare command can also be explicitly directed by replying to the bot.
  await post(cmd(12, '/status', group, { message_thread_id: 7, reply_to_message: { from: hatchet } }));
  assert.match(first.replies().at(-1).text, /mod:telegram-default-command-8/);
  assert.equal(second.replies().length, 0);
});

test('status, stop and model use the selected session, not Core prompt input', async t => {
  const f = fixture(t);
  await f.send(cmd(1, '/help'));
  await f.send(cmd(2, '/model'));
  await f.send(cmd(3, '/model pool:model:fast'));
  await f.send(msg(4, 'in old session'));
  await f.send(cmd(5, '/new'));
  await f.send(msg(6, 'in new session'));
  await f.send(cmd(7, '/status'));
  await f.send(cmd(8, '/model list'));
  await f.send(cmd(9, '/model nonexistent'));
  await f.send(cmd(10, '/model pool:model:fast'));
  await f.send(cmd(11, '/model'));
  await f.send(cmd(12, '/stop accidental arguments'));
  await f.send(cmd(13, '/stop'));
  assert.equal(f.replies().length, 11);
  const replies = f.replies().map(x => x.text).join('\n');
  assert.match(replies, /\/new — start fresh/);
  assert.match(replies, /Use \/new first to change the model/);
  assert.match(replies, /Pending deliveries: 1\nTurn states: running/);
  assert.match(replies, /Available models .*\npool:model:fast/);
  assert.match(replies, /That model is not available/);
  assert.match(replies, /Model: pool:model:fast/);
  assert.match(replies, /Usage: \/stop/);
  assert.match(replies, /Cancellation requested for 1 turn/);
  assert.deepEqual(f.cancelled, ['turn-2']);
  assert.deepEqual(f.models, [{ agentId: 'hatchet', sessionId: 'mod:telegram-default-command-5', connectionId: 'pool', model: 'model:fast' }]);
  assert.equal(f.submissions.length, 2);
});

test('unapproved or disabled routes cannot execute commands; /start and ordinary text keep prior routing', async t => {
  const f = fixture(t, { mappings: [] });
  await f.send(cmd(1, '/new@OtherBot'));
  assert.equal((await f.worker.publicState()).pending.length, 0);
  await f.send(cmd(2, '/start@HatchetBot'));
  assert.equal((await f.worker.publicState()).pending.length, 1);
  await f.worker.approve(route(dm).id, {});
  await f.worker.updateMapping(route(dm).id, { enabled: false });
  await f.send(cmd(3, '/new'));
  assert.equal(f.creates.length, 0);
  assert.equal(f.replies().length, 0);
  await f.worker.updateMapping(route(dm).id, { enabled: true });
  await f.send(msg(4, 'What does /new do?'));
  assert.equal(f.submissions[0].displayMessage, 'What does /new do?');
  delete f.context.agents.sessions.create;
  await f.send(cmd(5, '/new'));
  assert.match(f.replies()[0].text, /Core does not support \/new.*mod_capability_unavailable/);
  assert.equal(f.submissions.length, 1);
});

test('command response loss never repeats the reset or duplicates the reply', async t => {
  const f = fixture(t, { fetch: ({ method }) => { if (method === 'sendMessage') throw new Error('ambiguous fixture send'); } });
  await assert.rejects(f.send(cmd(1, '/new')), /telegram_request_failed/);
  await f.send(cmd(1, '/new'));
  assert.equal(f.creates.length, 1);
  assert.equal(f.replies().length, 1);
  await f.send(msg(2, 'new session still works'));
  assert.equal(f.submissions[0].sessionId, 'mod:telegram-default-command-1');
});

test('outbound Telegram poller registers native menu, preserves existing commands and reads ordinary updates', async t => {
  let enteredPoll;
  const polled = new Promise(resolve => { enteredPoll = resolve; });
  const manual = { command: 'start', description: 'Existing one' };
  const f = fixture(t, { fetch: ({ method, signal }) => {
    if (method === 'getMyCommands') return ok([manual]);
    if (method === 'setMyCommands') return ok(true);
    if (method === 'getUpdates') { enteredPoll(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
  } });
  f.worker.start();
  await polled;
  const commands = f.calls.find(call => call.method === 'setMyCommands').body.commands;
  assert.deepEqual(commands[0], manual);
  assert.deepEqual(commands.slice(1).map(x => x.command), ['help', 'status', 'stop', 'new', 'model']);
});

test('transient menu failure backs off without stopping typed commands and retries in the same generation', { timeout: 2500 }, async t => {
  let now = 1000, polls = 0, menuReads = 0, menuWrites = 0, reached;
  const done = new Promise(resolve => { reached = resolve; });
  const manual = { command: 'start', description: 'Existing one' };
  const pollState = [];
  const f = fixture(t, { workerOptions: { clock: () => now, retryDelayMs: 100 }, fetch: ({ method, body, signal }) => {
    if (method === 'getMyCommands') return (++menuReads === 1) ? new Response('', { status: 500 }) : ok([manual]);
    if (method === 'setMyCommands') { menuWrites++; assert.deepEqual(body.commands[0], manual); return ok(true); }
    if (method !== 'getUpdates') return;
    pollState.push(menuReads);
    switch (++polls) {
      case 1: return ok([cmd(1, '/help')]);
      case 2: now += 99; return ok([]);
      case 3: now += 1; return ok([]);
      case 4: return ok([]);
      default: reached(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  } });
  f.worker.start();
  await done;
  assert.deepEqual(pollState, [1, 1, 1, 2, 2]);
  assert.equal(menuWrites, 1);
  assert.equal(f.replies().length, 1, 'typed /help replied during menu backoff');
});
