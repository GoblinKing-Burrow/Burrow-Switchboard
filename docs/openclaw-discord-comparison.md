# Discord adapter comparison — 2026-10-24

> Historical comparison snapshot, not a current Switchboard feature specification. As of the 2026-10-25 source review (`d1388ca8c65e250411034de7560de59d3ffdc875`), native Discord commands and server-inherited access are implemented; older gap/planning statements below are superseded by [Discord setup](discord.md) and [routing](routing.md). External OpenClaw behavior was not revalidated in this review.

## Reference snapshots

- Retained OpenClaw reference version: `2026.6.10`.
- Public upstream reference: `openclaw/openclaw`, commit
  `1b4914c7866ddd4284c1c65ff4f56318c347a11c`.
- This is a source comparison, not a live interoperability or feature-parity claim.
  No upstream implementation was copied into Switchboard.

## Findings

The retained version already documents native slash commands, isolated command
sessions carrying a target conversation session key, interactive model selection,
and reply policy (`docs/channels/discord.md`). Its bundled adapter distinguishes
`BodyForAgent`, `RawBody`, and `CommandBody` (for example
`dist/monitor-DnuU2Hl1.js`). Do not treat the old implementation as obsolete merely
because a newer checkout exists.

Current upstream makes that separation explicit in
`extensions/discord/src/monitor/message-handler.context.ts`: `message.body`,
`rawBody`, `bodyForAgent`, `commandBody`, and `inboundHistory` are separate inputs.
The same structure carries conversation/thread identity, dispatch/model-parent
session routing, and reply targets separately. The native-command modules include
interaction deferral, expired-interaction handling, command authorization, target
session routing, and ephemeral responses. These are useful references, not features
that Switchboard currently provides.

Switchboard currently handles gateway ingestion, admission, channel/session mapping,
reply/mention policy, bounded room history, and durable delivery reconciliation.
It has no native slash-command dispatcher. Its prompt-envelope string was also
being reused as Core's visible user message, causing the JSON-filled chat bubble.

## Completed immediate correction

Core external turns now accept optional `displayMessage`, defaulting to `message`
for existing callers. Both are persisted and included in idempotency checks. Core
uses `message` for model execution and `displayMessage` for the visible user turn.
Discord sends the current cleaned text as `displayMessage`; bounded room context
and attribution remain in model input. No frontend regex or hidden CSS is needed.

Legacy durable submissions remain unchanged: they replay with their original input,
not a silently rewritten payload under the same idempotency key. Existing transcript
bubbles are not migrated. Deploy the updated Core before the updated Switchboard,
because older Core versions reject unknown capability input fields.

## Follow-up candidates, not implemented here

1. Native slash-command registration and interaction acknowledgement/defer handling,
   backed by actual Burrow session/model/status operations rather than OpenClaw's
   command internals.
2. Structured inbound speaker/reply/context metadata instead of embedding all
   model context in a string; retain explicit untrusted-history boundaries.
3. Typing/progress feedback and stage-specific delivery diagnostics.
4. Attachment and edit behavior, validated against Burrow's attachment lifecycle.

Retain Burrow's owner-scoped durable turns, frozen submissions, idempotency, and
reconciliation. Do not transplant OpenClaw's session engine or replace Switchboard
wholesale. Any later copied source must retain the upstream license/provenance.

