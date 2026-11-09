# Switchboard Settings contract correction — 2026-10-31

> Historical implementation/acceptance record. This records the source and checks at the time, not a fresh verification or the current Settings layout. For the current Configuration, Pending admissions, and Chat mappings workspaces, use [Settings](settings.md). The former Core status panel is not part of the current UI.

## Scope and reference

This supersedes the earlier same-day acceptance that treated a primary bot list / supporting editor as a host pattern. That arrangement and its local stylesheet did **not** meet Burrow’s Settings presentation contract. Prior receipts remain historical evidence, not current layout approval.

Read and compared the entire `Burrow-UI/docs/SETTINGS_UI_CONTRACT.md`, `SettingsPage.tsx`, `ModSettingsHost.tsx`, `SettingsPrimitives.tsx`, `UnsavedChanges.tsx`, `ConfirmDialog.tsx`, shared styles, and the actual named references **Connections → MCP servers** and **General → Operator profile**. UI baseline source revision was `adf26cc8aa8bc6155768d15d545fdbfbbfe59f0f`; Switchboard baseline was `36a66a4feb3741cc082977b50b579155a861fe72`.

The corrected module uses a flat primary editor and compact supporting inventory. Selecting a bot opens its complete editor directly; a new-bot form is the initial primary state. Bot configuration retains a single coupled Save scope. A chat’s independent responder choice autosaves; failed choices retain the same editor and expose Retry saving. Approvals and pause/resume are distinct immediate operations. All editing remains in primary, and the no-overflow fallback discloses the inventory once.

No Switchboard stylesheet, inline presentation rules, private confirmation or private navigation dialog remains. Minimal shared Burrow-UI additions expose native confirm/navigation/draft registration to imperative contributions, correctly class their real mount wrappers, and expose reusable flat form/group/facts/disclosure variants. No backend file, live bot configuration, release or installed mod was changed in this correction.

## Source and automated evidence

Final tested Switchboard `ui/settings.js` SHA-256:

`65f394ea4ad8fd90985e1a0021e469f99183618858f44fcac3c6b3029d34d944`

- Switchboard `npm test`: **213 passed, 0 failed, 0 skipped**, including **73** rendered-source UI regressions. These FakeDOM tests are not browser/layout acceptance.
- Switchboard `npm run build`: passed; this is Node ES-module syntax checking, not a bundled UI build.
- Burrow-UI full serial run: **1,530 passed, 1 failed, 2 expected failures** across 176 files. The failure is `themeTokens.test.ts`, an undefined `--text-muted` reference in unchanged `src/features/tasks/archive.css:959`. Reproduced on a separate untouched HEAD snapshot; it is not cleared or silently changed by this task.
- The parallel full UI run additionally timed out waiting for an Archive fixture body. The same Archive test passes in the serial full run. No Archive source/test changes were made here.
- Shared imperative host-focused run: **74 tests across 9 files passed**, covering actual overflow markup, dirty/busy/reverted state, Save/Discard/Stay, validation/save failures, category/subsection/App guard paths, native unload, StrictMode and disposed asynchronous work.
- Burrow-UI production build and both repositories’ `git diff --check`: passed. Vite retains its >500 kB bundle warning.

Regression cases include unchanged-poll handler identity, delayed refresh focus retention on both success and failure, untouched-field rebasing (a name-only Save cannot undo a refreshed pause), old-read/new-write ordering, orphan identity, post-guard current names/defaults, scoped null/omitted assignments, unchanged/in-flight duplicate prevention, error-only chat autosave retry and secret draft retention without storage.

## Real production-host browser evidence

Browser evidence was retained in the operator’s private acceptance archive; its deployment-specific filesystem location is intentionally omitted from public documentation.

The final `report.json` and `acceptance-final-65f394-rerun.log` record **29/29 passed** with terminal exit 0, **98 screenshots**, zero browser exceptions/console errors/native dialogs, and eight deliberately injected HTTP 503s matching the expected failures. The actual production Burrow-UI `dist` serves the actual current Switchboard module, not an HTML approximation; source and browser-loaded module hashes match above. The report includes production asset hashes and per-scenario request evidence. Earlier unsuccessful fixture/harness attempts are retained separately and are not final acceptance.

Paired MCP/Switchboard captures cover normal, selected editor, dirty, saving, failed-save, empty and load-error states at **1600×1000**, **1280×900**, **800×900**, and **390×844**. Narrow captures separately scroll the existing shell to the primary and supporting surfaces. Operator profile is an additional normal-state comparison. The parent also inspected screenshots and accessibility trees through granted DevTools at desktop and narrow desktop widths, including the baseline and final module.

Measured comparisons:

- Desktop direct `h2` headings share 14px type, 14px bottom margin, 12px bottom padding and the same 1px divider; no nested primary card.
- Compared fields are 34px high with matching 13px / 18.2px typography.
- Desktop compact inventory rows are 58.6px high with an 8px gap; first row is 17px below the supporting column outer top, matching MCP. No stray top inventory divider/margin remains.
- Actual keyboard Tab reaches the editor input at desktop and 390px; MCP and Switchboard both expose `:focus-visible` with the same 2px magenta outline.
- Supporting inventory contains no input/select/edit form. Existing no-accent inventory treatment is preserved; selected rows expose `aria-pressed`, but MCP and Switchboard do not have a distinct selected background/border in this baseline.

Behavior checks use the **real shared host dialogs**: Stay/Escape/Discard on bot selection, Save before another item and Diagnostics, Discard before General/Archive, Save before Tasks, busy navigation suppression, failed saves staying put with retained secret inputs, modal focus trapping/inert background, and normal application confirmation for destructive actions. Additional scenarios cover chat responder autosave failure/retry/shared guard, invalid guard Save retaining the same controls, pending approval, scoped pause/resume, Discord access versus responder inheritance, token clear, idle discovery, focused manual refresh, and zero agents/empty configuration.

## Known limits and delivery

These APIs are entirely synthetic/in-memory, so this does not validate real Telegram/Discord/MCP services or production credential/persistence behavior. No real token was entered or captured. Transport behavior remains covered separately by existing service tests.

This is **not** a whole-shell responsive redesign. The host already scrolls columns horizontally at phone width. Parent inspection also observed an existing 800px shell-level category/footer overlap in both MCP and Switchboard; matching the baseline does not claim that defect is fixed. The changed module’s own fields wrap and content remains scrollable, but this acceptance does not certify all narrow-shell usability. No theme-colored selection redesign was introduced to mask the baseline limitation.

Both repositories require coordinated source delivery: the mod feature-detects `confirm`, `navigate`, and `setDraft` and displays an honest compatibility message on older hosts. Source is committed/pushed separately from releases or installation. Normal main-branch CI creates assemblies/development releases, so source-only delivery uses the existing `[skip ci]` convention. No deployment, version bump or tag is part of this correction.

