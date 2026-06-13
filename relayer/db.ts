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

import { MongoClient, type Collection, type Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB ?? "accountabilibuddy";

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
  type: "PERSONAL" | "DEV";
  challenger: string;
  acceptor: string;
  terms: string;
  stake: string;
  currency: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED";
  witnesses: number;
  minBettors: number;
  groupSize: number;
  /** On-chain commitment / sports-bet PDA once staked (optional). */
  commitmentId?: string;
}

export interface ProfileDoc {
  id: string;
  name: string;
  initials: string;
  github: string;
  bio?: string;
  pals: number;
  sol: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
  createdAt: number;
  updatedAt: number;
}
export interface PlayerDoc {
  rank: number;
  name: string;
  initials: string;
  github: string;
  pals: number;
  palsDelta: number;
  sol: number;
  solDelta: number;
  wins: number;
  disputes: number;
  streak: number;
  streakDir: "up" | "down" | "neutral";
}

export interface UserDoc {
  id: string;
  email: string;
  emailLower: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  createdAt: number;
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
      const client = new MongoClient(MONGODB_URI);
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
  await db.collection("bets").createIndex({ id: 1 }, { unique: true });
  await db.collection("players").createIndex({ github: 1 }, { unique: true });
  await db.collection("users").createIndex({ emailLower: 1 }, { unique: true });
  await db.collection("users").createIndex({ usernameLower: 1 }, { unique: true });
  await db.collection("profiles").createIndex({ id: 1 }, { unique: true });
  await db.collection("profiles").createIndex({ github: 1 }, { unique: true });
}
