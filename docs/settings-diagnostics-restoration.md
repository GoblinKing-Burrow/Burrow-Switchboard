# Restore current diagnostics to Settings

Base: `faed72ac2c03349fcf564b3b038278d0e3287ff1` (2026.11.04.1).
Compared against the pre-history Archive renderer at `c31e1ddf27b0d453d3f022963471d39b7eea5280`.

The historical Archive correction removed operational diagnostics without replacing them in Settings. Existing bot, admission, server-access and chat-routing mutations were already in Settings and are retained unchanged. The selected bot now exposes a native **Current bot diagnostics** disclosure with Core availability/reason, polling mode/last poll, Discord gateway state, and the bounded live delivery snapshot, including in-flight work, direction, status/error, timestamp and routing IDs. Pending rows regain request timestamps/IDs; chat details regain mapping, goblin and session IDs. Rendering projects explicit metadata and does not enumerate private submission payloads, answers or credentials.

The existing native inventory/editor composition is preserved. Diagnostics are bot-scoped, not a recreation of Archive’s former cross-bot category/search/date interface. The existing inventory selects another bot. Archive remains historical and is unchanged, as are server/storage code and manifest. Disclosure state survives refresh/bot changes. Automatic polls defer while text is selected, in addition to the existing draft/focus/busy guards. No extra mutation endpoints or replay/retry actions were invented.

## Verification

- Syntax build and `git diff --check`: passed.
- All non-Core tests: **283 passed**, no failures or skips, including **84 Settings UI tests**.
- Five new regressions: all pass on the change and all fail on the baseline. Cover both native placements, safe metadata projection, request/mapping metadata, legacy snapshots, missing timestamps, cross-bot isolation, disclosure persistence, stale reads, and text-selection preservation.
- Full `npm test`: **283 passed, 3 failed** because the current sibling Burrow-Backend runtime is absent (`ERR_MODULE_NOT_FOUND`). Core/PostgreSQL integration is not verified.
- Chromium was attempted in cloud scratch but failed before rendering with `socket() failed: Operation not permitted` in `process_singleton_posix.cc`. Actual host layout, long-ID wrapping and wide/narrow/Statistics geometry remain unverified; no browser acceptance is claimed. The change uses existing shared Settings classes and adds no CSS.
- No live provider calls, local-PC access, merge, installation, release or deployment.
