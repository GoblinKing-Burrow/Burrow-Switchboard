# Architecture and Core contract

## Boundaries

`server/index.mjs` activates one service, registers legacy and connection-scoped operator routes and returns an asynchronous cleanup function. `server/connections.mjs` owns the persisted registry, connection lifecycle and scoped stores. `server/telegram.mjs` contains Telegram API transport, settings-backed state, routing/admission, polling and reply reconciliation. `server/discord.mjs` contains Discord Gateway/REST, DM/channel/thread admissions, durable deliveries and bounded guild-channel context. `server/room-history.mjs` owns the shared, bounded group/topic context store and reply attribution. `ui/settings.js` implements the two host Settings sections, Bots and Diagnostics.

```text
Telegram message update
  → chat/topic admission
  → record approved group human text in shared room history
  → transport recipient selection and bounded room/quoted-reply context
  → for supported images, getFile + bounded Telegram download, then freeze private submission
  → Core agents.turns.submit (agent, session, message, idempotency key, optional attachments)
  → saved inbound delivery and turn ID
  → later Core agents.turns.read
  → completed answerText
  → saved outbound sending record
  → Telegram sendMessage
  → record Telegram-confirmed reply chunks in shared room history
  → delivered or unknown
```

Switchboard does not directly call a model provider or run a parallel tool loop. It submits a real agent turn to Core. Telegram and Discord are implemented behind separate workers with a shared connection registry; ordinary message routing uses the existing external-turn contract and neither transport requires Tutor integration. Discord commands additionally require the Core APIs listed below.

## Host capabilities

The service requires `context.settings`, `context.secrets` and `context.agents`. Public state lists agents; approval and mapping edits require an existing enabled agent. External execution requires:

```js
const accepted = await context.agents.turns.submit({
  agentId: mapping.agentId,
  sessionId: `telegram:${chatId}:${topicId ?? 'root'}`,
  displayMessage: text,
  message: '[Telegram message from … in …]\n\n' + text,
  idempotencyKey: `telegram-update-${updateId}`,
  // For an inbound image, optional; never a token-bearing URL:
  attachments: [{ name: 'telegram-image.png', type: 'image/png', size: imageBytes.length, encoding: 'data-url', content: `data:image/png;base64,${imageBytes.toString('base64')}` }],
});
const turn = await context.agents.turns.read(accepted.turn.id);
```

The example shows the migrated Telegram default. New Telegram connections prefix connection ID; Discord uses `discord:<connectionId>:<channelId>` (Discord IDs are strings) and `discord-<connectionId>-message-<messageId>` as its Core idempotency key. The legacy Telegram session string is truncated to 128 characters; new connections include their UUID in the session identity. `submit` returns an accepted turn record; it is not an immediate answer. Reconciliation recognizes `succeeded`, `failed` and `interrupted` as terminal. Successful reply text is taken from `turn.result.answerText`.

Both transports submit `displayMessage` separately from the attributed, context-enriched model-facing `message`; compatible Core must accept that field. It keeps the human-visible session text distinct from transport context.

Image turns require a Core version supporting external-turn attachments and a selected model configured to accept images; the submit/read availability indicator alone does not prove either. Core persists the attachment in its own agent artifact lifecycle and forwards image input to compatible models. Switchboard checks supported image signatures, limits the Telegram download to 20 MiB (within Core's 30,000,000-character data-URL limit), rejects redirects and never persists or sends the token-bearing download URL as model input. Captions and bytes are not public delivery diagnostics.

If submit/read are absent, valid routed input is recorded as failed with `core_external_agent_turns_unavailable`. Approval itself does not establish that Core turns are available.

### Additional Discord command capabilities

`/stop` needs `context.agents.turns.cancel`. `/new` needs `context.agents.sessions.create`; `/model` needs `context.agents.sessions.model`, `setModel`, and `context.models.list` for choices. `/new` persists the returned owned session ID and a history boundary on the mapping. Ordinary messaging still uses submit/read; command availability must not be inferred from the Core turns indicator. See [commands](discord.md#native-slash-commands).

## Multiple bot connections

Settings `connections` stores `{id, name, transport, botId}` records (`transport` is `telegram` or `discord`; absent legacy values mean `telegram`), never credentials. The original `default` connection retains its original keys and Core identities in place; new UUID connections prefix every settings/secret key with `connection-<id>-`. Each runs its own abortable Telegram poller or Discord Gateway worker and serialized delivery queue. Transport is immutable after creation. Registry/configuration mutations are serialized separately; one long poll does not block other bots.

New connections use session `telegram:<connectionId>:<chatId>:<topicId-or-root>` and idempotency key `telegram-<connectionId>-update-<updateId>`. Default preserves the old forms shown above. Local route/delivery IDs can match across bots because their stores are isolated. Provider token validation binds a connection to a bot ID, rejects duplicate bots and prevents retained routes/replies moving to a different bot.

Configuration invalidates network work before draining the worker queue and blocks new polling during persistence. Interrupted sends remain ambiguous and are not blindly retried. Already-sent provider work cannot be recalled, and Core turns are not canceled by disabling/removing a connection.

## Stored state

| Host store key | Contents |
| --- | --- |
| Settings `configuration` | Telegram polling or Discord gateway enabled flag and nullable default agent |
| Settings `transport-state` | Health, polling state, last poll time, sanitized error, cached bot identity, and provider-specific cursor/gateway state |
| Settings `mappings` | Up to 250 approved chat/topic or channel/thread → agent mappings; Discord may include an owned `sessionId` and `historyAfter` boundary |
| Settings `pending-admissions` | Up to 100 admission requests |
| Settings `deliveries` | Up to 200 combined inbound/outbound records per connection; Telegram retains unresolved frozen submissions, and Discord also enforces a 4,000,000-byte bound and protects unresolved/unknown records from eviction |
| Settings `servers` / `observed-guilds` (Discord connection-scoped) | Up to 250 authorized servers and 250 gateway-observed guilds; observations alone do not grant access |
| Settings `command-interactions` (Discord connection-scoped) | Up to 200 recent command IDs/statuses; no interaction tokens |
| Settings `telegram-room-history` (mod-wide, not connection-prefixed) | Up to 100 chat/topic rooms, 50 messages each, 512,000 UTF-8 JSON bytes total; see [routing](routing.md#shared-group-and-channel-conversation-context) |
| Settings `discord-room-history` (mod-wide) | Bounded guild/channel history shared across approved Discord bots; thread IDs are separate rooms; DMs connection-isolated |
| Secret `telegram-bot-token` or `discord-bot-token` (connection-scoped) | Provider bot credential; never part of public state |

Telegram mapping IDs are the first 24 hex characters of SHA-256 over `telegram:<chatId>:<topicId-or-root>`; Discord mapping IDs hash `discord:<guildId-or-dm>:<channelId>`. Inbound delivery IDs use `in:<updateId>` (Telegram) or `in:<messageId>` (Discord); outbound IDs are `out:<turnId>`.

Mutations and message/reconciliation operations share a serialized promise queue. Configuration changes increment a poll generation; stale batches are checked against generation, enabled state and current token before processing. An AbortController handles service shutdown. Discord additionally uses Gateway sequence/heartbeat/resume, periodic reconciliation and REST message write-ahead state. These mechanisms reduce races; they do not make either provider and Core one transactional system.

## Security and reliability boundaries

The host supplies operator authentication and secret persistence. API responses use `Cache-Control: no-store`; token presence and sanitized bot identity are exposed, not the token itself. Settings rendering uses text nodes rather than interpreting incoming chat metadata as HTML.

Admission controls the route, not each participant or every requested action. Core remains responsible for agent execution and its applicable tool/approval policies. Keep powerful agents out of broadly shared chats unless that access is intentional.

Persistent Telegram offsets or Discord Gateway reconnection plus Core idempotency and outbound state support restart recovery. Unknown sends are intentionally suppressed rather than retried. Bounded collections and absent replay controls mean this is not an exactly-once, lossless messaging service. See [operations](operations.md) before extending delivery behavior.


## Shared context boundary

The registry shares a mod-wide Telegram room-history store between its Telegram
workers and a separate mod-wide `discord-room-history` store between Discord
workers. Serialized persistence prevents lost updates across workers. Only Telegram
group/supergroup chat+topic identities share Telegram context; Discord shares per
guild+channel across approved bots. A thread is a separate channel room and does
not inherit its parent history; DMs are connection-isolated. Credentials, polling
cursors or gateway sessions, admissions, Core execution sessions and outboxes stay
scoped to each connection.

Successfully posted answer chunks enter shared history after provider confirmation,
not merely Core success. Failed/unknown sends do not manufacture room text. A crash
between provider acknowledgment and history persistence can leave a visible message
absent from bounded context; no blind resend is attempted.

Shared room context needs no new Core capability or Tutor integration: existing settings
persistence and external-turn submission carry the context. This does not remove the additional Core prerequisites for Discord session commands. Full submissions, including inline image bytes, are
frozen in private settings before Core submission and reused if acceptance is uncertain. They are
never exposed in public delivery diagnostics. Shared context never invokes a peer
agent, so no automatic bot-to-bot wake loop is introduced.

## Inherited access

Telegram approvals can inherit connection assignment (`inheritedAgent`); group-root access covers topics without merging their sessions or context. Explicit topic mappings win. Discord `servers` and gateway-owned `observed-guilds` persist per connection; generated `inherited` routes use the assigned agent and remain isolated per channel/thread. Revocation fences inherited replies, not independent explicit room grants. Operator settings combine bot identity, credential, assignment and access in Bots, with Diagnostics separate.

