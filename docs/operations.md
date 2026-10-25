# Operations and troubleshooting

## Delivery states and uncertain outcomes

An inbound record tracks a Core turn. It can be `submitting`, `processing`, `succeeded`, `failed`, `interrupted` or `delivered`. `succeeded` means Core finished successfully; it is not synonymous with provider delivery. An empty answer yields no outbound message: Telegram leaves the inbound record `succeeded`; Discord marks it `delivered` without posting a message.

For a nonempty answer, Switchboard writes an outbound `sending` record **before** calling the provider. Successful sends mark inbound and outbound records `delivered`. A send error produces outbound `unknown`, because a failed response does not establish that the provider received nothing. A `sending` record encountered during later reconciliation becomes `unknown` too.

**Unknown outcomes are not automatically resent.** This intentionally favors avoiding duplicate messages. Telegram answers are split into 4,000-Unicode-code-point chunks; Discord answers into at most 2,000-UTF-16-unit chunks. Some chunks might have arrived before a later chunk failed. Inspect the provider channel before taking any manual follow-up action. The current UI/API has no retry, replay or delivery-reset operation. A new user message is a new agent turn, not a retry of the old reply, and could repeat side effects.

Telegram answers are sent without a parse mode. Discord sends message content with allowed mentions suppressed; Discord Markdown can still render, so this is not a formatting-disabled mode. The first chunk replies to the originating message where possible; later chunks go to the same route without that reply reference. Discord does not blindly retry ambiguous REST message sends.

## Multiple connections

Select the intended bot on **Bots** or **Diagnostics**. Each worker has an independent Telegram cursor or Discord gateway session, credential, admissions and bounded delivery history. A failing or paused bot does not stop the other pollers. Token replacement is restricted to the same bot; add another connection for a different bot. Duplicate bots are rejected even when another connection is disabled or its credential was cleared, until that connection is removed.

## Telegram polling and Discord gateway behavior

The Telegram poller obtains bot identity, reconciles existing turns, then requests new messages. Defaults are a 15-second Telegram long-poll timeout, 2-second disabled/missing-token wait and 3-second error retry wait. These are not hard end-to-end latency guarantees. New answers may wait for the current poll to finish before reconciliation.

The Discord worker validates bot identity, connects to the outbound Gateway WebSocket, heartbeats/resumes on reconnect when possible and reconciles Core turns on a separate timer. Its outbound REST sends remain write-ahead tracked; a restart or uncertain result does not automatically resend. Check Message Content intent and channel/thread access if text never arrives. Neither transport requires an inbound webhook.

Disabling polling/the gateway pauses both ingestion and reconciliation. Clearing the token additionally removes the secret. Existing Core turns are not canceled by those settings actions. Shutdown aborts network work and waits for the service loop/serialized queue to finish.

State survives through host settings/secrets, but collections are bounded. The per-connection 200-record combined delivery limit can remove old Telegram records, including work still pending under enough traffic. Discord protects unresolved and unknown deliveries from eviction and reports `discord_backlog_full` when no completed non-unknown record can be removed; a 4,000,000-byte delivery-state ceiling also applies. Do not treat this initial implementation as an unbounded durable outbox or unlimited audit trail.

## Group, channel and thread quick checks

For Telegram, check delivery/privacy, then the bot's assigned goblin and root-group approval on **Bots**. No known bot target means ordinary group speech broadcasts to participating bots; mentions/replies select known bots. Topics inherit group access, not history. Discord inherited access requires one server grant and a default agent, with Discord channel/thread permissions still applying. Explicit room overrides can independently block or grant access. See [routing](routing.md).

For Discord, check each bot's Message Content intent, View Channels, Send Messages, Read Message History, Send Messages in Threads and private-thread membership. Authorize the observed server once per bot; channels/threads inherit access unless explicitly overridden; ask A to speak, then ask B about A's posted reply rather than expecting a bot-trigger loop. See [Discord setup](discord.md).

## Diagnose in order

| Symptom | Check and action |
| --- | --- |
| No pending request | Correct bot identity and healthy polling/gateway; check actual text sent to exact route, Telegram privacy or Discord intent/permissions and private-thread membership; revisit Settings to refresh |
| Approved, but no reply | Send a **new** message; check mapping enabled and selected agent; Telegram groups broadcast when no known bot is targeted; Discord guild channels/threads require a human mention/reply. Check inherited assignment and parent access as well as explicit overrides |
| Core unavailable warning | Host lacks external-turn submit/read; use a compatible Core before retrying a harmless fresh message |
| `telegram_token_missing` | Configure a token or disable polling |
| `telegram_auth_failed` | Verify bot token validity privately; 401/403 are mapped to this code |
| `telegram_rate_limited` | Telegram returned 429; reduce traffic and allow recovery; current code retries at its fixed delay, not a parsed Retry-After value |
| `telegram_request_failed` / `telegram_response_invalid` | Check outbound connectivity and Telegram availability; never include token-bearing request URLs in diagnostics |
| `discord_gateway_intents_disallowed` / `discord_gateway_auth_failed` | Enable Message Content in the Discord application or check token; inspect connection health after reconnect |
| `discord_token_missing` / `discord_auth_failed` / `discord_token_validation_failed` | Check the selected bot's write-only credential privately |
| `discord_rate_limited` / `discord_gateway_unavailable` / `discord_request_failed` | Check outbound network/Discord availability and allow retry/reconnect; do not expose credentials |
| `discord_backlog_full` | Review unresolved/unknown deliveries and Core progress; no automatic reset/replay operation is provided. Do not clear state or resubmit work blindly |
| Discord command says upgrade or fails | Verify the command-specific Core APIs, not just the submit/read indicator; see [Discord commands](discord.md#native-slash-commands) |
| Inbound `processing` persists | Inspect the corresponding agent/Core turn; a read failure is retried by later reconciliation without a new per-delivery diagnostic |
| Inbound `failed` / `interrupted` | Investigate Core execution rather than assuming the provider transport is responsible |
| Inbound `succeeded`, no message | Check for empty answer or an outbound `unknown`; success is not proof of delivery |
| Outbound `unknown` | Inspect chat for complete/partial delivery; do not blindly resubmit work |
| Denied chat returns | Expected: denial removes one request, not a permanent block |
| Disabled chat never becomes pending | Expected: its saved mapping still exists; use Bots → Room overrides to re-enable |

## A useful support report

Include installed mod/Core versions, redacted transport health/error, relevant chat type and topic presence, approximate timestamps, delivery direction/status and Core turn ID if appropriate. Explain whether a fresh message was sent after approval. Remove token values, token-bearing URLs, personal chat content and unnecessary requester identifiers. There is no need to expose a private source repository in a public report.


