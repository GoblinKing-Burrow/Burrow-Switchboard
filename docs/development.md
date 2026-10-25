# Development and verification

## Baseline and scope

Full source review **2026-10-25**: version **2026.10.24.3**, commit `d1388ca8c65e250411034de7560de59d3ffdc875`. All operator and developer pages were reconciled with runtime, UI, manifest, test source and release workflow. This pass did not execute application tests or contact live bot/model providers.

Historical Telegram-only documentation baseline: version **2026.10.22.1**, commit `b12d6cb2d9aae46542c55b4da12f605ee8009b34`, reviewed **2026-10-22**. This is archival history, not the current scope or live verification. Compare installed source behavior and host capabilities, not dates alone.

The current implementation covers Telegram and Discord text messages plus native Discord slash commands. Telegram broadcast/targeting, group-root access and Discord server inheritance are covered by dedicated routing/access suites. Attachments, voice, streaming, durable user-level denial, manual replay and other transports are not delivered features. Do not infer them from the product name or adapter-oriented design.

## Telegram groups and privacy mode

Each bot connection needs its own approved group-root or DM mapping; topics inherit group access. Two bots may share
one Telegram group; their mappings, cursors, sessions and deliveries remain isolated.

Telegram privacy mode is enabled by default. For an ordinary group member in that
mode, a text `@mention` is not sufficient to make Telegram deliver the message to
the bot. Use an explicitly addressed command such as `/start@ActualBotUsername`
(no space) to initiate admission. A plain `/start` is not a broadcast to every bot.
Telegram also delivers replies according to its privacy-mode routing rules.

For mention-based interaction, either make each bot a group administrator, or
disable privacy for each bot with BotFather `/setprivacy` and remove/re-add it to
the group so that change takes effect. Switchboard selects known registered bots from mention/text-mention or addressed-command entities; absent an explicit known target, a reply to a known bot selects it. With no known target, approved bots receiving the update may all respond. Broad delivery therefore permits broadcast turns, not just passive context. Telegram commands are ordinary agent input, not native Switchboard configuration commands.
Switchboard bridges its own confirmed
bot replies through shared group/topic context without waking a peer agent. See the [Telegram Bots FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

Deleting a chat mapping removes only the selected connection's route and matching
pending admission. Other connections and Telegram group membership are untouched.
Unsent replies for that route are marked interrupted and will not be sent after
re-admission or restart; completed history is retained. A send already in progress
can finish before deletion is processed. Future messages need admission again only when no parent grant applies. Removing a Telegram topic override exposes any still-approved root mapping; deleting the root leaves explicit topic overrides intact. Discord server inheritance is separate from individual routes: pause/revoke the server to stop inherited access, and manage explicit room grants separately. The scoped endpoint is `DELETE /connections/:connectionId/mappings/:id`;
`DELETE /mappings/:id` targets the legacy default connection.

## Local checks

Use Node.js 24 or newer in the Switchboard repository:

```bash
npm run build
node --test test/server.test.mjs test/telegram-group-routing.test.mjs test/discord.test.mjs test/discord-server-access.test.mjs test/room-history.test.mjs test/ui.test.mjs
```

`build` is syntax checking for the server modules and Settings UI, not bundling or a live provider test. Service tests inject controlled fetch implementations, including activation; the Core smoke test configures a disabled connection without a token. Automated tests require no live Telegram/Discord credentials or provider calls.

The Core contract test needs a current compatible Burrow-Backend checkout. By default it looks for the sibling checkout; set the explicit path when layouts differ:

```bash
# Install Backend dependencies in its own checkout first.
(cd ../Burrow-Backend && npm ci --no-audit --no-fund)
BURROW_CORE_ROOT="$(cd ../Burrow-Backend && pwd)" npm run test:core
```

`npm test` runs all test files, including that Core contract. A missing Core checkout/dependencies is not a reason to silently omit this prerequisite when reporting a full test pass.

## Test responsibilities

- `test/server.test.mjs`: admission/routing, token and API behavior, polling/reconciliation, send ambiguity and service lifecycle using controlled dependencies.
- `test/telegram-group-routing.test.mjs`: group-root/topic inheritance, broadcast and explicit recipient selection.
- `test/discord-server-access.test.mjs`: observed-server authorization, inherited routes, assignment and revocation.
- `test/discord.test.mjs`: Discord identity, Gateway/REST, admissions and mapping, shared bounded context, duplicate and ambiguous-send handling using controlled dependencies (not live Discord).
- `test/room-history.test.mjs`: concurrent deduplication, room order, UTF-8 byte limits and Unicode-safe text truncation. Server tests additionally cover two-bot shared context/restart, private/topic/admission isolation, quoted replies, partial sends and exact-input replay.
- `test/ui.test.mjs`: Settings rendering/actions, token preservation/replacement/clear, admission, mapping changes, retry and disposal through a fake DOM.
- `test/core-contract.test.mjs`: real Core discovery/host smoke coverage for manifest/settings registration, bootstrap and disabled-token configuration. External-turn capabilities are mocked; this is not a real model execution or full Telegram-to-agent roundtrip.

Fake-DOM tests do not replace browser layout/accessibility checks. Passing the contract test does not establish live Telegram or Discord credentials, network reachability or production delivery. With explicit operator authorization, test live integration separately with an operator-owned bot and a harmless limited-capability agent, without recording its secret.

## Release workflow

The repository workflow runs on main pushes and manual dispatch. It checks syntax, Telegram/Discord/server/UI tests and the Core contract against a current Backend checkout, then assigns a UTC calendar version, commits changed version files, tags and creates a development release. Repeated same-day tags receive a numeric suffix.

A documentation push can therefore trigger the normal release workflow. Do not manually bump package or manifest versions merely to edit documentation. No changes to runtime, promotion or synchronization policy are required for these pages.

## Source map

| Source | Documentation responsibility |
| --- | --- |
| `burrow.mod.json` | Mod identity, version and two Settings registrations (Bots and Diagnostics) |
| `package.json` | Node requirement and check commands |
| `server/index.mjs` | Activation/cleanup, routes, operator-auth gate, response/error policy |
| `server/connections.mjs` | Multi-bot registry, scoped stores, migration and connection lifecycle |
| `server/telegram.mjs` | Telegram calls, admission, mapping keys, polling offsets, Core turns, delivery states, bounded persistence |
| `server/discord.mjs` | Discord Gateway/REST, channel/thread admission, delivery reconciliation and guild-channel context |
| `ui/settings.js` | Actual operator controls, confirmation, snapshot loading, error presentation and disposal |
| `test/server.test.mjs` | Server/service regression coverage |
| `test/discord.test.mjs` | Discord transport and room-context regression coverage |
| `test/ui.test.mjs` | Fake-DOM Settings regression coverage |
| `test/core-contract.test.mjs` | Real-Core integration contract |
| `.github/workflows/release.yml` | CI and automatic development release behavior |
| `scripts/set-release-version.mjs` | Calendar version synchronization/check |

The hero in `docs/assets/hero.png` is the user-selected joint-effort Snickerdink image, preserved unchanged (1536 × 1024 PNG; SHA-256 `d5dc56f2ae2a2de646e16751f5e8eda21a5603bf88e3ea317ecd7de6aba1b49f`). It is not generated or reworked by this documentation pass.

## Publication history

The earlier pre-publication reconciliation at `056f0749542e92cfe6b2346b6ef7c6f268b5e4e7` (version **2026.10.22.2**) concerned the Telegram-only baseline and hero image. It does not describe the subsequent Discord implementation. This documentation update does not claim a live provider test or alter runtime/release policy.

