# Settings reference

Switchboard contributes **Bots** under **Settings → Switchboard**. Full diagnostics live in **Archive → Mods → Switchboard**, following Archive’s existing bot list and detail-reader layout. Older `status`, `configuration`, `pending-admissions`, and `chat-mappings` Settings links open Bots.

## Everyday use

**Bots** follows Burrow’s Connections → MCP servers inventory/editor pattern:

- The **primary work surface** starts with an Add bot form. Select a saved bot in the **supporting inventory** to open its complete editor directly—no second Edit click.
- Bot name, default responder, Receive messages and token replacement form one explicit **Save bot** scope. Saved credentials stay undisplayed; replacement is disclosed only when needed.
- The same primary surface shows pending requests and allowed chats/servers for the selected bot. **Pause / Resume**, **Allow**, **Dismiss** and **Revoke** are immediate operations; they do not save other bot edits.
- **Change** opens a chat’s responder editor in primary. Selecting a goblin saves immediately, with Saving/Saved/error feedback. Failed choices remain editable and expose **Retry saving**; there is no normal Save chat button.
- The supporting surface contains only compact selectors, connection/responder/request summaries and immediate Refresh/Add actions—no editable settings. With no supporting target, the same inventory appears once in a Saved bots disclosure below the primary editor.

All controls, section headings/dividers, compact inventories, confirmations and navigation protection use the shared Burrow Settings host. The mod injects no stylesheet or private dialog system. This UI requires the host methods `confirm`, `navigate` and `setDraft`; install the matching Burrow UI support together with Switchboard. An older host shows an explicit compatibility message instead of an unguarded editor. Existing bot operation is unchanged by that message.

### Bot setup and save scope

Choose Telegram or Discord, a friendly bot name, a bot token, and **Who answers new chats**, then **Connect bot**. Setup links point to Telegram’s BotFather or Discord’s Developer Portal. A new bot starts receiving messages unless **Receive messages** is turned off. Provider validation establishes the bot identity; a provider bot may belong to only one connection.

- **Who answers new chats** is the bot default. Chats using that default follow later changes; custom assignments remain unchanged. **Choose when approving a chat** clears the default. Already-approved default-following chats without a responder cannot deliver until a default or custom responder is set.
- **Receive messages** pauses ingestion and reply reconciliation without deleting credentials or access. It does not cancel Core turns already submitted. It belongs to the complete bot configuration Save scope, not an independent chat operation.
- A blank replacement token keeps the saved credential. The saved value is never returned or displayed. Use Add bot to connect a different provider bot.
- Unchanged responder IDs are omitted on save, allowing an unavailable bot’s connection to be paused without revalidating that unchanged assignment. Paused tokenless bots can still be edited.
- **Remove bot or clear token** exposes separate confirmed destructive actions. Clearing retains access, assignments and records; removing deletes that bot’s Switchboard configuration, not provider chats or Core conversations. Other bots are unaffected.

Only one editor/save scope is active. Dirty values are recognized against an accepted baseline; reverting clears dirty state and unchanged/in-flight submissions do not write again. Request/validation failures preserve the draft and secret input. Secrets remain in component memory only, never client storage.

Switching bot, chat, subsection, category or application page uses Burrow’s shared **Save / Discard / Stay** guard. Failed Save stays in the current editor; busy operations block navigation. Reload/close uses the host’s native browser leave warning for dirty or busy state. Destructive actions first resolve an unsaved editor through this same guard, then use Burrow’s normal confirmation dialog with current saved names and IDs.

### Telegram chats and topics

A direct message requests access individually. A group/topic request represents its **root group**; allowing the group includes its forum topics, with separate topic sessions and history. Send a fresh message after approval; the requesting message is not replayed.

Choose **Goblin name · bot default** to follow the saved default, or an explicit enabled goblin for a chat-specific assignment. Missing defaults do not invalidate working custom assignments. **Topic exceptions** take priority over the root group, including when paused. Removing an exception reveals still-allowed parent access; pause to block a topic instead. Removing a root group does not remove explicit topic exceptions. Telegram privacy mode and permissions still determine which updates reach the bot; see [setup](setup.md).

### Discord servers, channels and direct messages

Observed servers appear under **Servers** after invitation. Allow/Resume requires an enabled default responder and permits visible channels and threads. Pause retains the grant; Revoke removes inherited access. Provider permissions and private-thread membership still apply.

Direct messages are approved individually and never require a server grant. Channel/thread exceptions retain the distinction between **who answers** and **where the bot is allowed**. Generated rooms remain dependent on their server grant even after choosing a custom responder. Independently approved legacy rooms remain independent. Restoring the bot-default responder does not expand access, and server pause/revoke still fences generated routes and outstanding replies.

### Refresh and lifecycle

Refresh fetches current state without saving drafts. Idle visible pages also check every 10 seconds; focused controls, failed/dirty edits, dialogs and busy operations are not replaced by automatic checks. Unchanged polls preserve live draft/control identity. Delayed manual refresh success/failure does not detach a control focused while the request was in flight. Untouched bot fields rebase to refreshed accepted values so a name-only save does not undo an external pause.

Failed refreshes retain usable data and expose an error. Older reads cannot overwrite newer writes. Removed bots/chats orphan their drafts rather than rebinding to another item with a shared mapping ID. Leaving aborts requests, cancels polling and clears the host registration. Browser cancellation is not proof of server-side rollback; revisit to reconcile uncertain requests.

## Diagnostics and boundaries

In **Archive → Mods → Switchboard**, select a bot to inspect transport health/activity, bot identity, Core-turn availability, approved mappings, pending admissions and recent deliveries. The view uses Archive’s existing list/detail reader, not a second settings workspace or metric dashboard. **Refresh** requests a new snapshot, and idle visible views check every 10 seconds. Leaving the pane cancels polling and requests. Bot configuration and compact current connection/status indicators remain in **Settings → Switchboard → Bots**.

This is the current bounded Switchboard snapshot, not a complete historical audit store. Archive’s global date filter does not filter this snapshot; moving the view does not change retention, delivery semantics or existing records.

Connected describes the transport snapshot, not proof of model execution or end-to-end delivery. Fake-DOM tests verify event wiring and lifecycle; real-browser acceptance uses production host assets and synthetic APIs, not real messaging services. The repository retains a dated Settings acceptance receipt; those reported checks are separate from this documentation review.

Host authentication policy is preserved, including intentional authentication-disabled configurations. Protect the operator interface with the host’s controls; write-only tokens do not make an exposed settings endpoint safe.

