<img src="docs/assets/hero.png" width="720" alt="Burrow Switchboard" />

# Burrow Switchboard

**Telegram and Discord in. Goblins out.**

Burrow Switchboard connects approved external chats to real Burrow agent sessions. Telegram and Discord are implemented text transports; Core executes agent turns for approved routes.

## Implemented scope

- Telegram Bot API long polling and Discord Gateway WebSocket/REST use outbound connections; neither requires an inbound webhook
- Named bot connections have immutable transport (`telegram` or `discord`), scoped admissions, routing, sessions, deliveries and write-only credentials
- One bot configuration combines its credential, assigned goblin, transport status and access
- Approve Telegram groups once per bot (topics inherit access but keep isolated sessions); authorize Discord servers once (channel/thread permissions still apply); DMs retain admission
- Telegram group speech without a known bot target reaches all admitted managed bots; mentions/replies select the addressed goblin(s). Discord guild turns still require a human mention/reply
- Approved group/topic or guild/channel context is durable, bounded and shared across approved bots; bot-authored messages never automatically wake an agent
- Core executes ordinary agent turns with normal SOUL, tools, continuity and session serialization; answers return asynchronously
- Delivery records and duplicate suppression are bounded; ambiguous outbound sends are not blindly resent
- Native Discord `/help`, `/status`, `/stop`, `/new` and `/model`; see [command prerequisites](docs/discord.md#native-slash-commands)
- No attachments, voice or streaming; Telegram has no native command handler

## Setup

1. Install and enable Switchboard with a compatible Core. Create an operator-owned [Telegram bot](docs/setup.md) or [Discord application/bot](docs/discord.md).
2. In **Settings → Switchboard → Bots**, add a named connection, choose its transport, enter its write-only token, assign its goblin and enable transport. Use a separate Discord application per goblin.
3. Telegram: send text to request access, then approve that bot's group or DM on the same Bots page. Topics inherit group access. Discord: approve the observed server once; DM admissions remain separate.
4. Send fresh text: Telegram groups broadcast when no managed bot is addressed, mentions/replies select recipients; Discord guild channels use mentions/replies. Check **Diagnostics** for delivery outcomes.

Telegram group privacy rules still apply. Discord requires the Message Content intent and bot channel/thread permissions; see the [Discord setup and two-bot acceptance checklist](docs/discord.md).

## Development

Requires Node.js 24 and a sibling current `Burrow-Backend` checkout for the Core contract test.

```sh
npm run build
npm test
```

Switchboard is distributed under the [Burrow Sustainable Use License](LICENSE).

## Documentation

Start with the [Switchboard guide](docs/index.md) for operator setup, admission and routing, Settings, delivery troubleshooting, architecture, the mod-local API and development checks. These pages describe the implemented Telegram and Discord text transports and their distinct delivery boundaries.
