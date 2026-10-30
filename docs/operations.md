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

State survives through host settings/secrets, but collections are bounded. The per-connection 200-record combined delivery limit can remove old Telegram records, including accepted work still pending under enough traffic; frozen uncertain submissions are protected from eviction. If every record is protected, Telegram reports `telegram_backlog_full` and stops ingesting until space is available. Discord protects unresolved and unknown deliveries from eviction and reports `discord_backlog_full` when no completed non-unknown record can be removed; a 4,000,000-byte delivery-state ceiling also applies. Do not treat this initial implementation as an unbounded durable outbox or unlimited audit trail.

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
| `telegram_image_unsupported` | Send a PNG, JPEG, GIF or WebP photo/document with a recognized signature; document MIME must match the image bytes. No text-only turn was submitted |
| `telegram_image_too_large` | Telegram image exceeded the hosted Bot API 20 MiB download limit; send a smaller image. No text-only turn was submitted |
| `telegram_image_download_failed` | Check Telegram connectivity/file availability; send a fresh image after fixing it. Failure details and token-bearing URLs are deliberately redacted |
| `telegram_backlog_full` | All 200 records are protected uncertain submissions; inspect Core and resolve the backlog before ingesting more work |
| `discord_gateway_intents_disallowed` / `discord_gateway_auth_failed` | Enable Message Content in the Discord application or check token; inspect connection health after reconnect |
| `discord_token_missing` / `discord_auth_failed` / `discord_token_validation_failed` | Check the selected bot's write-only credential privately |
| `discord_rate_limited` / `discord_gateway_unavailable` / `discord_request_failed` | Check outbound network/Discord availability and allow retry/reconnect; do not expose credentials |
| `discord_backlog_full` | Review unresolved/unknown deliveries and Core progress; no automatic reset/replay operation is provided. Do not clear state or resubmit work blindly |
| Discord command says upgrade or fails | Verify the command-specific Core APIs, not just the submit/read indicator; see [Discord commands](discord.md#native-slash-commands) |
| Inbound `processing` persists | Inspect the corresponding agent/Core turn; a read failure is retried by later reconciliation without a new per-delivery diagnostic |
| Inbound `failed` / `interrupted` | Inspect the redacted delivery `error` in the mod-local bootstrap/configuration response: an image error above indicates no Core submission; otherwise investigate the Core turn or mapping change |
| Inbound `succeeded`, no message | Check for empty answer or an outbound `unknown`; success is not proof of delivery |
| Outbound `unknown` | Inspect chat for complete/partial delivery; do not blindly resubmit work |
| Denied chat returns | Expected: denial removes one request, not a permanent block |
| Disabled chat never becomes pending | Expected: its saved mapping still exists; use Bots → Room overrides to re-enable |

## A useful support report

Include installed mod/Core versions, redacted transport health/error, relevant chat type and topic presence, approximate timestamps, delivery direction/status and Core turn ID if appropriate. Explain whether a fresh message was sent after approval. Remove token values, token-bearing URLs, personal chat content and unnecessary requester identifiers. There is no need to expose a private source repository in a public report.


## Telegram images

Use a compatible Core with external-turn attachments and choose a model that accepts image input. Telegram sends its ordinary photo variants or an image document; Switchboard selects a practical variant, checks downloaded byte signatures and applies a 20 MiB maximum. Image-only input is supported. The initial admission image is not replayed: send another after approval. Failed download, unsupported type or oversize produces a failed inbound delivery and **does not** submit the caption without its image; inspect the redacted `error` in the mod-local bootstrap/configuration response (the Settings list shows status). No provider URL, token or bytes are included in public diagnostics.

Pending uncertain Core submissions temporarily retain their exact image bytes and caption in private mod settings for replay; after Core accepts, the frozen copy is cleared. Core retains accepted image artifacts under its own policies. Room context stores only caption/marker text, not images. Disabling a connection aborts an in-flight download; deleting/changing its mapping interrupts pending work but cannot recall an already accepted Core turn. Discord image input, generated images and outbound image replies remain unsupported.

### Image/Core compatibility and interrupted inputs

A first-attempt rejection known to occur before Core admission is terminal for that update: Diagnostics records a sanitized error and polling continues to later text instead of wedging the bot. `core_image_attachments_unavailable` means Core rejected an image input with its generic input-invalid code; upgrade Core first, but this code alone does not prove a missing feature. Other codes are `core_turn_input_invalid`, `core_image_attachment_too_large`, `core_agent_not_found`, and `core_agent_disabled`.

A lost acceptance response is different: exact frozen input stays pending under the original key, including during temporary Core-capability outages. Disabling/removing or reassigning its mapping interrupts frozen work and clears its stored bytes, even if an older record mislabeled it terminal. This cannot recall a Core turn already accepted. No automatic new-key retry is used for uncertain acceptance.
