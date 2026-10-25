# Set up Discord

## Prerequisites and least privilege

Install and enable Switchboard, use an enabled limited-capability Burrow agent, and confirm Core exposes `context.agents.turns.submit` and `context.agents.turns.read`. Use **one Discord application/bot per goblin** (and one named Discord connection per bot); do not reuse a token across connections. In the [Discord Developer Portal](https://discord.com/developers/applications), create each application, add its bot, securely retain its bot token, and enable the **Message Content privileged intent** for each bot. Switchboard needs actual text content for admission and turns. Enable Message Content in the portal and obtain privileged-intent approval when Discord requires it for your application. Do not paste tokens into chats, logs or support reports. See [Discord’s Message Content intent requirements](https://docs.discord.com/developers/events/gateway#message-content-intent).

Generate a bot invite for the intended server with **View Channels**, **Send Messages**, **Read Message History**, and **Send Messages in Threads**. Do not grant Administrator merely for Switchboard. Allow each bot to see/read and post in the specific channel and thread you intend to use. For a **private thread**, explicitly add/invite each bot as a thread member: parent-channel permissions alone do not imply thread membership. Discord also permits access through Manage Threads, but granting that broader permission is not required by this guide. Server/channel permission overwrites still apply. Switchboard does not set Discord intents or permissions for you. See [Discord thread permissions](https://docs.discord.com/developers/topics/threads#permissions).

Switchboard connects outward to Discord's Gateway (WebSocket) and REST API; it does **not** register an inbound interaction/webhook URL or require an inbound reverse proxy. It handles text messages and native slash commands, not attachments, voice or streaming.

## First server or DM

1. In **Settings → Switchboard → Bots**, add a Discord connection, enter its write-only token, assign its goblin and enable the gateway. Check bot identity, transport and Core state there or in **Diagnostics**.
2. Once the gateway observes the server (guild), it appears in **Server access**. Approve the server once for this bot. Visible channels and threads now inherit access without per-channel approval. Discord permission overwrites and private-thread membership still apply.
3. Send a fresh human mention or reply to the bot in a channel. Each channel/thread has an isolated session and room context. DMs remain individually admitted on the same Bots page; explicit/legacy channel overrides remain supported under collapsed **Room overrides**.
4. Pause/revoke server access to stop inherited routes. Explicit room grants remain independent; disable/remove those separately when needed. Rejected server mutations do not revoke valid in-flight replies.

## Two-bot acceptance checklist (operator-run, not a live verification claim)

1. Create separate applications/connections and assigned goblins; enable Message Content and invite both with suitable Discord permissions.
2. On **Bots**, approve the observed server for each bot once. Send fresh human mentions to verify replies; do not approve every channel/thread.
3. Ask bot A for a distinctive fact; wait for its posted reply. Mention bot B and ask what A said. Shared bounded channel context supplies the reply without bot-authored wake loops. Unaddressed guild text remains context only.
4. Test a second channel and a thread. They inherit access but must not share parent/sibling session history. Invite bots into private threads when Discord requires it.
5. Restart and verify reconnection and bounded history. Inspect **Diagnostics**; ambiguous outbound sends are not automatically resent. No repository fixture or mocked test constitutes live provider acceptance.

## Native slash commands

Switchboard registers `/help`, `/status`, `/stop`, `/new`, and `/model` with Discord
when its bot connects. Registration uses individual command upserts, not bulk
replacement: unrelated application commands are retained. Same-name chat-input
commands belong to Switchboard. Discord automatically includes `applications.commands` with the `bot` scope;
global commands may take time to propagate. See [application-command authorization](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application). If registration
fails, messaging stays available and registration is retried on reconnect.

Commands operate in enabled explicit mappings or inherited routes in an authorized server; DMs still require approval. `/help`
and `/status` are channel-scoped. `/stop`, `/new`, and model changes require a human
DM participant, or **Manage Server** / **Administrator** in guilds. Bots are ignored.
Replies are ephemeral and mentions are suppressed. Commands never generate LLM prompts.

- `/stop` cancels pending deliveries belonging to this mapped agent and current
  session only. An ambiguous admission is resolved with its durable idempotency key
  before cancellation; other sessions are not canceled.
- `/new` creates an owner-bound Core session and durably updates this channel's
  session binding. Prior sessions/history remain, but old replies are suppressed and
  pre-reset room history/quotes are not injected into the fresh session. Interaction
  IDs are Core creation idempotency keys.
- `/model` shows the selection; `/model selection:` offers safe inventory autocomplete
  and changes the current owner-bound session. Legacy deterministic Discord sessions
  must use `/new` first. Agent reassignment clears the old owned session binding.

**Release compatibility:** deploy Core's external agent cancellation, owner-bound
session creation/model read/model write, and safe `context.models.list()` APIs
**before deploying this Switchboard release**. Core with compatible submit/read retains ordinary messaging. Missing command methods produce upgrade guidance; a capability failure can instead produce the generic command-failed response. Do not use the turns indicator as proof that every command is supported. Interaction tokens are
transient REST credentials: never stored in settings, delivery records, or public state.
Initial deferrals are sent outside the serialized message queue; failed acknowledgments
perform no command side effects. Completed interaction IDs are durably deduplicated
within a bounded recent ledger (200 records); in-memory acknowledgments are bounded
at 500 IDs. A process failure after deferral can leave the ephemeral reply unfinished;
`/new` retries use Core idempotency, not a second fresh session.

Provider instructions rechecked **2026-10-25** against the official links above; source review covers version **2026.10.24.3** (`d1388ca8c65e250411034de7560de59d3ffdc875`). The checklist is for operator acceptance, not a claim that this documentation pass ran it.
