// relayer/db.ts
//
// MongoDB layer for the AccountabiliBuddy dashboard.
//
// PLUG-AND-PLAY: the relayer runs fine with NO database configured. The moment
// you set MONGODB_URI in the environment (e.g. an Atlas connection string with
// your credentials), the relayer connects on first request and serves live
// data from MongoDB.
//
// Env vars:
//   MONGODB_URI   connection string, e.g.
//                 mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority
//   MONGODB_DB    database name (default: "accountabilibuddy")
//   MONGODB_TIMEOUT_MS connection/server selection timeout (default: 5 seconds)

import { MongoClient, type Collection, type Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB ?? "accountabilibuddy";
const MONGODB_TIMEOUT_MS = Number(process.env.MONGODB_TIMEOUT_MS ?? 5_000);

// ── document shapes ───────────────────────────────────────────────────────────

export interface GroupDoc {
  id: string;
  name: string;
  initials: string;
  members: number;
  memberUsernames?: string[];
  pendingBet: boolean;
  lastMsg: string;
  time: string;
  updatedAt?: number;
}

export interface MessageDoc {
  id: string;
  groupId: string;
  sender: string;
  initials: string;
  text?: string;
  betId?: string;
  system: boolean;
  ts: string;
  /** Unix ms — for ordering; not shown in the UI. */
  createdAt: number;
}

export interface BetDoc {
  id: string;
  /** Surface that created the bet. iMessage bets use the Messages conversation instead of a dashboard group. */
  source?: "imessage" | "discord";
  /** AccountabiliBuddy-managed Messages conversation used for invite membership. */
  imessageConversationId?: string;
  /** Discord channel conversation id for bets created via Discord. */
  discordConversationId?: string;
  /** Group that owns this bet. Older records may only be linked through a message. */
  groupId?: string;
  type: "PERSONAL" | "DEV";
  challenger: string;
  acceptor: string;
  terms: string;
  stake: string;
  currency: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED" | "COMPLETED";
  witnesses: number;
  minBettors: number;
  groupSize: number;
  /** Witness votes keyed by voter name/handle. */
  votesByVoter?: Record<string, "challenger" | "acceptor">;
  /** Winning side once witness quorum is met (or the sports feed settles a sports bet). */
  resolvedWinner?: "challenger" | "acceptor";
  // ── external-validation (sports bets) ─────────────────────────────────────────
  /** Set for sports bets resolved by the sports data feed instead of witness votes. */
  validation?: "sports";
  /** Sport key used for sports-feed settlement. */
  sport?: "soccer" | "nba" | "nfl" | "nhl";
  /** Legacy field name; stores the numeric sports-feed event id to settle against. */
  espnGameId?: string;
  /** Team display names for the chosen game (for card rendering). */
  homeTeam?: string;
  awayTeam?: string;
  /** True when the challenger (on-chain creator) backs the home side. */
  challengerBacksHome?: boolean;
  /** User who accepted the challenge and activated the bet. */
  acceptedBy?: string;
  /** Unix ms when the challenge was accepted. */
  acceptedAt?: number;
  /** On-chain commitment / sports-bet PDA once staked (optional). */
  commitmentId?: string;
  // ── on-chain escrow (SOL bets only) ──────────────────────────────────────────
  /** True once this bet is escrowed on-chain (currency === "SOL"). */
  onChain?: boolean;
  /** sportsBet PDA backing this bet (mirrors commitmentId). */
  betPda?: string;
  /** Username of the wallet that staked the opposing side on-chain. */
  opponentUsername?: string;
  /** On-chain accept-window kickoff (unix seconds); accept must precede it. */
  startTime?: number;
  /** Earliest on-chain settle time (unix seconds). */
  settleAfter?: number;
  /** Lifecycle of the on-chain escrow account. */
  onChainState?: "open" | "locked" | "settled" | "cancelled";
  /** Transaction signatures for the create / accept / settle steps. */
  createSig?: string;
  acceptSig?: string;
  settleSig?: string;
  // ── witness-bet deadlines + unresolved fallback (precommitted by challenger) ───
  /** Offer expires if not accepted by this unix-ms time. Omitted/null = indefinite. */
  acceptByDate?: number | null;
  /** Resolve-by unix-ms deadline; after it, with no quorum, the fallback fires. */
  resolveByDate?: number;
  /** What happens to the pot if unresolved by resolveByDate. */
  fallbackKind?: "return" | "burn" | "charity";
  /** Burn/charity destination pubkey (base58); also stored for "return" as a placeholder. */
  fallbackDest?: string;
  /** Charity display name, when fallbackKind === "charity". */
  charityName?: string;
}

export interface ProfileDoc {
  id: string;
  name: string;
  initials: string;
  github: string;
  bio?: string;
  sol: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
  /** Placeholder for future per-user total bet volume metric. */
  betCount?: number;
  /** Placeholder for future per-user completion-rate metric (percentage). */
  completionRate?: number;
  createdAt: number;
  updatedAt: number;
}
export interface PlayerDoc {
  rank: number;
  name: string;
  initials: string;
  github: string;
  sol: number;
  solDelta: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
  /** Placeholder for future per-user total bet volume metric. */
  betCount?: number;
  /** Placeholder for future per-user completion-rate metric (percentage). */
  completionRate?: number;
}

export interface UserDoc {
  id: string;
  email: string;
  emailLower: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  createdAt: number;
  /** Custodial Solana wallet (base58 pubkey), provisioned on first need. */
  walletPubkey?: string;
  /** AES-GCM encrypted secret key for the custodial wallet. Never sent to clients. */
  walletSecret?: string;
  /** Opaque identifiers supplied by Messages.framework; never phone numbers or Apple IDs. */
  imessageParticipantIds?: string[];
  /** Discord user snowflake ID, linked via /setup in the bot. */
  discordId?: string;
}

export interface DiscordConversationDoc {
  id: string;
  channelId: string;
  guildId: string | null;
  ownerUserId: string;
  ownerUsername: string;
  memberUserIds: string[];
  memberUsernames: string[];
  createdAt: number;
  updatedAt: number;
}

export interface IMessageConversationDoc {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  memberUserIds: string[];
  memberUsernames: string[];
  createdAt: number;
  updatedAt: number;
}

// ── lazy singleton connection ──────────────────────────────────────────────────

let clientPromise: Promise<Db> | null = null;

/** True when a connection string is present. */
export function isDbConfigured(): boolean {
  return Boolean(MONGODB_URI);
}

/**
 * Returns the connected Db, or null when MONGODB_URI is unset (so callers can
 * degrade gracefully). Connects + initializes indexes on first call.
 */
export async function getDb(): Promise<Db | null> {
  if (!MONGODB_URI) return null;

  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new MongoClient(MONGODB_URI, {
        connectTimeoutMS: MONGODB_TIMEOUT_MS,
        serverSelectionTimeoutMS: MONGODB_TIMEOUT_MS,
      });
      await client.connect();
      const db = client.db(MONGODB_DB);
      console.log(`mongodb connected: ${MONGODB_DB}`);
      await ensureIndexes(db);
      return db;
    })().catch((err) => {
      clientPromise = null; // allow retry on next request
      throw err;
    });
  }

  return clientPromise;
}

export async function groups(): Promise<Collection<GroupDoc> | null> {
  const db = await getDb();
  return db ? db.collection<GroupDoc>("groups") : null;
}
export async function messages(): Promise<Collection<MessageDoc> | null> {
  const db = await getDb();
  return db ? db.collection<MessageDoc>("messages") : null;
}
export async function bets(): Promise<Collection<BetDoc> | null> {
  const db = await getDb();
  return db ? db.collection<BetDoc>("bets") : null;
}
export async function players(): Promise<Collection<PlayerDoc> | null> {
  const db = await getDb();
  return db ? db.collection<PlayerDoc>("players") : null;
}
export async function users(): Promise<Collection<UserDoc> | null> {
  const db = await getDb();
  return db ? db.collection<UserDoc>("users") : null;
}
export async function imessageConversations(): Promise<Collection<IMessageConversationDoc> | null> {
  const db = await getDb();
  return db ? db.collection<IMessageConversationDoc>("imessageConversations") : null;
}
export async function discordConversations(): Promise<Collection<DiscordConversationDoc> | null> {
  const db = await getDb();
  return db ? db.collection<DiscordConversationDoc>("discordConversations") : null;
}
export async function profiles(): Promise<Collection<ProfileDoc> | null> {
  const db = await getDb();
  return db ? db.collection<ProfileDoc>("profiles") : null;
}

// ── indexes ─────────────────────────────────────────────────────────────────

/** Ensure all collection indexes exist (idempotent). */
async function ensureIndexes(db: Db): Promise<void> {
  // Helpful indexes (idempotent).
  await db.collection("messages").createIndex({ groupId: 1, createdAt: 1 });
  await db.collection("groups").createIndex({ id: 1 }, { unique: true });
  await db.collection("groups").createIndex({ memberUsernames: 1 });
  await db.collection("bets").createIndex({ id: 1 }, { unique: true });
  await db.collection("bets").createIndex({ groupId: 1 });
  await db.collection("bets").createIndex({ imessageConversationId: 1 });
  await db.collection("players").createIndex({ github: 1 }, { unique: true });
  await db.collection("users").createIndex({ emailLower: 1 }, { unique: true });
  await db.collection("users").createIndex({ usernameLower: 1 }, { unique: true });
  await db.collection("users").createIndex({ imessageParticipantIds: 1 }, { unique: true, sparse: true });
  await db.collection("imessageConversations").createIndex({ id: 1 }, { unique: true });
  await db.collection("imessageConversations").createIndex({ memberUserIds: 1 });
  await db.collection("users").createIndex({ discordId: 1 }, { unique: true, sparse: true });
  await db.collection("bets").createIndex({ discordConversationId: 1 });
  await db.collection("discordConversations").createIndex({ id: 1 }, { unique: true });
  await db.collection("discordConversations").createIndex({ channelId: 1 }, { unique: true });
  await db.collection("discordConversations").createIndex({ memberUserIds: 1 });
  await db.collection("profiles").createIndex({ id: 1 }, { unique: true });
  await db.collection("profiles").createIndex({ github: 1 }, { unique: true });
}
