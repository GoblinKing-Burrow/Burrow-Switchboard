# Native Settings inventory layout correction

> Historical implementation/acceptance record. This records the source and checks at the time, not a fresh verification or the current Settings layout. For the current Configuration, Pending admissions, and Chat mappings workspaces, use [Settings](settings.md). The former Core status panel is not part of the current UI.

## Source and scope

Switchboard baseline: `e368fafc5ccbdd06cd98ff6498ef6fe8d3f992a1`.
Native host reference: Burrow-UI `572f2908664027f644330a4cdaf9bfe021265e15`.

Compared the current Settings UI contract, imperative Settings API, actual MCP server inventory/editor, ModSettingsHost, SettingsEntitySelector, normalized workspace and shared sizing source. The October 31 acceptance describes a superseded arrangement; it is historical evidence, not acceptance of this change.

Bots now explicitly declares `layout: 'form-inventory'`. The host owns placement: bounded inventory left, complete editor right, native stacked arrangement below 640px available workspace width. This uses the shared 20px pane gap and existing Statistics-aware allocation, without copied CSS or new surface wrappers. Refresh/Add bot precede long inventories. The repeated connection status below the form is removed; operator status remains in the editor metadata and inventory; the raw transport health is retained beside the operator status in editor metadata, with connection errors still shown. The inventory has no additional heading, matching native MCP markup. Pending request contents use a flat shared stack rather than another nested divided group.

Bot Save, write-only token behavior, chat responder autosave, immediate admission/access actions, native confirmations and Save/Discard/Stay remain unchanged. There is no provider/model picker on this screen; the existing messaging transport and responder-agent choices remain distinct. No Archive or server implementation is changed.

## Verification

- `npm run build`: PASS (ES-module syntax checking, not a UI bundle).
- Explicit seven-file local service/UI test command from development documentation: **221 passed**, no failures or skips; includes **84 UI tests**. The added 17-bot case checks first/last selection, Add and absence of mutations or editor controls in inventory.
- `git diff --check`: PASS.
- Full `npm test` was attempted before the additional UI case: **217 passed, 3 failed** because the required sibling Burrow-Backend source/runtime is absent. Core discovery, image capability handoff and disposable PostgreSQL image roundtrip therefore remain **PENDING**, not passed.
- Actual production-host build/browser pixel and geometry acceptance: **PENDING**. FakeDOM tests do not prove placement, scale, responsive scrolling, Statistics behavior or visible control reachability. Fresh 1910px/2560px and narrow screenshots with Statistics open/closed are still required. No screenshot from an older host is substituted as evidence.

This is source-only draft work. No release, merge, installation, live credential use or deployment is included. Layout metadata requires the current host; old hosts with draft APIs may still fall back to legacy placement.

## Review corrections: request spacing and action sizing

Follow-up to reviewed head `301af0dfaad93705a70dcb2a10d7a09b49d2b4dc`:

- All pending-request articles now share one `settings-stack`, restoring the host's 12px inter-request gap without nested divided groups. Each request retains its internal stack and admission controls.
- Both bot and chat editor footers use `setting-actions settings-row`, replacing the legacy `model-actions` two-column grid with native content-sized wrapping actions. Save, Cancel and chat retry semantics are unchanged.
- The reference host remains Burrow-UI `572f2908664027f644330a4cdaf9bfe021265e15`; actual shared CSS was inspected, not replaced by mod-local styles.
- Build and diff whitespace checks pass. Local service/UI checks: **224 passed**, including **87 UI tests**. Three new regression cases cover multiple pending requests in both host placements and Add/Edit/chat/retry footers. All three fail against the pre-fix renderer and pass with these corrections.
- Full `npm test`: **224 passed, 3 failed** solely because the required sibling Burrow-Backend source/runtime is missing. Core integration remains pending.
- Chromium launch was attempted for CSS-harness geometry checks but failed before rendering (`socket() Operation not permitted` in `process_singleton_posix.cc`). No browser geometry or screenshot acceptance is claimed. Actual production-host wide/narrow and Statistics-open/closed visual acceptance remains pending.
