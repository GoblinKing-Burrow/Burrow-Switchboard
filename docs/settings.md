# Settings reference

Switchboard has four workspaces under **Settings → Switchboard**. The selected bot is shared across them through Burrow's native named-button selector, including its bounded overflow navigation. **Archive → Mods → Switchboard** remains retained historical work and outcomes, not live settings.

- **Status**: live transport/Core health, bot identity, current delivery snapshot, approved mappings and pending admission summaries/counts. No configuration mutation controls.
- **Configuration**: create a connection or edit its name, default responder, Receive messages and write-only token. One coupled **Save bot** scope; clear-token and removal remain separate confirmed operations.
- **Pending admissions**: chat requests, request times/IDs, responder selection, Allow/Dismiss and newly observed Discord server admission. Empty queues are explicit.
- **Chat mappings**: approved chats, topic/channel/thread exceptions, Discord server grants, responder changes, Pause/Resume and scoped removal/revocation.

Each workspace uses the native `form` layout: a complete left-hand pane at wide available widths, full available width when constrained. The host owns the bot selector, subsection navigation, Statistics track and responsive shell. No mod-local stylesheet, width cap, private selector or dialog is introduced. Action buttons remain grouped and content-sized.

**Add bot** opens Configuration through the shared guard from any workspace. Refresh is available above the workspace contents. Hosts must supply `confirm`, `navigate`, `setDraft`, `setEntitySelector` and `navigateSection`, plus imperative form layout support; unsupported hosts show a compatibility message rather than an unguarded editor. Current host reference: Burrow-UI `4f7f58f682a0cffe83290276307c66631a361de3`.

The original four IDs are real sections again. A direct legacy `bots` mount aliases Configuration; `diagnostics` aliases Status. Native hosts validating an unknown old section before mounting fall back to the first valid section, Status, rather than a blank screen.

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

Observed servers appear under **Pending admissions → Servers** after invitation; approved grants are managed under **Chat mappings → Servers**. Allow/Resume requires an enabled default responder and permits visible channels and threads. Pause retains the grant; Revoke removes inherited access. Provider permissions and private-thread membership still apply.

Direct messages are approved individually and never require a server grant. Channel/thread exceptions retain the distinction between **who answers** and **where the bot is allowed**. Generated rooms remain dependent on their server grant even after choosing a custom responder. Independently approved legacy rooms remain independent. Restoring the bot-default responder does not expand access, and server pause/revoke still fences generated routes and outstanding replies.

### Refresh and lifecycle

Refresh fetches current state without saving drafts. Idle visible pages also check every 10 seconds; focused controls, failed/dirty edits, dialogs and busy operations are not replaced by automatic checks. Unchanged polls preserve live draft/control identity. Delayed manual refresh success/failure does not detach a control focused while the request was in flight. Untouched bot fields rebase to refreshed accepted values so a name-only save does not undo an external pause.

Failed refreshes retain usable data and expose an error. Older reads cannot overwrite newer writes. Removed bots/chats orphan their drafts rather than rebinding to another item with a shared mapping ID. Leaving aborts requests, cancels polling and clears the host registration. Browser cancellation is not proof of server-side rollback; revisit to reconcile uncertain requests.

## Diagnostics and boundaries

Select a bot and open **Status** for Core availability and its reported reason, transport polling mode, last poll, Discord gateway state, and the bounded recent delivery snapshot (including in-flight work). Delivery rows show direction, timestamp, status/error and routing IDs only, never input bodies, answers or credentials. This is read-only and uses the existing Settings refresh cycle. Pending requests include their request time and identifiers; **Chat details and removal** includes the mapping, goblin and session IDs. Admission, routing and token actions remain in their own workspaces and retain their current mutation semantics. Unlike the original October UI, responder selection autosaves and Pause/Resume is immediate; this restoration does not silently reintroduce the old coupled responder/Enabled Save.


**Archive → Mods → Switchboard** contains retained historical work and reply outcomes, not current configuration, admissions or transport health. The native header supports historical bot, category, search and timezone-aware calendar filters; the reader shows safe delivery metadata rather than message bodies or work artifacts. Matching-record statistics are not lifetime totals or unique-conversation counts. History is retained separately from replay buffers and survives bot removal within its documented limits.

There is no manual refresh control in Archive. Visible idle views retry automatically every ten seconds, preserve selection, and mark retained results stale after a read failure. Current configuration, admissions and connection status remain in **Settings → Switchboard**. See [historical Archive semantics](archive-native-acceptance.md).

Connected describes the transport snapshot, not proof of model execution or end-to-end delivery. Fake-DOM tests verify event wiring and lifecycle; real-browser acceptance uses production host assets and synthetic APIs, not real messaging services. The repository retains a dated Settings acceptance receipt; those reported checks are separate from this documentation review.

Host authentication policy is preserved, including intentional authentication-disabled configurations. Protect the operator interface with the host’s controls; write-only tokens do not make an exposed settings endpoint safe.





