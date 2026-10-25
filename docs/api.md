# Mod-local API

These are **mod-local paths**, registered on `context.api`, not claims about a universal host URL prefix. The Settings UI uses the host-provided mod API client. Preserve the host's authentication and routing when integrating another client.

## Connection routes

All mutations return the full aggregate public state. Use connection IDs from `connections`, not names. Token creation/update validates the bot identity via Telegram `getMe` or Discord `GET /users/@me` before changing persisted configuration. New connection creation accepts `transport: "telegram" | "discord"` (omission defaults to `telegram` for legacy clients). The selected transport cannot be changed on update.

| Method and path | Body | Effect |
| --- | --- | --- |
| `POST /connections` | `{ "name": "Alerts", "transport": "discord", "token": "<token>", "enabled": true, "agentId": "hatchet" }` | Create a named connection with independent state |
| `PUT /connections/:connectionId` | `{ "name": "Alerts", "enabled": false, "agentId": "hatchet", "token": "<optional-same-bot-token>" }` | Rename/configure this connection; name/token optional, enabled required; no transport switch |
| `PUT /connections/:connectionId/servers/:guildId` | `{ "enabled": true }` | Authorize/resume an observed Discord server; false pauses inherited access |
| `DELETE /connections/:connectionId/servers/:guildId` | None | Revoke server inheritance; explicit room overrides remain |
| `POST /connections/:connectionId/token/clear` | None | Clear this credential, disable polling/gateway, preserve binding/state |
| `DELETE /connections/:connectionId` | None | Stop and delete this connection's credential/state, not Core conversations |
| `POST /connections/:connectionId/pending/:id/approve` | `{ "agentId": "<agent>" }` | Approve this bot's pending route; `{}` uses its assigned goblin (Telegram inheritance; Discord legacy approval is explicit) |
| `POST /connections/:connectionId/pending/:id/deny` | None | Deny this bot's current request |
| `PUT /connections/:connectionId/mappings/:id` | `{ "agentId": "<agent>", "enabled": true }` | Update this bot's mapping |
| `DELETE /connections/:connectionId/mappings/:id` | None | Delete this bot's mapping; later text may request admission again |

`agentId` is an optional nullable connection default: omitted on creation means unassigned, omitted on update preserves it, and null clears it. Explicit assignments must name enabled agents. Existing explicit room mappings remain unchanged. Telegram approvals with `{}` inherit later assignment changes; explicit `agentId` overrides them. Discord server grants need an assigned enabled agent and a guild observed by the gateway; the caller cannot grant an arbitrary unseen guild. Server IDs remain strings.

Names must be nonblank strings up to 80 characters. Unknown properties are rejected. Errors include 400 `connection_invalid`, `connection_transport_invalid`, `connection_name_invalid`, provider-specific `telegram_`/`discord_` token validation, auth, rate limit and response errors; 404 `connection_not_found`; 409 `<provider>_bot_already_connected`, `<provider>_bot_changed_add_connection`. The latter means add the different bot as another connection rather than carrying old routes onto it.

## Legacy routes (default connection)


| Method and path | Body | Effect |
| --- | --- | --- |
| `GET /bootstrap` | None | Full public state |
| `GET /configuration` | None | Same full public state, not just configuration |
| `PUT /configuration` | `{ "enabled": true, "agentId": "<optional-agent>", "token": "<replacement-token>" }` | Save enabled flag and optionally replace token |
| `POST /configuration/token/clear` | None required | Remove token, disable polling, retain bot binding |
| `POST /pending/:id/approve` | `{ "agentId": "<enabled-agent-id>" }` | Approve pending DM/root group; `{}` inherits the assigned goblin |
| `POST /pending/:id/deny` | None required | Remove current pending entry |
| `PUT /mappings/:id` | `{ "agentId": "<enabled-agent-id>", "enabled": false }` | Update existing mapping |

Use IDs returned in public state; do not derive them from a displayed chat title. The legacy routes target only the default Telegram connection. `DELETE /mappings/:id` also deletes only its mapping. There is no retry-delivery, reset-state or transport-switch endpoint.

Configuration requires a boolean `enabled`; omit `token` to preserve the secret. A supplied token must be a nonempty string, at most 4,096 characters, and is trimmed. Approval/mapping agent IDs must be nonempty strings at most 96 characters. Configuration, approval and mapping bodies reject unknown keys, arrays and non-object values. Mapping updates require both fields and validate the agent even if disabling.

## Success and state

Every successful route returns HTTP 200 with `{ "ok": true, ...state }` and `Cache-Control: no-store`. State includes `connections: [{id, name, transportType, ...connectionState}]` (`transportType` is `telegram` or `discord`) and shared `coreAgentTurns`. For backward compatibility top-level fields below describe only `default` (empty/stopped if removed). Per-connection state includes:

- `enabled` and `tokenConfigured` booleans; nullable assigned `agentId`.
- Discord `servers: [{ guildId, name, enabled }]` and `pendingServers: [{ guildId, name }]` from gateway observations.
- Telegram group requests use the root group identity; inherited topics keep distinct runtime sessions and shared-history rooms.
- `bot`: configured indicator and, when known, `id`, `username`, `displayName`.
- `transport`: enabled, health, polling, lastPollAt, error; Discord additionally identifies gateway state. The legacy `polling`/`lastPollAt` field names are also used for gateway activity.
- `coreAgentTurns`: available and, when unavailable, reason.
- `mappings`: saved route fields plus resolved `agentName`.
- `pending`: chat/topic/requester (Telegram) or DM/channel/thread/requester (Discord) admission records.
- `deliveries`: recent records plus resolved `agentName`.

The token and internal Telegram offset or Discord gateway session state are not returned. Treat requester details and delivery metadata as operator data, not public telemetry.

## Errors

Errors return `{ "ok": false, "error": "<code>" }` with no-store headers. Known 4xx errors preserve their status/code; other failures become HTTP 500 `switchboard_request_failed`.

| Status | Codes / conditions |
| --- | --- |
| 400 | `configuration_invalid`, `telegram_token_invalid`, `approval_invalid`, `mapping_invalid`, `agent_invalid`, `server_invalid`, `connection_transport_invalid` |
| 401 | `operator_authentication_required` when host authentication is enabled but request is unauthenticated |
| 404 | `agent_not_found`, `pending_admission_not_found`, `mapping_not_found`, `server_not_found` |
| 409 | `agent_disabled`, `agent_required`, `server_limit_reached`, `mapping_limit_reached` |
| 500 | Sanitized `switchboard_request_failed` |

Validation order can affect which error is returned; for example approval validates the selected agent before looking up the pending ID. Do not depend on an error as a route-existence probe.

