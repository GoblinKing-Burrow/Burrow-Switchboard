# Settings reference

Switchboard registers two Settings sections under manifest ID `burrow-switchboard`:

| Section | Purpose |
| --- | --- |
| **Bots** (`bots`) | Add/select connections, assign a default goblin, configure credentials and transport state, approve Telegram chat access or Discord servers, handle pending admissions, and manage room overrides |
| **Diagnostics** (`diagnostics`) | Inspect bot identity, transport/Core health, mappings, pending admissions and recent deliveries |

Older links to `configuration`, `pending-admissions`, and `chat-mappings` are still accepted by the UI and open **Bots**; an older `status` link opens **Diagnostics**. These are compatibility aliases, not separate current navigation sections.

## Bots

The **Bot connection** selector displays the provider and persists while moving between sections. All access, mappings and diagnostics belong to the selected connection.

- **Add bot connection:** choose Telegram or Discord, enter a name (up to 80 characters), token, optional **Assigned goblin**, and enable toggle. Saving validates provider identity. Transport is immutable and one provider bot can belong to only one connection.
- **Assigned goblin:** nullable connection default. New connections may be unassigned. Saving an explicit selection changes inherited Telegram approvals and Discord server routes; selecting the blank option clears the assignment. API clients that omit `agentId` preserve the existing value.
- **Connection name:** rename without changing routing or history.
- **Enable Telegram polling / Discord gateway:** affects only this bot. Disabling pauses ingestion and reply reconciliation; other connections continue.
- **Bot token:** write-only. Blank preserves the saved secret. Rotation is allowed only for the same provider bot; add a connection for a different bot.
- **Clear configured token:** confirmation-protected; removes this credential and disables transport while preserving assignment, binding, cursor where applicable, access, mappings and deliveries.
- **Remove connection:** confirmation-protected; stops the worker and deletes its credential and connection-scoped Switchboard state. It does not delete Core conversations or cancel already submitted Core turns. Mod-wide shared room history is also retained within its normal bounds.

Existing installations appear as the Telegram `default` connection, preserving credential, routes, offset/history and Core session identity without copying secrets.

### Chat and server access

An assigned goblin is required before approving inherited access.

- **Telegram:** a pending group/topic request is represented as the root group. Approving it grants that bot connection access to the root and all forum topics; topics retain isolated sessions/history. Direct chats remain individually admitted. Approval with **Use assigned goblin** inherits later assignment changes.
- **Discord:** once the gateway has observed a guild, it appears under **Server access**. **Approve server** grants inherited access to visible channels and threads without per-channel admission; **Pause server** stops inherited routes but retains the authorization record; **Revoke** removes it. Discord permissions, channel overwrites and private-thread membership still apply.
- **Pending admissions:** approve a direct/legacy room request with the assigned goblin or choose an explicit agent, or deny the current request. Denial is not permanent.
- **Room overrides:** inspect mappings and explicitly choose agent/enabled state. Explicit Telegram topic or Discord channel/thread mappings take precedence over group/server inheritance, including when disabled. Deleting only a generated mapping is not a revocation of its parent grant; remove or pause the parent chat/server access to stop inheritance. Removing a Telegram topic override exposes a still-approved root mapping.

Polling/gateway timeouts, retry intervals, provider endpoints, limits and chunk sizes are implementation constants, not operator settings.

## Diagnostics

Diagnostics displays transport health, polling/gateway activity, bot identity, Core capability, approved mappings, pending admissions and recent deliveries for the selected bot. Discord server authorization itself is managed on **Bots**.

Bot identity is populated after successful Telegram `getMe` or Discord `/users/@me` validation. Core availability checks only for the external-turn methods; it does not prove a configured agent will answer or that provider delivery works.

The UI loads on mount and after mutations and has **no periodic auto-refresh**. Revisit the section/page for a newer snapshot. A load failure offers Retry; leaving the section aborts its pending request and disposes the mounted UI.

Repository fake-DOM/frontend fixtures verify rendering and request wiring only. They are **not** evidence of a live browser session, provider credential, Discord guild observation, Telegram privacy configuration, network reachability or end-to-end delivery.

## Access control

The mod API rejects unauthenticated requests when the host reports authentication enabled. When host authentication is disabled, the mod does not independently require a login. Protect the Burrow operator interface using the host's controls; write-only tokens do not make an exposed settings endpoint safe.

