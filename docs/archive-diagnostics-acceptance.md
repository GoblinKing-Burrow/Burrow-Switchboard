# Switchboard Diagnostics → Archive — 2026-11-01

## Original request, in order

1. “OK Switchboard, Diagnostics that seems like something that should be in Archive and not Settings 👀 Would you agree?”
2. After discussing configuration/compact current status in Settings and full diagnostics in Archive: “Yeah pretty much so lets do that please. Following the already established design in Archive.”

Scope: navigation correction using the existing Archive design, not a settings redesign or new diagnostics backend.

## Candidate and behavior

Base: `5d272844b0b35b1e8dcb2394fbbbe1d829c46c34`.

- Manifest registers `ui.archive`; Settings contributes only Bots.
- Archive → Mods → Switchboard uses the existing Archive bot list/detail-reader classes and host contribution mechanism.
- Bot configuration, credentials, responder/access controls, save/navigation guards and compact current status remain in Settings → Switchboard → Bots.
- Existing `/configuration` supplies transport/activity, bot identity, Core availability, mappings, admissions and recent deliveries. Existing server-provided agent names are used with ID fallback.
- Manual Refresh and visible idle 10-second polling retain selection by ID, defer interfering updates, prevent overlapping reads and clean up on unmount. Focus on a bot selector does not permanently suspend polling. Refresh failures retain loaded data; initial failure explicitly reports unknown/unavailable rather than verified empty.
- This remains a current bounded snapshot, independent of Archive’s global date filter. No retention/history expansion, replay, provider behavior, credentials, stored bot state or server changes.

Frozen source SHA-256:

- `ui/archive.js`: `5d59a6009c21f8d2de6652fe6fc154b78bbe24e7448639219ea86d0bf2efce7b`
- `ui/settings.js`: `fe199b2d916aeb7320a98e512055881e1bdfb09050fc5a13d0f68f4f0bd98e8e`

## Automated verification

Hatchet independently ran the final build and complete suite: **220 passed, 0 failed, 0 skipped**, including current-Core discovery/hosting and a disposable PostgreSQL/Core image roundtrip with controlled providers. `npm run build` is syntax checking, not bundling or a live provider test. `git diff --check` passed.

Unchanged Burrow-UI Archive host/discovery regressions: **7/7** across `ModArchiveHost.test.tsx`, `ArchiveMods.test.tsx` and `modArchives.test.ts` passed. No Core or Burrow-UI source changes were required.

## Independent review

Fresh **GPT-6-Luna**, `subagent-1793565615356-62ae8f2b`, reviewed the full candidate including the new untracked Archive module and documentation. **Functional Pass; operator scope/behavior Pass; no blockers.** Reviewer independently reran build, UI **80/80**, complete suite **220/220**, and whitespace check on the exact hashes above. No review edits or mutations.

Reviewer could not reopen parent screenshot attachments (`attachment_not_found`), so its source/scope verdict is **not independent pixel-level visual acceptance**. Hatchet’s direct inspection below is separate evidence. Earlier review findings about refresh, real HTMLCollection behavior, interaction gating and initial-error messaging were corrected before this final review. Falling back when a selected bot disappears matches the previous connection-selection behavior; no persistent deleted-bot feature was added.

## Direct browser acceptance

Hatchet directly inspected **1920×1200** browser screenshots of the historical Diagnostics module, candidate Archive normal/Discord-error/empty states and retained Settings editor/status using identical synthetic data and actual host styles. The final integration fixture mounted the **actual Archive component and actual ModArchiveHost**, including its MODS navigation/sidebar, rather than recreating their layout. Requests were synthetic and writes blocked; this was not an installed-mod or live-provider test.

The final Archive module was verified byte-for-byte against its fixture HTTP response. A stale temporary copy was detected and refreshed before accepting the final initial-error rendering. Final error screenshot at **20:43:00 UTC** correctly shows “Bots unknown” and “Diagnostics unavailable. Refresh to try again.” Earlier pre-correction error captures are not final acceptance evidence.

Direct comparison captures: baseline **20:34:16 UTC**; actual Archive normal **20:30:13**; Discord failure **20:33:39**; empty **20:34:49**; retained Settings **20:37:52**; final corrected initial error **20:43:00**. Browser Refresh and bot selection were exercised. Temporary raw screenshots/harnesses and test logs are retained separately, not bundled as application files.

Additional actual-host headless measurements at **1280×900**, with 60 synthetic bots and 40 deliveries per bot, confirmed the final delivery and last bot were reachable through the existing host scroll surface. No private stylesheet or shared-layout changes were introduced.

**Visual acceptance: Pass for the inspected synthetic states.** No live bot configuration, provider delivery, installation, restart, deployment or paid generation was performed. The old `settings-acceptance.md` remains a dated historical receipt, not acceptance of this Archive move. Normal automated mod release assigns the next UTC calendar version; source is not proof that the operator has installed the update.
