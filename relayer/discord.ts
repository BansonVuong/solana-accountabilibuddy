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
//   /bet create    — create a new bet in this channel
//   /bet list      — list active bets you're involved in
//   /bet status    — show the card for a specific bet
//
// Buttons (encoded in customId):
//   accept:<betId>              — accept a pending bet
//   vote_challenger:<betId>     — vote that challenger won
//   vote_acceptor:<betId>       — vote that acceptor won
//
// Modals:
//   modal_link                  — email + password to link existing account
//   modal_signup                — email + username + password for new account
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
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
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

// ── slash command definitions ─────────────────────────────────────────────────

export const discordCommands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Link your AccountabiliBuddy account to Discord"),

  new SlashCommandBuilder()
    .setName("bet")
    .setDescription("AccountabiliBuddy bet commands")
    .addSubcommand((sub) =>
      sub.setName("create").setDescription("Create a new bet in this channel"),
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
  return client;
}

// ── top-level interaction router ──────────────────────────────────────────────

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
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
          .setFooter({ text: "Use /bet create to get started!" }),
      ],
      ephemeral: true,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("open_link_modal")
      .setLabel("Link existing account")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("open_signup_modal")
      .setLabel("Create new account")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle("Welcome to AccountabiliBuddy")
        .setDescription(
          "Put your SOL on the line. Make bets with friends and let the blockchain hold everyone accountable.\n\n" +
          "Link your account or create a new one to get started.",
        ),
    ],
    components: [row],
    ephemeral: true,
  });
}

// ── /bet subcommands ──────────────────────────────────────────────────────────

async function handleBetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    const user = await requireLinkedUser(interaction);
    if (!user) return;

    const modal = new ModalBuilder()
      .setCustomId("modal_bet_create")
      .setTitle("Create a Bet");

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
          .setCustomId("opponent")
          .setLabel("Opponent Discord username (or leave blank for anyone)")
          .setPlaceholder("e.g. alice or @alice")
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
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
      await interaction.editReply("No bets in this channel yet. Use `/bet create` to start one!");
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

// ── command handler dispatch ──────────────────────────────────────────────────

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "setup") {
    await handleSetupCommand(interaction);
  } else if (interaction.commandName === "bet") {
    await handleBetCommand(interaction);
  }
}

// ── button handler ────────────────────────────────────────────────────────────

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId === "open_link_modal") {
    const modal = new ModalBuilder()
      .setCustomId("modal_link")
      .setTitle("Link AccountabiliBuddy Account");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("email")
          .setLabel("Email")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("password")
          .setLabel("Password")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "open_signup_modal") {
    const modal = new ModalBuilder()
      .setCustomId("modal_signup")
      .setTitle("Create AccountabiliBuddy Account");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("email")
          .setLabel("Email")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("username")
          .setLabel("Username (3-24 chars: letters, numbers, _-. )")
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(24)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("password")
          .setLabel("Password (min 8 characters)")
          .setStyle(TextInputStyle.Short)
          .setMinLength(8)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

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

// ── modal submit handler ──────────────────────────────────────────────────────

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === "modal_link") {
    await handleLinkModal(interaction);
  } else if (interaction.customId === "modal_signup") {
    await handleSignupModal(interaction);
  } else if (interaction.customId === "modal_bet_create") {
    await handleBetCreateModal(interaction);
  }
}

// ── modal: link existing account ──────────────────────────────────────────────

async function handleLinkModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const email = interaction.fields.getTextInputValue("email").trim().toLowerCase();
  const password = interaction.fields.getTextInputValue("password");

  const col = await users();
  if (!col) {
    await interaction.editReply("Database not available. Please try again later.");
    return;
  }

  const user = await col.findOne({ emailLower: email });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await interaction.editReply("Invalid email or password. Please try again.");
    return;
  }

  const alreadyLinked = await col.findOne({ discordId: interaction.user.id, id: { $ne: user.id } });
  if (alreadyLinked) {
    await interaction.editReply("This Discord account is already linked to another AccountabiliBuddy account.");
    return;
  }

  if (user.discordId && user.discordId !== interaction.user.id) {
    await interaction.editReply(
      `**${user.username}** is already linked to a different Discord account. Contact support to unlink.`,
    );
    return;
  }

  await col.updateOne({ id: user.id }, { $set: { discordId: interaction.user.id } });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("Account linked!")
        .setDescription(`Your Discord is now linked to **${user.username}**.\n\nUse \`/bet create\` in any channel to post a bet!`),
    ],
  });
}

// ── modal: create new account ─────────────────────────────────────────────────

async function handleSignupModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const email = interaction.fields.getTextInputValue("email").trim();
  const username = normalizeUsername(interaction.fields.getTextInputValue("username").trim());
  const password = interaction.fields.getTextInputValue("password");

  if (!username) {
    await interaction.editReply("Invalid username. Use 3-24 characters: letters, numbers, underscore, dash, or dot.");
    return;
  }
  if (password.length < 8) {
    await interaction.editReply("Password must be at least 8 characters.");
    return;
  }

  const emailLower = email.toLowerCase();
  const col = await users();
  if (!col) {
    await interaction.editReply("Database not available. Please try again later.");
    return;
  }

  const existing = await col.findOne({ $or: [{ emailLower }, { usernameLower: username.toLowerCase() }] });
  if (existing?.emailLower === emailLower) {
    await interaction.editReply("That email is already registered. Use 'Link existing account' instead.");
    return;
  }
  if (existing?.usernameLower === username.toLowerCase()) {
    await interaction.editReply("That username is already taken. Please choose a different one.");
    return;
  }

  const now = Date.now();
  const user: UserDoc = {
    id: `u-${now}-${crypto.randomBytes(4).toString("hex")}`,
    email,
    emailLower,
    username,
    usernameLower: username.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: now,
    discordId: interaction.user.id,
  };
  await col.insertOne(user);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("Account created!")
        .setDescription(
          `Welcome, **${username}**! Your AccountabiliBuddy account is linked to Discord.\n\n` +
          `Your custodial Solana wallet will be provisioned on your first bet.\n\n` +
          `Use \`/bet create\` to post your first bet!`,
        ),
    ],
  });
}

// ── modal: create bet ─────────────────────────────────────────────────────────

async function handleBetCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const user = await requireLinkedUserFromDiscordId(interaction.user.id, interaction);
  if (!user) return;

  const terms = interaction.fields.getTextInputValue("terms").trim();
  const stakeRaw = interaction.fields.getTextInputValue("stake").trim();
  const opponentRaw = interaction.fields.getTextInputValue("opponent").trim().replace(/^@/, "");
  const resolveDaysRaw = interaction.fields.getTextInputValue("resolve_days").trim();

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
  if (opponentRaw) {
    const usersCol = await users();
    if (!usersCol) {
      await interaction.editReply("Database not available.");
      return;
    }
    const opponentUser = await usersCol.findOne({ usernameLower: opponentRaw.toLowerCase() });
    if (!opponentUser) {
      await interaction.editReply(
        `Could not find a linked AccountabiliBuddy user with the username **${opponentRaw}**.\n` +
        `They need to run \`/setup\` first, or leave opponent blank to challenge anyone.`,
      );
      return;
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

// ── vote ──────────────────────────────────────────────────────────────────────

async function handleVote(
  interaction: ButtonInteraction,
  betId: string,
  votedFor: "challenger" | "acceptor",
): Promise<void> {
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
  if (existing.status !== "ACTIVE") {
    await interaction.followUp({ content: "This bet is not in voting stage.", ephemeral: true });
    return;
  }

  const votesByVoter = { ...(existing.votesByVoter ?? {}), [user.username]: votedFor };
  const votes = Object.values(votesByVoter);
  const challengerVotes = votes.filter((v) => v === "challenger").length;
  const acceptorVotes = votes.filter((v) => v === "acceptor").length;
  const witnesses = existing.witnesses ?? 1;

  let statusUpdate: Partial<BetDoc> = { votesByVoter };

  if (challengerVotes >= witnesses) {
    statusUpdate = { ...statusUpdate, status: "COMPLETED", resolvedWinner: "challenger" };
  } else if (acceptorVotes >= witnesses) {
    statusUpdate = { ...statusUpdate, status: "COMPLETED", resolvedWinner: "acceptor" };
  }

  await betsCol.updateOne({ id: betId }, { $set: statusUpdate });

  const updated = { ...existing, ...statusUpdate };
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
    .setTitle("AccountabiliBuddy Bet")
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

function buildBetActionRows(bet: BetDoc, viewerUsername: string): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (bet.status === "PENDING") {
    const isChallenger = viewerUsername.toLowerCase() === bet.challenger.toLowerCase();
    const acceptBtn = new ButtonBuilder()
      .setCustomId(`accept:${bet.id}`)
      .setLabel("Accept Bet")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isChallenger);

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

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  try {
    const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch {
    return false;
  }
}

function normalizeUsername(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9_.\-]{3,24}$/.test(trimmed)) return "";
  return trimmed;
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
      content: "You need to link your AccountabiliBuddy account first. Run `/setup`.",
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
    const msg = { content: "You need to link your AccountabiliBuddy account first. Run `/setup`.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
    return null;
  }
  return user;
}
