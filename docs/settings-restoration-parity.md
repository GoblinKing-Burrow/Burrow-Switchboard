# Four-workspace Settings restoration

> Historical implementation/acceptance record. This records the source and checks at the time, not a fresh verification or the current Settings layout. For the current Configuration, Pending admissions, and Chat mappings workspaces, use [Settings](settings.md). The former Core status panel is not part of the current UI.

## Audited source

- Original four-section source: Switchboard `366b2dd` (also confirmed at `a74a6564d8fa6a892bd0899856f6f256e58d4b2c`).
- Oct 24 `e6f16e9`: consolidated Status/Configuration/Pending admissions/Chat mappings into Bots and Diagnostics.
- Nov 1 `3c3268b`: moved Diagnostics to Archive, leaving Bots.
- Restoration baseline: Switchboard `30287a558882810f245646525d52e4b5e893585f`.
- Actual native contract/source: Burrow-UI `4f7f58f682a0cffe83290276307c66631a361de3`, including SettingsPage, ModSettingsHost, AgentDetails, AgentSettings, normalizedWorkspace.css, settingsSizing.css and settings.css.

## Parity inventory

| Original workspace | Restored content/workflow | Newer behavior retained |
| --- | --- | --- |
| Status | Separate live workspace; transport/raw health/activity and timestamp, bot username/display-name/configured fallback and numeric ID, Core availability/reason, delivery direction/status/error/date including updatedAt fallback, mapping/pending counts and empty states | Current bounded live snapshot, record/chat/goblin/session/topic IDs, safe idle polling, active text-selection retention; Archive stays separate historical outcomes |
| Configuration | Separate bot create/update scope with immutable transport, name, enable/receive flag, write-only token, blank token preservation, clear and removal | Coupled bot default responder save, validation, transient token drafts, native confirmation and Save/Discard/Stay, unavailable defaults and disabled tokenless editing |
| Pending admissions | Dedicated queue with explicit empty state, chat type/IDs/request time, responder selection and approve/dismiss | Bot-default inheritance, scoped and confirmed actions, pending Discord server admission with enabled-default gate |
| Chat mappings | Dedicated approved chat/topic/channel/thread list and responder editor, pause/resume and scoped removal; IDs visible | Independent responder autosave/retry and immediate Pause/Resume rather than the original coupled responder/Enabled Save; Discord server allow/pause/revoke and generated-versus-explicit inheritance safeguards |

Restoration is not a source revert. No transport/backend/authentication behavior is changed. Existing API mutation boundaries remain. All four sections are declared in both the imperative module and manifest. The native shared bot selector replaces the extra private inventory rail, maintaining the selected bot across sections. Current host form allocation keeps configuration compact without a private width cap. Save/Cancel use native content-sized, wrapping end-aligned action classes, not space-between or the legacy model-actions grid.

## Validation status

Candidate verification: 289/289 non-Core tests pass, including 90/90 Settings UI tests; syntax build and whitespace checks pass. Full npm test was attempted: 289 passed and three Core integration checks failed because the sibling Burrow-Backend source/runtime is unavailable. Those Core checks remain PENDING, not passed. Native section ownership, selector payloads, all five required host APIs, per-section controls, guard transitions, races, disposal, multiple requests, 17 bots, aliases and Status data fallbacks are covered by source-level DOM tests. Source and FakeDOM tests cannot establish rendered geometry. A fresh Chromium launch was attempted in this cloud environment and failed before rendering with `socket() failed: Operation not permitted`; no escalation or workaround was used. Thus current-host screenshots, computed geometry, Statistics-open/closed visual comparisons and responsive pixel acceptance remain PENDING. No older screenshot is treated as acceptance of this candidate.

No merge, deployment, release, version bump, live provider call or credential entry is authorized by this restoration.
