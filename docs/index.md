# Burrow Switchboard

![Snickerdink at the Burrow Switchboard, with the purple speaker O and “Connecting chaos. Please hold.” tagline.](assets/hero.png)

**Telegram and Discord in. Goblins out.** Switchboard connects approved Telegram chats/topics and Discord DMs/channels/threads to real Burrow agent sessions. The operator chooses an agent; Core executes the turn; Switchboard returns the completed answer on the same transport.

## Current implementation

Telegram supports text and inbound photos or PNG/JPEG/GIF/WebP image documents; Discord supports text. Image turns require a compatible Core and image-capable model. Telegram uses outbound long polling; Discord uses an outbound Gateway WebSocket and REST. Neither uses an inbound webhook or requires a public reverse-proxy route. Telegram groups are approved once per bot with isolated topic sessions; Discord servers are authorized once with isolated channel/thread sessions. DMs retain admission. Telegram group speech broadcasts unless a known bot is addressed; Discord guild messages still require a human mention/reply. Bots are configured together with credentials, assigned goblin and access on **Bots**; health detail is under **Diagnostics**.

| Implemented | Not implemented here |
| --- | --- |
| Operator-managed Telegram polling and Discord Gateway/REST, named bot connections | Other providers or inbound webhooks |
| Per-bot group/server authorization, inherited topic/channel/thread access and explicit room mappings | Unapproved group/server access, user-level allowlists, permanent deny list |
| Core external-agent-turn submission and reconciliation | A separate model runner, tool system or Tutor capability |
| Inbound Telegram images up to 20 MiB; text answers split to provider limits; native Discord slash controls | Discord attachments, outbound images, voice, streaming replies |
| Durable bounded room context and delivery records | Unlimited audit history, manual replay or retry |

An approved group/topic or guild channel/thread is a shared route: approval is **not** a separate approval of each participant. Choose an agent whose capabilities are appropriate for everyone who can address the bot there. External messages enter the real agent pipeline; approval is not a guarantee that the message is safe or authorized for every tool action.

## Read next

- [Set up Telegram](setup.md)
- [Set up Discord and check two-bot context](discord.md)
- [Admission and routing](routing.md)
- [Settings reference](settings.md)
- [Operations and troubleshooting](operations.md)
- [Architecture and Core contract](architecture.md)
- [Mod-local API](api.md)
- [Development, verification and source map](development.md)

## Documentation history

Current full review: **2026-10-25**, source **2026.10.24.3**, commit `d1388ca8c65e250411034de7560de59d3ffdc875`. This is a source/UI contract review, not a live provider test.

The original Telegram-only documentation baseline was source version **2026.10.22.1** (commit `b12d6cb2d9aae46542c55b4da12f605ee8009b34`), inspected **2026-10-22**. This is archival provenance, **not** the current feature list or evidence of live Discord delivery. Verify installed manifest/Core compatibility rather than inferring it from a package date.

