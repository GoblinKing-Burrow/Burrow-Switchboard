# Admission and routing

## Admission and inherited access

Routing is scoped to a bot connection. Displayed room names are descriptive metadata, not identities or security boundaries.

- **Telegram DMs** retain per-chat admission. For a group or supergroup, a request received in the root or any forum topic creates one pending **root-group** admission for that connection. Approving it admits the root and every topic, while each topic still has its own Core session and bounded room history. Existing explicit topic mappings remain authoritative overrides.
- **Discord DMs** retain per-DM admission. Guild access is authorized separately from observed-guild metadata. After an operator approves a server, visible channels and threads need no individual admission; Switchboard creates inherited routes as traffic or a supported command is observed. Channel and thread sessions/history remain isolated, and Discord permissions still determine what the bot can see and send.
- Existing explicit Discord channel/thread mappings and legacy DM admissions remain supported. An explicit mapping, including a disabled one, takes precedence over inherited server access.

A nonempty text message from an unknown Telegram DM/group or Discord DM/channel/thread can create or refresh a pending route entry when no inherited access applies. No Core turn is submitted. Pending admissions are bounded to 100 entries and are not a permanent request archive. Discord guild observation is separate: an observed but unauthorized guild appears as a pending server, not as proof that every channel is reachable.

**Approve** requires an existing enabled agent. An empty approval body (`{}`) uses the connection's assigned goblin; Telegram records this as inheritance, while a Discord legacy room approval remains an explicit room grant. Supplying `agentId` makes an explicit room choice. If the connection has no assignment, `{}` cannot approve a route. The triggering message is not replayed, so send a new message after approval.

**Deny** removes the current request. It is **not a permanent ban**; later text from an unknown route can create another request.

## Approved routing rules

| Route | Text forwarded |
| --- | --- |
| Telegram direct chat | Every approved nonempty `message.text`; group recipient selection does not apply |
| Telegram approved group root or inherited forum topic | Human text with no known managed-bot target goes to every admitted managed bot that received it; known bot targets select only those bots |
| Discord DM | Every approved nonempty human text message |
| Discord authorized-server channel/thread or explicit guild mapping | Human text mentioning that bot or replying to its message |
| Disabled explicit mapping | Nothing; it does not fall through to inherited access or return to pending admissions |

### Telegram group recipient selection

For approved non-direct routes, Switchboard derives recipients from valid Telegram entities and reply metadata:

1. Explicit `mention`, `text_mention`, or addressed `bot_command` entities that identify connected Telegram bots select only those bot connections. Explicit targets take precedence over reply threading. Multiple connected bots can be selected.
2. With no recognized explicit bot target, a reply to a known connected bot selects that bot.
3. Mentions of humans, unknown bots, or malformed/nonmatching names do **not** select recipients. They remain ordinary group speech, so all admitted managed bots that receive the update can run.
4. With no known bot target, ordinary human group speech goes to all admitted managed bots that receive it.
5. Bot-authored messages never start agent turns (Telegram messages carrying `sender_chat` represent a speaking chat instead of the synthetic bot sender). On an approved room they are context only, preventing bot-to-bot wake loops.

A selected bot's first matching username `mention` (not `text_mention` or command) is removed from its submitted display text; the remainder must be nonempty. Telegram entities use UTF-16 offsets. A visually similar `@name` without a matching entity does not select a bot. Telegram's delivery/privacy rules are a prerequisite: Switchboard cannot route an update Telegram never delivered. See [Telegram setup](setup.md#privacy-mode-and-administrator-rights).

For Telegram, only `update.message` with nonempty text is processed. Media, attachment-only messages, captions without text, edited-message updates and channel-post updates are not supported. A targeted command is not a Switchboard configuration command, though after approval its addressed text can be routed like other bot-targeted text.

Discord handles `MESSAGE_CREATE` text via Gateway. Bot/webhook senders cannot create admissions or trigger turns; on approved guild routes their text may contribute context. Human guild text without a mention/reply is context only. Attachments and attachment-only messages do not become turns. Native Discord slash commands are documented separately in [Discord setup](discord.md#native-slash-commands).

Messages receive a short transport-specific sender/room prefix before Core submission. This is conversational context, not verified authorization for actions described in the text.

## Sessions, assignment and overrides

The migrated default connection keeps session ID `telegram:<chatId>:<topicId-or-root>`. New Telegram connections use `telegram:<connectionId>:<chatId>:<topicId-or-root>`. A Telegram root-group approval therefore authorizes every topic but does **not** merge them: root and each topic retain isolated sessions and room history.

Discord initially uses `discord:<connectionId>:<channelId>` for each DM, channel or thread. `/new` creates an owner-bound Core session, preserving old sessions but suppressing late replies and pre-reset context. `/model` changes that owned session. Changing agents clears Discord owned-session bindings; Telegram deterministic session IDs remain unchanged. Server authorization removes the channel-admission step, not channel isolation. A thread remains separate from its parent and sibling threads.

Each connection has a nullable **Assigned goblin**. New connections default to unassigned when `agentId` is omitted or `null`. Configuration updates that omit `agentId` preserve the current assignment; an explicit `null` clears it. Telegram approvals made with `{}` follow later assignment changes. Editing a room mapping with an explicit agent converts it to an override. Discord inherited server routes follow assignment changes, while legacy/explicit room mappings retain their selected agents. Assignment changes interrupt outstanding inherited work and do not silently rewrite explicit overrides.

In **Bots → Room overrides**, selecting an enabled agent and saving redirects subsequent messages for that explicit route. The route-derived session ID does not change merely because the agent changes; Core owns session/history behavior. Disabling an explicit override blocks that room even if its group/server would otherwise provide inherited access.

Deleting a Telegram root mapping removes inherited access while retaining explicit topic overrides. Deleting a Discord inherited route does not revoke its approved server; revoke or pause server access to stop inheritance instead of relying on generated-route deletion. Deletion interrupts outstanding replies for the affected inherited route(s), but does not recall provider messages or cancel Core work already submitted.

## Limits and duplicate handling

Per connection, there are at most 250 stored mappings, 100 pending admissions and 200 recent delivery records (inbound and outbound together). Discord stores at most 250 authorized servers and 250 observed guilds. Telegram delivery entries can evict older ones. Discord protects unresolved/unknown deliveries from eviction and reports `discord_backlog_full` if its 200-record ledger or 4,000,000-byte bound cannot admit work. These bounded settings collections are not an unlimited queue or audit ledger.

The default connection preserves Core idempotency key `telegram-update-<update_id>`; new connections use `telegram-<connectionId>-update-<update_id>`. Discord uses `discord-<connectionId>-message-<messageId>`. Gateway resume/heartbeat, Telegram offsets and durable delivery state reduce duplicates but do not provide unconditional exactly-once messaging. See [operations](operations.md#delivery-states-and-uncertain-outcomes).

## Shared group and channel conversation context

Enabled Telegram group routes in the **same chat and topic** share a bounded conversation record across managed bot connections. Root authorization does not merge topic records. Switchboard records delivered human text before recipient selection, records bot-authored messages as passive context, and adds successfully posted agent reply chunks with bot, connection and agent attribution.

**Visibility is not a trigger.** Telegram's known-target rules above decide recipients; bot messages remain context only. Discord turns still require a human mention/reply to that bot. Two bots selected simultaneously can answer concurrently, and neither is promised visibility of an answer not yet posted when its turn was submitted. Wait for one answer before asking another to react.

Quoted replies include original speaker, message ID and available original text or caption, plus any selected quote excerpt. Context is labeled as quoted conversation data, not new operator instructions.

Telegram shared history is persisted in mod settings, deduplicated by message ID and ordered by that ID. Limits are 100 recently active rooms, 50 messages per room, 4,000 UTF-16 units per message without splitting surrogate pairs, 512,000 serialized UTF-8 bytes overall, and 16,000 UTF-8 bytes of room-history JSON per submission. The current message is separate and later messages are not added retroactively.

Only approved, enabled routes contribute inbound history. Disabling/deleting access stops new input through it but does not erase retained room history or Core session history. Direct chats, different chat IDs and different topic IDs never share that record. Messages Telegram did not deliver cannot be recovered.

Discord independently persists bounded history per guild+channel across approved bots; a thread ID is its own room. DMs are connection-isolated. On authorized or explicitly approved guild routes, human text and observed bot/webhook text can be context while only a human mention/reply starts a turn. Discord uses the same 100-room, 50-message, 4,000-UTF-16-unit, 512,000-byte total and 16,000-byte submission-context limits.

The complete submission is frozen before Core submission so an uncertain submission can replay the same input after restart even if room history changes. These pending inputs are internal state and omitted from public delivery diagnostics. The 200-record connection limit still bounds recovery.

