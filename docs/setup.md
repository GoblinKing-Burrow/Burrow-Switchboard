# Set up Telegram

For Discord applications, intents, permissions and two-bot/thread acceptance, see [Set up Discord](discord.md). This page covers Telegram-specific BotFather, privacy and polling.

## Before you start

You need an operator-controlled Telegram bot token, Switchboard installed and enabled in Burrow, and at least one enabled Burrow agent. Core must expose `context.agents.turns.submit` and `context.agents.turns.read`; Switchboard reports their availability in Settings. Its Node.js package declares **Node 24 or newer**.

Keep the token secret. Do not paste it into chat, screenshots, logs, shell commands, documentation, or a support report. Switchboard stores it through the host secret store and exposes only whether a token is configured. The UI cannot reveal it later.

## First direct-chat route

1. Create the bot through BotFather, install Switchboard, and open **Settings → Switchboard → Bots**.
2. Add/select the Telegram connection, enter its write-only token, assign its goblin and enable polling.
3. Check the connection's bot identity and transport status. **Diagnostics** contains detailed delivery state; revisit for a fresh snapshot.
4. Send nonempty text in a private chat. Under the same bot's pending access on **Bots**, approve using its assigned goblin (or choose an explicit room override).
5. Send a fresh message; the admission message is not replayed. Verify the reply and delivery state.

## Groups and forum topics

Telegram must deliver updates, then Switchboard routes them through approved access. For ordinary group conversation **every participating bot must receive ordinary messages**, using disabled privacy or appropriate administrator status.

1. On **Bots**, configure each Telegram bot and its assigned goblin.
2. Add each bot to the group; allow sending text. BotFather's `/setjoingroups` controls whether the bot can join groups.
3. Configure Telegram delivery as below. Send text in the group or a topic to create a pending **root-group** request for each bot that receives it. A targeted `/start@YourBotUsername` may also request access; Switchboard does not implement a special Telegram activation command.
4. Approve the group once for each participating bot on **Bots**. Topics inherit group access; no topic-by-topic approval is needed. Existing explicit topic overrides remain authoritative.
5. Send fresh ordinary human text: every admitted managed bot that receives the update can answer. Mention a connected bot to address only it, or reply to its message. Mentioning multiple managed bots selects them; explicit mentions override reply targeting. Human/unknown-bot mentions do not select a recipient.
6. Check **Diagnostics**. Root and topics retain separate sessions/history despite shared group authorization. Messages from bot accounts are passive context, not wakeups; Telegram `sender_chat` messages represent a speaking chat and are handled separately (see [routing](routing.md)).

Private chats remain separately admitted. Approval covers the route's participants, not only the requester. Telegram delivery settings do not bypass Switchboard access, and Switchboard cannot recover updates Telegram did not deliver.

### Privacy mode and administrator rights

Privacy mode is normally on. It delivers targeted commands and relevant replies, not unrestricted group conversation. A plain username mention is not listed as a guaranteed ordinary-bot privacy-mode trigger. Telegram admins receive broader updates; ordinary members can instead have privacy disabled. **Admin is not universally required.** [Telegram delivery rules](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

To change privacy, the bot owner opens **@BotFather**, sends `/setprivacy`, selects the bot and chooses **Disable**. Remove and re-add the bot to the existing group for the change to apply. This exposes more group messages to the bot; use it only with the group's agreement. Alternatively, an authorized group administrator may promote the bot, granting only appropriate rights. Do not grant deletion, banning or other moderation powers merely to troubleshoot chat delivery. [Telegram privacy mode](https://core.telegram.org/bots/features#privacy-mode).

These are Telegram-side choices for the operator, not settings Switchboard changes automatically. A healthy poller does not prove Telegram delivered a particular group message. Privacy-on targeted commands may create admission successfully while the later ordinary mention still never arrives.

### Does everyone need to start each bot privately?

Starting a private conversation with each bot is useful for a direct-message test, but is **not a general prerequisite for group membership**: Telegram allows a user to add a bot to a group or initiate a private conversation. Private Start does not approve the group, select its agent, change privacy or grant admin rights. Private chats have separate Switchboard admissions. [Telegram bot introduction](https://core.telegram.org/bots#how-are-bots-different-from-users).

### Commands, mentions and replies

Recipient selection recognizes Telegram `mention`, `text_mention` and addressed `bot_command` entities for connected bots. A reply targets a known connected bot only when no explicit bot target is present. Caption entities follow the same rules. A matching username mention is stripped from the selected bot's display text; empty remaining text is ignored for text-only messages, while an image without a caption remains a turn. Telegram commands are routed as text, not executed as Switchboard configuration operations. Native slash-command controls currently exist on Discord only.

With privacy enabled, Telegram may deliver a group message to only one bot, and reply delivery may take precedence over an addressed command. Configure broad delivery for each participating bot before testing broadcast semantics. See [Telegram delivery rules](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

### Messages from other bots

Switchboard bridges its own confirmed bot replies into shared group/topic context, without waking a peer agent. Test connectivity using a human account. This release does not change Telegram's bot-to-bot delivery behavior.

Telegram group instructions were rechecked **2026-10-25** against official documentation and Switchboard `d1388ca8c65e250411034de7560de59d3ffdc875` (**2026.10.24.3**). This checks documented delivery rules and source behavior, not live credentials or end-to-end delivery.

## Safe first test

Use an agent with limited capabilities and a harmless prompt such as “Reply with a short greeting.” Verify the chosen agent, chat and topic before testing anything that could change files or external state. For repository test prerequisites and network-safety qualifications, see [development](development.md).

## Pause or remove the token

Uncheck polling and save to pause ingestion **and reply reconciliation** while retaining the token and records. To remove the stored token, use **Clear configured token** and confirm. Clearing also disables polling, but does not delete mappings or delivery state. Neither action is a documented cancellation of Core turns already submitted.

## Add more bots

Repeat **Bots → Add bot connection** for each BotFather bot. Each has its own credential, poll cursor, admissions, mappings, delivery records and Core sessions. Select the intended bot before approving its pending chat. The same Telegram chat/topic can route independently through different bots with distinct Core sessions and idempotency keys, while approved group/topic connections share bounded room context. Removing or pausing one connection does not stop the others.

