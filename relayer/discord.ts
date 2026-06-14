// relayer/discord.ts
//
// Discord bot for AccountabiliBuddy.
//
// Env vars:
//   DISCORD_BOT_TOKEN        Bot token from Discord Developer Portal
//   DISCORD_APPLICATION_ID   Application/client ID (for command registration)
//   WEB_BASE_URL             Public URL of the web app (for links in embeds)
//
// Commands:
//   /setup         — first-time account linking or creation
//   /profile       — show your linked account + betting record
//   /bet personal  — create a peer accountability bet in this channel
//   /bet sports    — bet on a live sports game (auto-settled by the score feed)
//   /bet list      — list active bets you're involved in
//   /bet status    — show the card for a specific bet
//
// Account linking happens in the web app: /setup hands the user a one-time,
// signed link code embedded in a URL button. They sign in (or sign up) on the
// web app, which calls POST /discord/link to attach their Discord id, then
// offers a button back to the channel. No credentials are ever typed into
// Discord.
//
// Buttons (encoded in customId):
//   accept:<betId>              — accept a pending bet
//   vote_challenger:<betId>     — vote that challenger won
//   vote_acceptor:<betId>       — vote that acceptor won
//
// Modals:
//   modal_bet_create            — terms + stake + opponent discord username

import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type Interaction,
  Colors,
} from "discord.js";
import crypto from "crypto";
import {
  users,
  bets,
  discordConversations,
  type UserDoc,
  type BetDoc,
  type DiscordConversationDoc,
} from "./db";

const WEB_BASE_URL = (process.env.WEB_BASE_URL ?? "https://accountabilibuddy.app").replace(/\/$/, "");

// Base URL for the relayer's own HTTP API. Sports bets reuse the same on-chain
// escrow + auto-settlement that the web app and iMessage extension drive, so the
// bot calls those endpoints internally rather than re-implementing them.
const RELAYER_INTERNAL_URL = (
  process.env.RELAYER_INTERNAL_URL ?? `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "8787"}`
).replace(/\/$/, "");

type SportKey = "soccer" | "nba" | "nfl" | "nhl";

const SPORT_LABELS: Record<SportKey, string> = {
  soccer: "Soccer",
  nba: "NBA",
  nfl: "NFL",
  nhl: "NHL",
};

interface ScoreboardGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  isFinal: boolean;
  startTime?: string;
  startTimeMs?: number;
}

// ── slash command definitions ─────────────────────────────────────────────────

export const discordCommands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Link your BAAM account to Discord"),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show your BAAM account and betting record"),

  new SlashCommandBuilder()
    .setName("bet")
    .setDescription("BAAM bet commands")
    .addSubcommand((sub) =>
      sub.setName("personal").setDescription("Create a peer accountability bet in this channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("sports")
        .setDescription("Bet on a live sports game, auto-settled by the score feed")
        .addStringOption((opt) =>
          opt
            .setName("sport")
            .setDescription("Which sport to browse upcoming games for")
            .setRequired(true)
            .addChoices(
              { name: "NBA", value: "nba" },
              { name: "NFL", value: "nfl" },
              { name: "NHL", value: "nhl" },
              { name: "Soccer", value: "soccer" },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName("league")
            .setDescription("Soccer only: epl, laliga, mls, worldcup, or a numeric league id")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List your active bets in this channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show a specific bet card")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Bet ID").setRequired(true),
        ),
    ),
].map((cmd) => cmd.toJSON());

// ── one-time command registration ─────────────────────────────────────────────

export async function registerDiscordCommands(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!token || !appId) {
    console.warn("DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID not set; skipping command registration");
    return;
  }
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(appId), { body: discordCommands });
  console.log("Discord slash commands registered");
}

// ── bot startup ───────────────────────────────────────────────────────────────

// Running client reference so non-interaction code (e.g. the web link flow
// completing via POST /discord/link) can post messages into channels.
let botClient: Client | null = null;

export async function startDiscordBot(): Promise<Client | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN not set; Discord bot will not start");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord bot ready: ${c.user.tag}`);
    void registerDiscordCommands();
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  await client.login(token);
  botClient = client;
  return client;
}

// Posts a confirmation into the channel where /setup was started once the user
// finishes linking on the web app. Best-effort: never throws.
export async function announceDiscordLink(
  payload: DiscordLinkCodePayload,
  username: string,
): Promise<void> {
  if (!botClient || !payload.channelId) return;
  try {
    const channel = await botClient.channels.fetch(payload.channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ Account linked")
      .setDescription(
        `<@${payload.discordId}> linked **@${username}** to BAAM.\n\n` +
        "Use `/bet personal` to post a bet, `/bet sports` to bet on a game, or `/profile` to view your record.",
      );
    await channel.send({ content: `<@${payload.discordId}>`, embeds: [embed] });
  } catch (err) {
    console.warn("Failed to announce Discord link:", err instanceof Error ? err.message : err);
  }
}

// ── top-level interaction router ──────────────────────────────────────────────

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (err) {
    console.error("Discord interaction error:", err);
    const msg = { content: "Something went wrong. Please try again.", ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(msg).catch(() => undefined);
      } else {
        await interaction.reply(msg).catch(() => undefined);
      }
    }
  }
}

// ── /setup command ────────────────────────────────────────────────────────────

async function handleSetupCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const col = await users();
  if (!col) {
    await interaction.reply({ content: "Database not available. Please try again later.", ephemeral: true });
    return;
  }

  const existing = await col.findOne({ discordId: interaction.user.id });
  if (existing) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("Already linked")
          .setDescription(`Your Discord account is linked to **${existing.username}**.`)
          .setFooter({ text: "Use /bet personal or /bet sports to get started!" }),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle("Welcome to BAAM")
        .setDescription(
          "Put your SOL on the line. Make bets with friends and let the blockchain hold everyone accountable.\n\n" +
          "Click below to open BAAM, sign in (or create an account), and your Discord will be linked automatically. Then come back and use `/bet personal` or `/bet sports`.",
        ),
    ],
    components: [buildLinkButtonRow(interaction)],
    ephemeral: true,
  });
}

// Builds the URL button that sends the user to the web app with a signed,
// short-lived link code. The web app completes the link via POST /discord/link.
function buildLinkButtonRow(
  interaction: ChatInputCommandInteraction,
): ActionRowBuilder<ButtonBuilder> {
  const code = signDiscordLinkCode({
    discordId: interaction.user.id,
    discordUsername: interaction.user.username,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });
  const url = `${WEB_BASE_URL}/?discord_link=${encodeURIComponent(code)}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Link with BAAM")
      .setStyle(ButtonStyle.Link)
      .setURL(url),
  );
}

// ── /bet subcommands ──────────────────────────────────────────────────────────

async function handleBetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "personal") {
    const user = await requireLinkedUser(interaction);
    if (!user) return;
    if (!interaction.guild) {
      await interaction.reply({
        content: "Personal bets can only be created in a server channel.",
        ephemeral: true,
      });
      return;
    }

    const usersCol = await users();
    if (!usersCol) {
      await interaction.reply({ content: "Database not available.", ephemeral: true });
      return;
    }

    const linkedUsers = await usersCol
      .find(
        { discordId: { $exists: true } },
        { projection: { _id: 0, id: 1, username: 1, discordId: 1 } },
      )
      .toArray();

    const candidates = linkedUsers
      .filter((candidate) => candidate.id !== user.id && typeof candidate.discordId === "string");

    const memberChecks = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const member = await interaction.guild!.members.fetch(candidate.discordId as string);
          return {
            value: candidate.discordId as string,
            label: truncate(member.displayName, 100),
            description: truncate(`@${candidate.username}`, 100),
          };
        } catch {
          return null;
        }
      }),
    );

    const opponentOptions = memberChecks
      .filter((entry): entry is { value: string; label: string; description: string } => Boolean(entry))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 24);

    const select = new StringSelectMenuBuilder()
      .setCustomId("personal_opponent_pick")
      .setPlaceholder("Choose who to challenge")
      .addOptions([
        {
          label: "Anyone",
          description: "Leave open for any linked member in this server",
          value: "anyone",
        },
        ...opponentOptions,
      ]);

    await interaction.reply({
      content: "Choose a specific challenger target, or pick **Anyone**:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
    return;
  }

  if (sub === "sports") {
    await handleBetSportsCommand(interaction);
    return;
  }

  if (sub === "list") {
    const user = await requireLinkedUser(interaction);
    if (!user) return;

    await interaction.deferReply({ ephemeral: true });

    const conv = await getOrCreateDiscordConversation(interaction.channelId, interaction.guildId, user);
    const betsCol = await bets();
    if (!betsCol) {
      await interaction.editReply("Database not available.");
      return;
    }

    const channelBets = await betsCol
      .find({ discordConversationId: conv.id })
      .sort({ _id: -1 })
      .limit(10)
      .toArray();

    if (!channelBets.length) {
      await interaction.editReply("No bets in this channel yet. Use `/bet personal` or `/bet sports` to start one!");
      return;
    }

    const embeds = channelBets.map((b) => buildBetEmbed(b, user.username));
    await interaction.editReply({ embeds: embeds.slice(0, 10) });
    return;
  }

  if (sub === "status") {
    const betId = interaction.options.getString("id", true).trim();
    await interaction.deferReply({ ephemeral: false });

    const betsCol = await bets();
    if (!betsCol) {
      await interaction.editReply("Database not available.");
      return;
    }

    const bet = await betsCol.findOne({ id: betId });
    if (!bet) {
      await interaction.editReply(`Bet \`${betId}\` not found.`);
      return;
    }

    const viewerName = interaction.user.username;
    const embed = buildBetEmbed(bet, viewerName);
    const rows = buildBetActionRows(bet, viewerName);
    await interaction.editReply({ embeds: [embed], components: rows });
    return;
  }
}

// ── /bet sports ───────────────────────────────────────────────────────────────
// Sports bets are escrowed on-chain at post time and settled automatically from
// the live score feed (no witness vote). The bot reuses the relayer's own
// /scoreboard and POST /bets endpoints so the on-chain logic lives in one place.

async function handleBetSportsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = await requireLinkedUser(interaction);
  if (!user) return;

  if (!interaction.channelId || !interaction.guildId) {
    await interaction.reply({ content: "Sports bets can only be created in a server channel.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const sport = (interaction.options.getString("sport", true) as SportKey);
  const league = interaction.options.getString("league")?.trim();

  const query = new URLSearchParams({ sport });
  if (league) query.set("league", league);
  const { ok, data } = await relayerCall("GET", `/scoreboard?${query.toString()}`, null);
  if (!ok || !data) {
    await interaction.editReply("Couldn't load the upcoming games right now. Please try again in a moment.");
    return;
  }

  const games: ScoreboardGame[] = Array.isArray(data.games) ? data.games : [];
  if (!games.length) {
    await interaction.editReply(
      `No ${SPORT_LABELS[sport]} games are open for betting right now.\n` +
      "Games become available within 24 hours of kickoff — check back closer to game time.",
    );
    return;
  }

  // Two options per game (back home / back away). Discord caps a select at 25
  // options, so we expose up to 12 upcoming games.
  const select = new StringSelectMenuBuilder()
    .setCustomId(`sports_pick:${sport}`)
    .setPlaceholder("Pick a game and the side you're backing")
    .addOptions(
      games.slice(0, 12).flatMap((game) => {
        const when = game.startTimeMs
          ? new Date(game.startTimeMs).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
          : game.status;
        return [
          {
            label: truncate(`Back ${game.homeTeam}`, 100),
            description: truncate(`vs ${game.awayTeam} · ${when}`, 100),
            value: `${game.gameId}:home`,
          },
          {
            label: truncate(`Back ${game.awayTeam}`, 100),
            description: truncate(`vs ${game.homeTeam} · ${when}`, 100),
            value: `${game.gameId}:away`,
          },
        ];
      }),
    );

  await interaction.editReply({
    content: `**${SPORT_LABELS[sport]}** — choose the game and the team you want to back:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

// Game + side selected → choose opponent (or Anyone) from linked server members.
async function handleSportsGameSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const sport = interaction.customId.slice("sports_pick:".length);
  const [gameId, side] = (interaction.values[0] ?? "").split(":");
  if (!gameId || (side !== "home" && side !== "away")) {
    await interaction.reply({ content: "That selection wasn't valid. Try `/bet sports` again.", ephemeral: true });
    return;
  }
  if (!interaction.guild) {
    await interaction.reply({ content: "Sports bets can only be created in a server channel.", ephemeral: true });
    return;
  }

  const usersCol = await users();
  if (!usersCol) {
    await interaction.reply({ content: "Database not available.", ephemeral: true });
    return;
  }

  const linkedUsers = await usersCol
    .find(
      { discordId: { $exists: true } },
      { projection: { _id: 0, id: 1, username: 1, discordId: 1 } },
    )
    .toArray();

  const requester = await usersCol.findOne({ discordId: interaction.user.id }, { projection: { _id: 0, id: 1 } });
  const requesterId = requester?.id;
  const candidates = linkedUsers
    .filter((candidate) => candidate.id !== requesterId && typeof candidate.discordId === "string");

  const memberChecks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const member = await interaction.guild!.members.fetch(candidate.discordId as string);
        return {
          value: candidate.discordId as string,
          label: truncate(member.displayName, 100),
          description: truncate(`@${candidate.username}`, 100),
        };
      } catch {
        return null;
      }
    }),
  );

  const opponentOptions = memberChecks
    .filter((entry): entry is { value: string; label: string; description: string } => Boolean(entry))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 24);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`sports_opponent_pick:${sport}:${gameId}:${side}`)
    .setPlaceholder("Choose who to challenge")
    .addOptions([
      {
        label: "Anyone",
        description: "Leave open for any linked member in this server",
        value: "anyone",
      },
      ...opponentOptions,
    ]);

  await interaction.update({
    content: "Choose a specific challenger target, or pick **Anyone**:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

// Opponent selected for sports flow → collect stake via modal.
async function handleSportsOpponentSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, sport, gameId, side] = interaction.customId.split(":");
  const selectedOpponentDiscordId = interaction.values[0] ?? "anyone";
  if (!sport || !gameId || (side !== "home" && side !== "away")) {
    await interaction.reply({ content: "That selection wasn't valid. Try `/bet sports` again.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_sports_create:${sport}:${gameId}:${side}:${selectedOpponentDiscordId}`)
    .setTitle("Place your sports bet");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("stake")
        .setLabel("Stake (SOL each)")
        .setPlaceholder("e.g. 0.1")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

// Modal submitted → create the on-chain sports bet via the relayer and post the card.
async function handleSportsBetModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const user = await requireLinkedUserFromDiscordId(interaction.user.id, interaction);
  if (!user) return;
  const [, sport, gameId, side, selectedOpponentDiscordIdRaw] = interaction.customId.split(":");
  const selectedOpponentDiscordId = selectedOpponentDiscordIdRaw ?? "anyone";
  if (!sport || !gameId || (side !== "home" && side !== "away")) {
    await interaction.editReply("That bet selection expired. Run `/bet sports` again.");
    return;
  }

  const stakeRaw = interaction.fields.getTextInputValue("stake").trim();
  const stake = Number(stakeRaw);
  if (!Number.isFinite(stake) || stake <= 0) {
    await interaction.editReply("Invalid stake. Enter a positive number like `0.1`.");
    return;
  }

  if (!interaction.channelId) {
    await interaction.editReply("Sports bets can only be created in a server channel, not in DMs.");
    return;
  }

  // The relayer's POST /bets requires the channel's conversation to already
  // exist with the creator as a member.
  const conv = await getOrCreateDiscordConversation(interaction.channelId, interaction.guildId, user);

  let acceptorUsername = "anyone";
  if (selectedOpponentDiscordId !== "anyone") {
    const usersCol = await users();
    if (!usersCol) {
      await interaction.editReply("Database not available.");
      return;
    }
    const opponentUser = await usersCol.findOne({ discordId: selectedOpponentDiscordId });
    if (!opponentUser) {
      await interaction.editReply(
        "That selected opponent is no longer linked. Please run `/bet sports` again.",
      );
      return;
    }
    if (opponentUser.id === user.id) {
      await interaction.editReply("You cannot challenge yourself.");
      return;
    }
    if (interaction.guild) {
      try {
        await interaction.guild.members.fetch(selectedOpponentDiscordId);
      } catch {
        await interaction.editReply("That selected opponent is no longer in this server. Please choose again.");
        return;
      }
    }
    acceptorUsername = opponentUser.username;
  }

  const { ok, status, data } = await relayerCall("POST", "/bets", user, {
    source: "discord",
    discordConversationId: conv.id,
    type: "DEV",
    sport,
    gameId,
    backsHome: side === "home",
    stake: String(stake),
    currency: "SOL",
    acceptor: acceptorUsername,
  });

  if (!ok || !data?.bet) {
    const reason = (data && typeof data.error === "string") ? data.error : `relayer returned ${status}`;
    await interaction.editReply(`Couldn't create the sports bet: ${reason}`);
    return;
  }

  const bet = data.bet as BetDoc;
  const embed = buildBetEmbed(bet, user.username);
  const rows = buildBetActionRows(bet, user.username);

  await interaction.editReply({
    content: `New sports bet posted by <@${interaction.user.id}>! 🏟️`,
    embeds: [embed],
    components: rows,
  });
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// ── command handler dispatch ──────────────────────────────────────────────────

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "setup") {
    await handleSetupCommand(interaction);
  } else if (interaction.commandName === "profile") {
    await handleProfileCommand(interaction);
  } else if (interaction.commandName === "bet") {
    await handleBetCommand(interaction);
  }
}

// ── /profile command ──────────────────────────────────────────────────────────

async function handleProfileCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = await requireLinkedUser(interaction);
  if (!user) return;

  await interaction.deferReply({ ephemeral: true });

  const betsCol = await bets();
  const myBets = betsCol
    ? await betsCol.find({ $or: [{ challenger: user.username }, { acceptor: user.username }] }).toArray()
    : [];

  let wins = 0;
  let losses = 0;
  let active = 0;
  let pending = 0;
  let staked = 0;
  for (const b of myBets) {
    const side = b.challenger === user.username ? "challenger" : "acceptor";
    if (b.status === "PENDING") {
      pending += 1;
    } else if (b.status === "ACTIVE") {
      active += 1;
    } else if (b.resolvedWinner) {
      if (b.resolvedWinner === side) wins += 1;
      else losses += 1;
    }
    const stake = Number(b.stake);
    if (Number.isFinite(stake)) staked += stake;
  }

  const settled = wins + losses;
  const winRate = settled > 0 ? Math.round((wins / settled) * 100) : null;

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(`📊 ${user.username}'s Profile`)
    .setDescription(`Linked to <@${interaction.user.id}>`)
    .addFields(
      { name: "Record", value: `**${wins}**W – **${losses}**L${winRate !== null ? ` (${winRate}%)` : ""}`, inline: true },
      { name: "Active", value: `${active}`, inline: true },
      { name: "Pending", value: `${pending}`, inline: true },
      { name: "Total bets", value: `${myBets.length}`, inline: true },
      { name: "Total staked", value: `${staked.toFixed(2)} SOL`, inline: true },
      {
        name: "Wallet",
        value: user.walletPubkey
          ? `\`${user.walletPubkey.slice(0, 4)}…${user.walletPubkey.slice(-4)}\``
          : "Provisioned on your first bet",
        inline: true,
      },
    )
    .setFooter({ text: "Use /bet personal or /bet sports to start a new bet" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open dashboard")
      .setStyle(ButtonStyle.Link)
      .setURL(`${WEB_BASE_URL}/`),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── button handler ────────────────────────────────────────────────────────────

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith("accept:")) {
    const betId = customId.slice("accept:".length);
    await handleAcceptBet(interaction, betId);
    return;
  }

  if (customId.startsWith("vote_challenger:")) {
    const betId = customId.slice("vote_challenger:".length);
    await handleVote(interaction, betId, "challenger");
    return;
  }

  if (customId.startsWith("vote_acceptor:")) {
    const betId = customId.slice("vote_acceptor:".length);
    await handleVote(interaction, betId, "acceptor");
    return;
  }
}

// ── select menu handler ───────────────────────────────────────────────────────

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId.startsWith("sports_pick:")) {
    await handleSportsGameSelect(interaction);
  } else if (interaction.customId.startsWith("sports_opponent_pick:")) {
    await handleSportsOpponentSelect(interaction);
  } else if (interaction.customId === "personal_opponent_pick") {
    await handlePersonalOpponentSelect(interaction);
  }
}

// ── modal submit handler ──────────────────────────────────────────────────────

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === "modal_bet_create" || interaction.customId.startsWith("modal_bet_create:")) {
    await handleBetCreateModal(interaction);
  } else if (interaction.customId.startsWith("modal_sports_create:")) {
    await handleSportsBetModal(interaction);
  }
}

// ── select: personal opponent ─────────────────────────────────────────────────

async function handlePersonalOpponentSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const selectedOpponentDiscordId = interaction.values[0] ?? "anyone";

  const modal = new ModalBuilder()
    .setCustomId(`modal_bet_create:${selectedOpponentDiscordId}`)
    .setTitle("Create a Personal Bet");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("terms")
        .setLabel("Bet terms")
        .setPlaceholder("e.g. I will run a 5k before Friday")
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(8)
        .setMaxLength(280)
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("stake")
        .setLabel("Stake (SOL each)")
        .setPlaceholder("e.g. 0.1")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("resolve_days")
        .setLabel("Days to resolve (default 7)")
        .setPlaceholder("7")
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    ),
  );

  await interaction.showModal(modal);
}

// ── modal: create bet ─────────────────────────────────────────────────────────

async function handleBetCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const user = await requireLinkedUserFromDiscordId(interaction.user.id, interaction);
  if (!user) return;

  const terms = interaction.fields.getTextInputValue("terms").trim();
  const stakeRaw = interaction.fields.getTextInputValue("stake").trim();
  const resolveDaysRaw = interaction.fields.getTextInputValue("resolve_days").trim();
  const [, selectedOpponentDiscordIdRaw] = interaction.customId.split(":");
  const selectedOpponentDiscordId = selectedOpponentDiscordIdRaw ?? "anyone";

  const stake = Number(stakeRaw);
  if (!Number.isFinite(stake) || stake <= 0) {
    await interaction.editReply("Invalid stake. Enter a positive number like `0.1`.");
    return;
  }
  if (terms.length < 8) {
    await interaction.editReply("Bet terms must be at least 8 characters.");
    return;
  }

  const resolveDays = Number(resolveDaysRaw) || 7;
  const resolveByDate = Date.now() + resolveDays * 24 * 60 * 60 * 1000;

  // Resolve opponent username: look up by Discord username if provided
  let acceptorUsername = "anyone";
  if (selectedOpponentDiscordId !== "anyone") {
    const usersCol = await users();
    if (!usersCol) {
      await interaction.editReply("Database not available.");
      return;
    }
    const opponentUser = await usersCol.findOne({ discordId: selectedOpponentDiscordId });
    if (!opponentUser) {
      await interaction.editReply(
        "That selected opponent is no longer linked. Please run `/bet personal` again.",
      );
      return;
    }
    if (opponentUser.id === user.id) {
      await interaction.editReply("You cannot challenge yourself.");
      return;
    }
    if (interaction.guild) {
      try {
        await interaction.guild.members.fetch(selectedOpponentDiscordId);
      } catch {
        await interaction.editReply("That selected opponent is no longer in this server. Please choose again.");
        return;
      }
    }
    acceptorUsername = opponentUser.username;
  }

  if (!interaction.channelId) {
    await interaction.editReply("Bets can only be created in a server channel, not in DMs.");
    return;
  }

  // Get or create the Discord conversation for this channel
  const conv = await getOrCreateDiscordConversation(interaction.channelId, interaction.guildId, user);

  const betsCol = await bets();
  if (!betsCol) {
    await interaction.editReply("Database not available.");
    return;
  }

  const now = Date.now();
  const betDoc: BetDoc = {
    id: `bet-${now}-${crypto.randomBytes(3).toString("hex")}`,
    source: "discord",
    discordConversationId: conv.id,
    type: "PERSONAL",
    challenger: user.username,
    acceptor: acceptorUsername,
    terms,
    stake: String(stake),
    currency: "SOL",
    status: "PENDING",
    witnesses: 1,
    minBettors: 2,
    groupSize: 2,
    resolveByDate,
    fallbackKind: "return",
    fallbackDest: "",
    acceptByDate: null,
  };
  await betsCol.insertOne(betDoc);

  const embed = buildBetEmbed(betDoc, user.username);
  const rows = buildBetActionRows(betDoc, user.username);

  await interaction.editReply({
    content: `New bet posted by <@${interaction.user.id}>!`,
    embeds: [embed],
    components: rows,
  });
}

// ── accept bet ────────────────────────────────────────────────────────────────

async function handleAcceptBet(interaction: ButtonInteraction, betId: string): Promise<void> {
  await interaction.deferUpdate();

  const user = await requireLinkedUserFromDiscordId(interaction.user.id, interaction);
  if (!user) return;

  const betsCol = await bets();
  if (!betsCol) {
    await interaction.followUp({ content: "Database not available.", ephemeral: true });
    return;
  }

  const existing = await betsCol.findOne({ id: betId });
  if (!existing) {
    await interaction.followUp({ content: "Bet not found.", ephemeral: true });
    return;
  }

  // Sports bets are escrowed on-chain — accepting stakes the other side via the
  // relayer (which enforces accept-before-kickoff) rather than a DB flip.
  if (existing.validation === "sports") {
    await handleSportsAccept(interaction, existing, user);
    return;
  }

  if (existing.status !== "PENDING") {
    await interaction.followUp({ content: "This bet is no longer open for acceptance.", ephemeral: true });
    return;
  }
  if (existing.challenger.toLowerCase() === user.username.toLowerCase()) {
    await interaction.followUp({ content: "You cannot accept your own bet.", ephemeral: true });
    return;
  }
  const addressed = existing.acceptor && existing.acceptor.toLowerCase() !== "anyone";
  if (addressed && existing.acceptor.toLowerCase() !== user.username.toLowerCase()) {
    await interaction.followUp({
      content: `This bet is addressed to **${existing.acceptor}**, not you.`,
      ephemeral: true,
    });
    return;
  }

  const now = Date.now();
  const update: Partial<BetDoc> = {
    status: "ACTIVE",
    acceptedBy: user.username,
    acceptedAt: now,
    opponentUsername: user.username,
    ...(!addressed ? { acceptor: user.username } : {}),
  };
  await betsCol.updateOne({ id: betId }, { $set: update });

  const updated = { ...existing, ...update };
  const embed = buildBetEmbed(updated, user.username);
  const rows = buildBetActionRows(updated, user.username);

  await interaction.editReply({
    embeds: [embed],
    components: rows,
  });

  await interaction.followUp({
    content: `<@${interaction.user.id}> accepted the bet from **${existing.challenger}**! Stakes locked — good luck!`,
    ephemeral: false,
  });
}

// ── accept sports bet (on-chain via relayer) ──────────────────────────────────

async function handleSportsAccept(
  interaction: ButtonInteraction,
  existing: BetDoc,
  user: UserDoc,
): Promise<void> {
  const { ok, status, data } = await relayerCall("POST", "/bets/accept", user, { betId: existing.id });

  if (!ok || !data?.bet) {
    const reason = (data && typeof data.error === "string") ? data.error : `relayer returned ${status}`;
    await interaction.followUp({ content: `Couldn't accept this sports bet: ${reason}`, ephemeral: true });
    return;
  }

  const updated = data.bet as BetDoc;
  const embed = buildBetEmbed(updated, user.username);
  const rows = buildBetActionRows(updated, user.username);

  await interaction.editReply({ embeds: [embed], components: rows });
  await interaction.followUp({
    content:
      `<@${interaction.user.id}> took the other side of **${existing.challenger}**'s bet — ` +
      "stakes locked on-chain. The winner is paid automatically once the game ends. Good luck! 🍀",
    ephemeral: false,
  });
}

// ── vote ──────────────────────────────────────────────────────────────────────

async function handleVote(
  interaction: ButtonInteraction,
  betId: string,
  votedFor: "challenger" | "acceptor",
): Promise<void> {
  await interaction.deferUpdate();

  const user = await requireLinkedUserFromDiscordId(interaction.user.id, interaction);
  if (!user) return;

  const { ok, status, data } = await relayerCall("POST", "/bets/vote", user, { betId, votedFor });
  if (!ok || !data?.bet) {
    const reason = (data && typeof data.error === "string") ? data.error : `relayer returned ${status}`;
    await interaction.followUp({ content: `Couldn't cast this vote: ${reason}`, ephemeral: true });
    return;
  }

  const updated = data.bet as BetDoc;
  const votes = Object.values(updated.votesByVoter ?? {});
  const challengerVotes = votes.filter((vote) => vote === "challenger").length;
  const acceptorVotes = votes.filter((vote) => vote === "acceptor").length;
  const witnesses = updated.witnesses ?? 1;
  const embed = buildBetEmbed(updated, user.username);
  const rows = buildBetActionRows(updated, user.username);

  await interaction.editReply({ embeds: [embed], components: rows });

  if (updated.status === "COMPLETED") {
    const winner = updated.resolvedWinner === "challenger" ? updated.challenger : updated.acceptor;
    await interaction.followUp({
      content: `Bet resolved! **${winner}** wins ${updated.stake} SOL!`,
      ephemeral: false,
    });
  } else {
    await interaction.followUp({
      content: `<@${interaction.user.id}> voted **${votedFor}** won. (${challengerVotes}v${acceptorVotes} so far, need ${witnesses})`,
      ephemeral: false,
    });
  }
}

// ── embed builder ─────────────────────────────────────────────────────────────

function buildBetEmbed(bet: BetDoc, viewerUsername: string): EmbedBuilder {
  if (bet.validation === "sports") {
    return buildSportsBetEmbed(bet);
  }

  const statusColor: Record<string, number> = {
    PENDING: Colors.Yellow,
    ACTIVE: Colors.Blue,
    RESOLVED: Colors.Green,
    COMPLETED: Colors.Green,
  };

  const statusEmoji: Record<string, string> = {
    PENDING: "🟡",
    ACTIVE: "🔵",
    RESOLVED: "✅",
    COMPLETED: "✅",
  };

  const votes = bet.votesByVoter ?? {};
  const challengerVotes = Object.values(votes).filter((v) => v === "challenger").length;
  const acceptorVotes = Object.values(votes).filter((v) => v === "acceptor").length;
  const witnesses = bet.witnesses ?? 1;

  let statusLine = `${statusEmoji[bet.status] ?? "❓"} ${bet.status}`;
  if (bet.status === "ACTIVE") {
    statusLine += ` · votes: ${challengerVotes}/${witnesses} for challenger, ${acceptorVotes}/${witnesses} for acceptor`;
  }
  if (bet.resolvedWinner) {
    const winner = bet.resolvedWinner === "challenger" ? bet.challenger : bet.acceptor;
    statusLine += ` · Winner: **${winner}**`;
  }

  const embed = new EmbedBuilder()
    .setColor(statusColor[bet.status] ?? Colors.Grey)
    .setTitle("BAAM Bet")
    .addFields(
      { name: "Terms", value: bet.terms },
      { name: "Stake", value: `${bet.stake} SOL each`, inline: true },
      { name: "Challenger", value: bet.challenger, inline: true },
      { name: "Opponent", value: bet.acceptor ?? "anyone", inline: true },
      { name: "Status", value: statusLine },
    )
    .setFooter({ text: `ID: ${bet.id}` });

  if (bet.resolveByDate) {
    embed.addFields({
      name: "Resolve by",
      value: `<t:${Math.floor(bet.resolveByDate / 1000)}:R>`,
      inline: true,
    });
  }

  return embed;
}

// Sports bets render their matchup, on-chain state and auto-settlement note.
function buildSportsBetEmbed(bet: BetDoc): EmbedBuilder {
  const sportKey = (bet.sport ?? "soccer") as SportKey;
  const home = bet.homeTeam ?? "Home";
  const away = bet.awayTeam ?? "Away";
  const backsHome = bet.challengerBacksHome ?? true;
  const challengerTeam = backsHome ? home : away;
  const acceptorTeam = backsHome ? away : home;
  const hasOpponent = Boolean(bet.opponentUsername) || (bet.acceptor && bet.acceptor.toLowerCase() !== "anyone");
  const opponentName = bet.opponentUsername ?? (hasOpponent ? bet.acceptor : "Anyone");

  const statusColor: Record<string, number> = {
    PENDING: Colors.Yellow,
    ACTIVE: Colors.Blue,
    RESOLVED: Colors.Green,
    COMPLETED: Colors.Green,
  };
  const statusEmoji: Record<string, string> = {
    PENDING: "🟡",
    ACTIVE: "🔵",
    RESOLVED: "✅",
    COMPLETED: "✅",
  };

  let statusLine: string;
  if (bet.status === "PENDING") {
    statusLine = `${statusEmoji.PENDING} Open — waiting for someone to back **${acceptorTeam}**`;
  } else if (bet.status === "ACTIVE") {
    statusLine = `${statusEmoji.ACTIVE} Locked on-chain — settles automatically when the game ends`;
  } else {
    const winnerTeam =
      bet.resolvedWinner === "challenger" ? challengerTeam
      : bet.resolvedWinner === "acceptor" ? acceptorTeam
      : null;
    statusLine = winnerTeam
      ? `${statusEmoji.COMPLETED} Settled — **${winnerTeam}** won, paid out on-chain`
      : `${statusEmoji.COMPLETED} Settled — stakes refunded (no winner)`;
  }

  const embed = new EmbedBuilder()
    .setColor(statusColor[bet.status] ?? Colors.Grey)
    .setTitle(`🏟️ ${SPORT_LABELS[sportKey] ?? "Sports"} Bet`)
    .addFields(
      { name: "Matchup", value: `${away} @ ${home}` },
      { name: `${bet.challenger} backs`, value: `**${challengerTeam}**`, inline: true },
      { name: `${opponentName} backs`, value: `**${acceptorTeam}**`, inline: true },
      { name: "Stake", value: `${bet.stake} SOL each`, inline: true },
      { name: "Status", value: statusLine },
    )
    .setFooter({ text: `ID: ${bet.id} · Auto-settled from the live score` });

  if (bet.startTime) {
    embed.addFields({ name: "Kickoff", value: `<t:${bet.startTime}:F> (<t:${bet.startTime}:R>)` });
  }

  return embed;
}

function buildBetActionRows(bet: BetDoc, viewerUsername: string): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Sports bets are settled by the score feed, never by votes. Only a pending
  // bet offers an action: take the opposing side.
  if (bet.validation === "sports") {
    if (bet.status === "PENDING") {
      // Button state is baked into the message and shown identically to every
      // viewer, so we can't disable it just for the challenger. The click
      // handler rejects the challenger at runtime instead.
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`accept:${bet.id}`)
            .setLabel("Take the other side")
            .setStyle(ButtonStyle.Success),
        ),
      );
    }
    return rows;
  }

  if (bet.status === "PENDING") {
    // Button state is baked into the message and shown identically to every
    // viewer, so we can't disable it just for the challenger. The click handler
    // rejects the challenger at runtime instead.
    const acceptBtn = new ButtonBuilder()
      .setCustomId(`accept:${bet.id}`)
      .setLabel("Accept Bet")
      .setStyle(ButtonStyle.Success);

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn));
  }

  if (bet.status === "ACTIVE") {
    const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`vote_challenger:${bet.id}`)
        .setLabel(`Challenger Won (${bet.challenger})`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`vote_acceptor:${bet.id}`)
        .setLabel(`Acceptor Won (${bet.acceptor})`)
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(voteRow);
  }

  return rows;
}

// ── Discord conversation management ───────────────────────────────────────────

async function getOrCreateDiscordConversation(
  channelId: string,
  guildId: string | null | undefined,
  owner: UserDoc,
): Promise<DiscordConversationDoc> {
  const col = await discordConversations();
  if (!col) throw new Error("Database unavailable");

  const existing = await col.findOne({ channelId });
  if (existing) {
    // Add owner to members if not already there
    if (!existing.memberUserIds.includes(owner.id)) {
      const now = Date.now();
      await col.updateOne(
        { channelId },
        {
          $addToSet: { memberUserIds: owner.id, memberUsernames: owner.username },
          $set: { updatedAt: now },
        },
      );
      return { ...existing, memberUserIds: [...existing.memberUserIds, owner.id], memberUsernames: [...existing.memberUsernames, owner.username] };
    }
    return existing;
  }

  const now = Date.now();
  const conv: DiscordConversationDoc = {
    id: `dc-${crypto.randomBytes(9).toString("hex")}`,
    channelId,
    guildId: guildId ?? null,
    ownerUserId: owner.id,
    ownerUsername: owner.username,
    memberUserIds: [owner.id],
    memberUsernames: [owner.username],
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(conv);
  return conv;
}

// ── auth helpers (mirrored from index.ts) ─────────────────────────────────────
// These must stay in sync with the relayer auth implementation.

const AUTH_SECRET_BOT = process.env.AUTH_SECRET ?? "dev-only-insecure-auth-secret";

// Mints a short-lived bearer token for a linked user so the bot can call the
// relayer's authenticated endpoints on their behalf. Mirrors signAuthToken in
// index.ts — keep the payload shape ({ uid, email, username, exp }) in sync.
const BOT_TOKEN_TTL_MS = 5 * 60 * 1000; // only needs to outlive a single request

function signBotAuthToken(user: UserDoc): string {
  const payload = {
    uid: user.id,
    email: user.email,
    username: user.username,
    exp: Date.now() + BOT_TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET_BOT).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

// Calls a relayer HTTP endpoint as `user`. Returns the parsed JSON body and the
// status code; never throws on non-2xx so callers can surface the relayer error.
async function relayerCall(
  method: string,
  path: string,
  user: UserDoc | null,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${signBotAuthToken(user)}`;
  const res = await fetch(`${RELAYER_INTERNAL_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

// ── Discord link codes ────────────────────────────────────────────────────────
// Short-lived, HMAC-signed payload that the bot embeds in the web-app link URL.
// The web app passes it back to POST /discord/link, which verifies it with the
// same AUTH_SECRET and attaches the Discord id to the signed-in account.

const LINK_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface DiscordLinkCodePayload {
  discordId: string;
  discordUsername: string;
  guildId: string | null;
  channelId: string | null;
  exp: number;
}

export function signDiscordLinkCode(input: {
  discordId: string;
  discordUsername: string;
  guildId?: string | null;
  channelId?: string | null;
}): string {
  const payload: DiscordLinkCodePayload = {
    discordId: input.discordId,
    discordUsername: input.discordUsername,
    guildId: input.guildId ?? null,
    channelId: input.channelId ?? null,
    exp: Date.now() + LINK_CODE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_SECRET_BOT)
    .update(`discord-link:${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyDiscordLinkCode(code: string): DiscordLinkCodePayload | null {
  const [encoded, providedSignature] = code.split(".");
  if (!encoded || !providedSignature) return null;
  const expectedSignature = crypto
    .createHmac("sha256", AUTH_SECRET_BOT)
    .update(`discord-link:${encoded}`)
    .digest("base64url");
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DiscordLinkCodePayload;
    if (!payload?.discordId || typeof payload.discordId !== "string") return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── linked-user guards ────────────────────────────────────────────────────────

async function requireLinkedUser(
  interaction: ChatInputCommandInteraction,
): Promise<UserDoc | null> {
  const col = await users();
  if (!col) {
    await interaction.reply({ content: "Database not available.", ephemeral: true });
    return null;
  }
  const user = await col.findOne({ discordId: interaction.user.id });
  if (!user) {
    await interaction.reply({
      content: "You need to link your BAAM account first. Run `/setup`.",
      ephemeral: true,
    });
    return null;
  }
  return user;
}

async function requireLinkedUserFromDiscordId(
  discordUserId: string,
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<UserDoc | null> {
  const col = await users();
  if (!col) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "Database not available.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Database not available.", ephemeral: true });
    }
    return null;
  }
  const user = await col.findOne({ discordId: discordUserId });
  if (!user) {
    const msg = { content: "You need to link your BAAM account first. Run `/setup`.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
    return null;
  }
  return user;
}
