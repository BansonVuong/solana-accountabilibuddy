// relayer/index.ts
//
// Env vars:
//   ORACLE_KEYPAIR    path to keypair JSON  (default ~/.config/solana/id.json)
//   SOLANA_RPC_URL    RPC endpoint           (default devnet)
//   HOST              HTTP bind address      (default 127.0.0.1)
//   PORT              HTTP port              (default 8787)
//   POLL_INTERVAL_MS  crank interval ms      (default 60_000)
//   PROFILE_NAME      profile display name   (default "Me")
//   PROFILE_INITIALS  profile initials       (default "ME")
//   PROFILE_GITHUB    profile github handle  (default "me")
//   PROFILE_WALLET    profile wallet pubkey  (default oracle pubkey)
//   USDC_MINT         USDC mint pubkey       (default devnet USDC)
//   AUTH_SECRET       HMAC signing secret for auth sessions
//   AUTH_SESSION_TTL_MS session lifetime in milliseconds (default 30 days)
//   MONGODB_URI       Mongo connection string (optional; enables data routes)
//   MONGODB_DB        Mongo database name     (default "accountabilibuddy")

import "dotenv/config";
import crypto from "crypto";

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AnchorProvider, Program, Wallet, web3 } from "@anchor-lang/core";

import { fetchGameResult, fetchScoreboard, type Sport } from "./scraper";
import {
  isDbConfigured, groups, messages, bets, players, profiles, users, type GroupDoc, type MessageDoc, type ProfileDoc, type UserDoc, type BetDoc,
} from "./db";
import idl from "./generated/accountability.json";
import type { Accountability } from "./generated/accountability";

// ── config ───────────────────────────────────────────────────────────────────

const RPC_URL         = process.env.SOLANA_RPC_URL ?? web3.clusterApiUrl("devnet");
const ORACLE_KP_PATH  = process.env.ORACLE_KEYPAIR ?? "~/.config/solana/id.json";
const HOST            = process.env.HOST ?? "127.0.0.1";
const PORT            = Number(process.env.PORT ?? 8787);
const POLL_INTERVAL   = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const PROFILE_NAME    = process.env.PROFILE_NAME ?? "Me";
const PROFILE_INITIALS = process.env.PROFILE_INITIALS ?? "ME";
const PROFILE_GITHUB   = process.env.PROFILE_GITHUB ?? "me";
const DEFAULT_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-only-insecure-auth-secret";
const AUTH_SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 30);

const VAULT_SEED        = Buffer.from("vault");
const SPORTS_VAULT_SEED = Buffer.from("sports_vault");

// ── Solana setup ──────────────────────────────────────────────────────────────

const oracle   = loadKeypair(ORACLE_KP_PATH);
const connection = new web3.Connection(RPC_URL, "confirmed");
const provider   = new AnchorProvider(connection, new Wallet(oracle), AnchorProvider.defaultOptions());
const program    = new Program<Accountability>(idl as Accountability, provider);
const profileWallet = parsePublicKey(process.env.PROFILE_WALLET, oracle.publicKey);
const usdcMint = parsePublicKey(process.env.USDC_MINT, new web3.PublicKey(DEFAULT_USDC_MINT));

// ── original accountability crank ─────────────────────────────────────────────

async function resolveSuccess(commitmentId: string): Promise<string> {
  const commitment = new web3.PublicKey(commitmentId);
  const account    = await program.account.commitment.fetch(commitment);

  if (!account.oraclePubkey.equals(oracle.publicKey)) {
    throw new Error(`oracle mismatch for commitment ${commitmentId}`);
  }

  const [vault] = web3.PublicKey.findProgramAddressSync(
    [VAULT_SEED, commitment.toBuffer()],
    program.programId,
  );

  return program.methods.resolve(true)
    .accountsStrict({
      oracle: oracle.publicKey,
      staker: account.staker,
      commitment,
      vault,
      destination: account.failureDestination,
    })
    .rpc();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function crankTimeouts(): Promise<void> {
  const slot = await connection.getSlot("confirmed");
  const now  = await connection.getBlockTime(slot);
  if (now === null) return;

  const commitments = await program.account.commitment.all();
  for (const { publicKey, account } of commitments) {
    if (!("active" in account.state) || account.deadline.gtn(now)) continue;

    const [vault] = web3.PublicKey.findProgramAddressSync(
      [VAULT_SEED, publicKey.toBuffer()],
      program.programId,
    );

    try {
      const sig = await program.methods.timeout()
        .accountsStrict({
          cranker:    oracle.publicKey,
          staker:     account.staker,
          commitment: publicKey,
          vault,
          destination: account.failureDestination,
        })
        .rpc();
      console.log(`timed out ${publicKey.toBase58()}: ${sig}`);
    } catch (err) {
      console.error(`timeout failed for ${publicKey.toBase58()}:`, err);
    }
  }
}

// ── sports bet helpers ────────────────────────────────────────────────────────

const SPORT_NAMES: Sport[] = ["soccer", "nba", "nfl"];
type BetVoteChoice = "challenger" | "acceptor";

function normalizeBetStatus(status: BetDoc["status"]): BetDoc["status"] {
  return status === "RESOLVED" ? "COMPLETED" : status;
}

function normalizeVotesByVoter(input: BetDoc["votesByVoter"]): Record<string, BetVoteChoice> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, BetVoteChoice> = {};
  for (const [voter, choice] of Object.entries(input)) {
    if ((choice === "challenger" || choice === "acceptor") && voter.trim()) {
      out[voter] = choice;
    }
  }
  return out;
}

function normalizeBetDoc(doc: BetDoc): BetDoc {
  return {
    ...doc,
    status: normalizeBetStatus(doc.status),
    votesByVoter: normalizeVotesByVoter(doc.votesByVoter),
  };
}

function isBetCompletedStatus(status: BetDoc["status"]): boolean {
  return normalizeBetStatus(status) === "COMPLETED";
}

function countBetVotes(votesByVoter: Record<string, BetVoteChoice>): {
  challenger: number;
  acceptor: number;
  total: number;
} {
  let challenger = 0;
  let acceptor = 0;
  for (const choice of Object.values(votesByVoter)) {
    if (choice === "challenger") challenger += 1;
    if (choice === "acceptor") acceptor += 1;
  }
  return { challenger, acceptor, total: challenger + acceptor };
}

// Decode a [u8; 32] zero-padded game id back into a string.
function decodeGameId(raw: ArrayLike<number>): string {
  const buf    = Buffer.from(raw as number[]);
  const nullAt = buf.indexOf(0);
  return buf.slice(0, nullAt === -1 ? 32 : nullAt).toString("utf8");
}

// Turn an on-chain sportsBet account into a JSON-friendly object for the dashboard.
function decodeSportsBet(
  pubkey: web3.PublicKey,
  bet: Awaited<ReturnType<typeof program.account.sportsBet.fetch>>,
): Record<string, unknown> {
  const state = "open" in bet.state ? "open" : "locked" in bet.state ? "locked" : "settled";
  return {
    pubkey:           pubkey.toBase58(),
    creator:          bet.creator.toBase58(),
    opponent:         bet.opponent ? bet.opponent.toBase58() : null,
    amountLamports:   bet.amount.toNumber(),
    amountSol:        bet.amount.toNumber() / web3.LAMPORTS_PER_SOL,
    oracle:           bet.oraclePubkey.toBase58(),
    sport:            SPORT_NAMES[bet.sport as number] ?? "soccer",
    gameId:           decodeGameId(bet.gameId),
    creatorBacksHome: bet.creatorBacksHome,
    startTime:        bet.startTime.toNumber(),
    settleAfter:      bet.settleAfter.toNumber(),
    state,
  };
}

// ── sports bet crank (scraper-powered) ───────────────────────────────────────

async function crankSportsBets(): Promise<void> {
  const slot = await connection.getSlot("confirmed");
  const now  = await connection.getBlockTime(slot);
  if (now === null) return;

  const bets = await program.account.sportsBet.all();

  for (const { publicKey: betPubkey, account: bet } of bets) {
    if (!("locked" in bet.state)) continue;
    if (bet.settleAfter.toNumber() > now) continue;
    if (!bet.oraclePubkey.equals(oracle.publicKey)) continue;
    if (!bet.opponent) continue;

    // Decode game_id ([u8; 32], zero-padded) back to a string
    const gameId = decodeGameId(bet.gameId);

    // sport is stored as a u8 enum: 0=soccer, 1=nba, 2=nfl
    const sport: Sport = SPORT_NAMES[bet.sport as number] ?? "soccer";

    let result;
    try {
      result = await fetchGameResult(sport, gameId);
    } catch (err) {
      console.error(`scrape error for game ${gameId} (${sport}):`, err);
      continue;
    }

    if (!result) {
      console.log(`Game ${gameId} (${sport}) not yet final — skipping.`);
      continue;
    }

    console.log(
      `Game ${gameId} final: ${result.awayTeam} ${result.awayScore} @ ` +
      `${result.homeTeam} ${result.homeScore} → homeWon=${result.homeWon}`
    );

    const [vault] = web3.PublicKey.findProgramAddressSync(
      [SPORTS_VAULT_SEED, betPubkey.toBuffer()],
      program.programId,
    );

    try {
      const sig = await program.methods
        .settleBet(result.homeWon === null ? null : result.homeWon)
        .accountsStrict({
          oracle:    oracle.publicKey,
          creator:   bet.creator,
          opponent:  bet.opponent,
          sportsBet: betPubkey,
          vault,
        })
        .rpc();
      console.log(`Settled bet ${betPubkey.toBase58()}: ${sig}`);
    } catch (err) {
      console.error(`settle failed for ${betPubkey.toBase58()}:`, err);
    }
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    // CORS preflight (browser dashboard calls these endpoints directly)
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      const slot = await connection.getSlot("confirmed").catch(() => 0);
      return json(res, 200, {
        ok: true,
        oracle:  oracle.publicKey.toBase58(),
        program: program.programId.toBase58(),
        rpc:     RPC_URL,
        slot,
        db:      isDbConfigured() ? "configured" : "unconfigured",
      });
    }

    // POST /auth/signup  { email, username, password }
    if (req.method === "POST" && req.url === "/auth/signup") {
      const col = await users();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const username = normalizeUsername(body.username);
      const password = typeof body.password === "string" ? body.password : "";
      if (!email) return json(res, 400, { error: "valid email is required" });
      if (!username) return json(res, 400, { error: "username must be 3-24 chars using letters, numbers, underscore, dash, or dot" });
      if (password.length < 8) return json(res, 400, { error: "password must be at least 8 characters" });

      const emailLower = email.toLowerCase();
      const usernameLower = username.toLowerCase();
      const existing = await col.findOne({
        $or: [{ emailLower }, { usernameLower }],
      }, { projection: { emailLower: 1, usernameLower: 1 } });
      if (existing?.emailLower === emailLower) {
        return json(res, 409, { error: "email already registered" });
      }
      if (existing?.usernameLower === usernameLower) {
        return json(res, 409, { error: "username already taken" });
      }

      const now = Date.now();
      const user: UserDoc = {
        id: `u-${now}-${crypto.randomBytes(4).toString("hex")}`,
        email,
        emailLower,
        username,
        usernameLower,
        passwordHash: hashPassword(password),
        createdAt: now,
      };
      await col.insertOne(user);
      const token = signAuthToken(user.id, user.email, user.username);
      return json(res, 201, { token, user: toPublicUser(user) });
    }

    // POST /auth/login  { email, password }
    if (req.method === "POST" && req.url === "/auth/login") {
      const col = await users();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password) return json(res, 400, { error: "email and password are required" });

      const user = await col.findOne({ emailLower: email.toLowerCase() });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return json(res, 401, { error: "invalid email or password" });
      }
      const token = signAuthToken(user.id, user.email, user.username);
      return json(res, 200, { token, user: toPublicUser(user) });
    }

    // GET /auth/me
    if (req.method === "GET" && req.url === "/auth/me") {
      const user = await getAuthenticatedUser(req);
      if (!user) return json(res, 401, { error: "unauthorized" });
      return json(res, 200, { user: toPublicUser(user) });
    }

    // GET /profile
    if (req.method === "GET" && req.url === "/profile") {
      const authUser = await getAuthenticatedUser(req);
      const usdcBalance = await fetchUsdcBalance(profileWallet, usdcMint).catch((err) => {
        console.error("failed to fetch USDC balance:", err);
        return 0;
      });
      return json(res, 200, {
        name: authUser?.username ?? PROFILE_NAME,
        initials: authUser ? toInitials(authUser.username) : PROFILE_INITIALS,
        github: authUser?.username ?? PROFILE_GITHUB,
        wallet: profileWallet.toBase58(),
        usdcMint: usdcMint.toBase58(),
        usdcBalance,
      });
    }

    // POST /verify  (original accountability commitment)
    if (req.method === "POST" && req.url === "/verify") {
      const body = await readJson(req);
      if (typeof body.commitmentId !== "string")
        return json(res, 400, { error: "commitmentId is required" });
      const signature = await resolveSuccess(body.commitmentId);
      return json(res, 200, { commitmentId: body.commitmentId, signature, explorer: explorerUrl(signature) });
    }

    // GET /scoreboard?sport=nba|nfl|soccer[&league=worldcup]  — today's games + IDs
    // For soccer, an optional league narrows the board (e.g. worldcup, ucl, epl).
    if (req.method === "GET" && req.url?.startsWith("/scoreboard")) {
      const params = new URL(req.url, "http://x").searchParams;
      const sport  = (params.get("sport") ?? "nba") as Sport;
      const league = params.get("league") ?? undefined;
      if (!["soccer", "nba", "nfl"].includes(sport))
        return json(res, 400, { error: "sport must be soccer | nba | nfl" });
      const games = await fetchScoreboard(sport, league);
      return json(res, 200, { sport, league: league ?? null, games });
    }

    // GET /game?sport=nba&id=401584793  — check one game's result
    if (req.method === "GET" && req.url?.startsWith("/game")) {
      const params = new URL(req.url, "http://x").searchParams;
      const sport  = (params.get("sport") ?? "nba") as Sport;
      const gameId = params.get("id") ?? "";
      if (!gameId) return json(res, 400, { error: "id is required" });
      const result = await fetchGameResult(sport, gameId);
      return json(res, 200, { result });
    }

    // GET /sports-bets  — all on-chain sports bets (1v1 / group-chat wagers)
    if (req.method === "GET" && req.url?.startsWith("/sports-bets")) {
      const all = await program.account.sportsBet.all();
      const bets = all.map(({ publicKey, account }) => decodeSportsBet(publicKey, account));
      return json(res, 200, { bets });
    }

    // POST /settle-bet  — manually trigger crank
    if (req.method === "POST" && req.url === "/settle-bet") {
      await crankSportsBets();
      return json(res, 200, { ok: true });
    }

    // ── MongoDB-backed dashboard data ─────────────────────────────────────────
    // All of these return 503 (with a clear message) until MONGODB_URI is set,
    // so the frontend keeps using its design fixtures until the DB is wired up.

    // GET /groups  — group-chat list
    if (req.method === "GET" && req.url === "/groups") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const col = await groups();
      if (!col) return dbUnconfigured(res);
      const docs = await col
        .find({ memberUsernames: authUser.username }, { projection: { _id: 0 } })
        .toArray();
      return json(res, 200, { groups: docs });
    }

    // POST /groups  { name, initials? }  — create a group-chat record
    if (req.method === "POST" && req.url === "/groups") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const col = await groups();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      if (typeof body.name !== "string" || body.name.trim().length < 2)
        return json(res, 400, { error: "name is required (min 2 chars)" });
      const now = Date.now();
      const doc: GroupDoc = {
        id: `g-${now}`,
        name: body.name.trim(),
        initials: toInitials(typeof body.initials === "string" ? body.initials : body.name),
        members: 1,
        memberUsernames: [authUser.username],
        pendingBet: false,
        lastMsg: "Group created",
        time: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      await col.insertOne(doc);
      return json(res, 201, { group: doc });
    }

    // POST /groups/:id/members  { username } — add a known user to a group by username
    const groupMembersPathId = req.url ? decodeGroupMembersPathId(req.url) : null;
    if (req.method === "POST" && groupMembersPathId) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const groupsCol = await groups();
      const usersCol = await users();
      if (!groupsCol || !usersCol) return dbUnconfigured(res);

      const body = await readJson(req);
      const username = normalizeUsername(body.username);
      if (!username) {
        return json(res, 400, { error: "valid username is required" });
      }

      const group = await groupsCol.findOne(
        { id: groupMembersPathId },
        { projection: { _id: 0 } },
      );
      if (!group) {
        return json(res, 404, { error: "group not found" });
      }
      if (!isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }

      const user = await usersCol.findOne(
        { usernameLower: username.toLowerCase() },
        { projection: { _id: 0 } },
      );
      if (!user) {
        return json(res, 404, { error: "username not found" });
      }

      const currentMemberUsernames = Array.isArray(group.memberUsernames)
        ? group.memberUsernames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const alreadyMember = currentMemberUsernames.some(
        (value) => value.toLowerCase() === user.usernameLower,
      );
      if (alreadyMember) {
        return json(res, 200, { group, addedUsername: user.username, alreadyMember: true });
      }

      const nextMemberUsernames = [...currentMemberUsernames, user.username];
      const nextMembers = Math.max(
        nextMemberUsernames.length,
        Math.floor(toFiniteNumber(group.members, 1)),
      );
      const nowLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      await groupsCol.updateOne(
        { id: groupMembersPathId },
        {
          $set: {
            memberUsernames: nextMemberUsernames,
            members: nextMembers,
            lastMsg: `${user.username} joined the group`,
            time: nowLabel,
          },
        },
      );

      const updatedGroup = await groupsCol.findOne(
        { id: groupMembersPathId },
        { projection: { _id: 0 } },
      );
      if (!updatedGroup) {
        return json(res, 500, { error: "failed to update group members" });
      }
      return json(res, 200, {
        group: updatedGroup,
        addedUsername: user.username,
        alreadyMember: false,
      });
    }

    // GET /messages?group=1  — messages for a group (chronological)
    if (req.method === "GET" && req.url?.startsWith("/messages")) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const messagesCol = await messages();
      const groupsCol = await groups();
      if (!messagesCol || !groupsCol) return dbUnconfigured(res);
      const groupId = new URL(req.url, "http://x").searchParams.get("group") ?? "1";
      const group = await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } });
      if (!group) return json(res, 404, { error: "group not found" });
      if (!isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }
      const docs = await messagesCol
        .find({ groupId }, { projection: { _id: 0 } })
        .sort({ createdAt: 1 })
        .toArray();
      return json(res, 200, { messages: docs });
    }

    // POST /messages  { groupId, text }  — append a chat message
    if (req.method === "POST" && req.url === "/messages") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const messagesCol = await messages();
      const groupsCol = await groups();
      if (!messagesCol || !groupsCol) return dbUnconfigured(res);
      const body = await readJson(req);
      if (typeof body.groupId !== "string")
        return json(res, 400, { error: "groupId is required" });
      const group = await groupsCol.findOne({ id: body.groupId }, { projection: { _id: 0 } });
      if (!group) return json(res, 404, { error: "group not found" });
      if (!isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }
      const doc: MessageDoc = {
        id:        `m-${Date.now()}`,
        groupId:   body.groupId,
        sender:    authUser.username,
        initials:  toInitials(authUser.username),
        text:      typeof body.text === "string" ? body.text : undefined,
        system:    false,
        ts:        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        createdAt: Date.now(),
      };
      await messagesCol.insertOne(doc);
      await groupsCol.updateOne(
        { id: body.groupId },
        { $set: { lastMsg: doc.text ?? "New message", time: doc.ts } },
      );
      const { ...out } = doc;
      return json(res, 201, { message: out });
    }

    // POST /bets  { groupId, type, acceptor, terms, stake, currency, witnesses?, minBettors? }
    // Creates a persistent bet plus a linked system message for embedded bet-card rendering.
    if (req.method === "POST" && req.url === "/bets") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const betsCol = await bets();
      const groupsCol = await groups();
      const messagesCol = await messages();
      if (!betsCol || !groupsCol || !messagesCol) return dbUnconfigured(res);

      const body = await readJson(req);
      const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
      const type = body.type === "PERSONAL" || body.type === "DEV" ? body.type : null;
      const challenger = authUser.username;
      const acceptorInput = typeof body.acceptor === "string" ? body.acceptor.trim() : "";
      const terms = typeof body.terms === "string" ? body.terms.trim() : "";
      const stakeInput = typeof body.stake === "string" ? body.stake.trim() : `${body.stake ?? ""}`.trim();
      const currency = body.currency === "SOL" || body.currency === "POINTS" ? body.currency : null;

      if (!groupId) return json(res, 400, { error: "groupId is required" });
      if (!type) return json(res, 400, { error: "type must be PERSONAL or DEV" });
      const acceptor = type === "DEV" ? (acceptorInput || "anyone") : acceptorInput;
      if (!acceptor) return json(res, 400, { error: "acceptor is required" });
      if (acceptorInput && acceptorInput.toLowerCase() === challenger.toLowerCase()) {
        return json(res, 400, { error: "you cannot challenge yourself" });
      }
      if (terms.length < 8) return json(res, 400, { error: "terms must be at least 8 characters" });
      const numericStake = Number(stakeInput);
      if (!stakeInput || !Number.isFinite(numericStake) || numericStake <= 0) {
        return json(res, 400, { error: "stake must be a positive number" });
      }
      if (!currency) return json(res, 400, { error: "currency must be SOL or POINTS" });

      const group = await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } });
      if (!group) return json(res, 404, { error: "group not found" });
      if (!isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }

      const now = Date.now();
      const ts = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const witnesses = Math.max(1, Math.floor(toFiniteNumber(body.witnesses, 1)));
      const minBettors = Math.max(1, Math.floor(toFiniteNumber(body.minBettors, 2)));
      const groupSize = Math.max(1, Math.floor(toFiniteNumber(group.members, 1)));

      const betDoc: BetDoc = {
        id: `bet-${now}-${crypto.randomBytes(3).toString("hex")}`,
        groupId,
        type,
        challenger,
        acceptor,
        terms,
        stake: stakeInput,
        currency,
        status: "PENDING",
        witnesses,
        minBettors,
        groupSize,
      };
      await betsCol.insertOne(betDoc);

      const systemMessage: MessageDoc = {
        id: `m-${now}-${crypto.randomBytes(2).toString("hex")}`,
        groupId,
        sender: "System",
        initials: "SY",
        betId: betDoc.id,
        system: true,
        ts,
        createdAt: now,
      };
      await messagesCol.insertOne(systemMessage);

      await groupsCol.updateOne(
        { id: groupId },
        {
          $set: {
            pendingBet: true,
            lastMsg: `${challenger} posted a new ${type === "DEV" ? "dev" : "personal"} bet`,
            time: ts,
          },
        },
      );

      return json(res, 201, { bet: normalizeBetDoc(betDoc), message: systemMessage });
    }

    // GET /bets  — bets linked to the current user's groups
    if (req.method === "GET" && req.url === "/bets") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const betsCol = await bets();
      const groupsCol = await groups();
      const messagesCol = await messages();
      if (!betsCol || !groupsCol || !messagesCol) return dbUnconfigured(res);
      const memberGroups = await groupsCol
        .find({ memberUsernames: authUser.username }, { projection: { id: 1 } })
        .toArray();
      const groupIds = memberGroups.map((group) => group.id);
      const legacyBetIds = groupIds.length
        ? await messagesCol.distinct("betId", { groupId: { $in: groupIds }, betId: { $type: "string" } })
        : [];
      const docs = groupIds.length
        ? await betsCol.find({
            $or: [
              { groupId: { $in: groupIds } },
              { id: { $in: legacyBetIds } },
            ],
          }, { projection: { _id: 0 } }).toArray()
        : [];
      return json(res, 200, { bets: docs.map(normalizeBetDoc) });
    }

    // POST /bets/vote  { betId, votedFor }  — cast/update witness vote
    if (req.method === "POST" && req.url === "/bets/vote") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const col = await bets();
      const groupsCol = await groups();
      const messagesCol = await messages();
      if (!col || !groupsCol || !messagesCol) return dbUnconfigured(res);
      const body = await readJson(req);
      const betId = typeof body.betId === "string" ? body.betId.trim() : "";
      const voter = authUser.username;
      const votedFor = body.votedFor;

      if (!betId) return json(res, 400, { error: "betId is required" });
      if (votedFor !== "challenger" && votedFor !== "acceptor") {
        return json(res, 400, { error: "votedFor must be challenger or acceptor" });
      }

      const existing = await col.findOne({ id: betId }, { projection: { _id: 0 } });
      if (!existing) return json(res, 404, { error: "bet not found" });
      const linkedMessage = existing.groupId
        ? null
        : await messagesCol.findOne({ betId }, { projection: { groupId: 1 } });
      const groupId = existing.groupId ?? linkedMessage?.groupId;
      const group = groupId
        ? await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } })
        : null;
      if (!group || !isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }
      const current = normalizeBetDoc(existing);
      if (isBetCompletedStatus(current.status)) {
        return json(res, 409, { error: "bet is already completed", bet: current });
      }

      const nextVotesByVoter: Record<string, BetVoteChoice> = {
        ...current.votesByVoter,
        [voter]: votedFor,
      };
      const votes = countBetVotes(nextVotesByVoter);
      const witnessThreshold = Math.max(1, Number(current.witnesses) || 1);
      const winner: BetVoteChoice | undefined =
        votes.challenger >= witnessThreshold
          ? "challenger"
          : votes.acceptor >= witnessThreshold
            ? "acceptor"
            : undefined;
      const nextStatus: BetDoc["status"] = winner
        ? "COMPLETED"
        : current.status === "PENDING" && votes.total > 0
          ? "ACTIVE"
          : current.status;

      await col.updateOne(
        { id: betId },
        {
          $set: {
            votesByVoter: nextVotesByVoter,
            status: nextStatus,
            ...(winner ? { resolvedWinner: winner } : {}),
          },
        },
      );
      if (!winner && current.resolvedWinner) {
        await col.updateOne({ id: betId }, { $unset: { resolvedWinner: "" } });
      }

      const updated = await col.findOne({ id: betId }, { projection: { _id: 0 } });
      if (!updated) return json(res, 404, { error: "bet not found after update" });
      return json(res, 200, { bet: normalizeBetDoc(updated) });
    }

    // GET /leaderboard  — players ranked by $PALS
    if (req.method === "GET" && req.url === "/leaderboard") {
      const col = await players();
      if (!col) return dbUnconfigured(res);
      const docs = await col
        .find({}, { projection: { _id: 0 } })
        .sort({ pals: -1 })
        .toArray();
      return json(res, 200, { players: docs });
    }

    // GET /profiles  — all profile records
    if (req.method === "GET" && req.url === "/profiles") {
      const col = await profiles();
      if (!col) return dbUnconfigured(res);
      const docs = await col
        .find({}, { projection: { _id: 0 } })
        .sort({ pals: -1, updatedAt: -1 })
        .toArray();
      return json(res, 200, { profiles: docs });
    }

    // GET /profiles/:id  — one profile by id
    if (req.method === "GET" && req.url?.startsWith("/profiles/")) {
      const col = await profiles();
      if (!col) return dbUnconfigured(res);
      const id = decodeProfilePathId(req.url);
      if (!id) return json(res, 400, { error: "profile id is required" });
      const doc = await col.findOne({ id }, { projection: { _id: 0 } });
      if (!doc) return json(res, 404, { error: "profile not found" });
      return json(res, 200, { profile: doc });
    }

    // POST /profiles  { name, initials?, github?, bio?, ...stats }
    if (req.method === "POST" && req.url === "/profiles") {
      const col = await profiles();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      if (typeof body.name !== "string" || body.name.trim().length < 2)
        return json(res, 400, { error: "name is required (min 2 chars)" });
      const now = Date.now();
      const doc: ProfileDoc = {
        id: `u-${now}`,
        name: body.name.trim(),
        initials: toInitials(typeof body.initials === "string" ? body.initials : body.name),
        github: typeof body.github === "string" && body.github.trim() ? body.github.trim() : `user-${now}`,
        bio: typeof body.bio === "string" ? body.bio.trim() : undefined,
        pals: toFiniteNumber(body.pals, 0),
        sol: toFiniteNumber(body.sol, 0),
        wins: toFiniteNumber(body.wins, 0),
        disputes: toFiniteNumber(body.disputes, 0),
        streak: toFiniteNumber(body.streak, 0),
        streakDir: body.streakDir === "up" || body.streakDir === "down" ? body.streakDir : "neutral",
        createdAt: now,
        updatedAt: now,
      };
      await col.insertOne(doc);
      return json(res, 201, { profile: doc });
    }

    // PATCH /profiles/:id  — partial profile updates
    if (req.method === "PATCH" && req.url?.startsWith("/profiles/")) {
      const col = await profiles();
      if (!col) return dbUnconfigured(res);
      const id = decodeProfilePathId(req.url);
      if (!id) return json(res, 400, { error: "profile id is required" });
      const body = await readJson(req);
      const update: Partial<ProfileDoc> = {};
      if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
      if (typeof body.initials === "string" && body.initials.trim()) update.initials = toInitials(body.initials);
      if (typeof body.github === "string" && body.github.trim()) update.github = body.github.trim();
      if (typeof body.bio === "string") update.bio = body.bio.trim();
      if (isFiniteNumber(body.pals)) update.pals = body.pals;
      if (isFiniteNumber(body.sol)) update.sol = body.sol;
      if (isFiniteNumber(body.wins)) update.wins = body.wins;
      if (isFiniteNumber(body.disputes)) update.disputes = body.disputes;
      if (isFiniteNumber(body.streak)) update.streak = body.streak;
      if (body.streakDir === "up" || body.streakDir === "down" || body.streakDir === "neutral") update.streakDir = body.streakDir;
      if (Object.keys(update).length === 0)
        return json(res, 400, { error: "no valid fields provided for update" });
      update.updatedAt = Date.now();
      await col.updateOne({ id }, { $set: update });
      const doc = await col.findOne({ id }, { projection: { _id: 0 } });
      if (!doc) return json(res, 404, { error: "profile not found" });
      return json(res, 200, { profile: doc });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.name.startsWith("Mongo")) {
      return json(res, 503, {
        error: "database unavailable; check MongoDB Atlas network access",
      });
    }
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`relayer listening on http://${HOST}:${PORT}`);
  console.log(`oracle: ${oracle.publicKey.toBase58()}`);
  console.log(`program: ${program.programId.toBase58()}`);
});

setInterval(() => void runPoll(), POLL_INTERVAL);
void runPoll();

async function runPoll(): Promise<void> {
  try {
    await crankTimeouts();
    await crankSportsBets();
  } catch (err) {
    console.error("poll error:", err);
  }
}

// ── utils ─────────────────────────────────────────────────────────────────────

function loadKeypair(filename: string): web3.Keypair {
  const expanded = filename.startsWith("~/")
    ? path.join(os.homedir(), filename.slice(2))
    : filename;
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8")) as number[])
  );
}

function parsePublicKey(value: string | undefined, fallback: web3.PublicKey): web3.PublicKey {
  if (!value) return fallback;
  try {
    return new web3.PublicKey(value);
  } catch {
    console.warn(`invalid public key "${value}", falling back to ${fallback.toBase58()}`);
    return fallback;
  }
}

async function fetchUsdcBalance(owner: web3.PublicKey, mint: web3.PublicKey): Promise<number> {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed");
  let total = 0;
  for (const item of accounts.value) {
    const parsed = item.account.data as {
      parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
    };
    const amount = Number(parsed.parsed?.info?.tokenAmount?.uiAmount ?? 0);
    if (Number.isFinite(amount)) total += amount;
  }
  return total;
}

type AuthTokenPayload = {
  uid: string;
  email: string;
  username: string;
  exp: number;
};

function signAuthToken(uid: string, email: string, username: string): string {
  const payload: AuthTokenPayload = {
    uid,
    email,
    username,
    exp: Date.now() + AUTH_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyAuthToken(token: string): AuthTokenPayload | null {
  const [encoded, providedSignature] = token.split(".");
  if (!encoded || !providedSignature) return null;
  const expectedSignature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encoded)
    .digest("base64url");
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AuthTokenPayload;
    if (!payload?.uid || !payload?.email || !payload?.username) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return valid ? email : null;
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (!username) return null;
  const valid = /^[a-zA-Z0-9._-]{3,24}$/.test(username);
  return valid ? username : null;
}

function toPublicUser(user: UserDoc): {
  id: string;
  email: string;
  username: string;
  initials: string;
  createdAt: number;
} {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    initials: toInitials(user.username),
    createdAt: user.createdAt,
  };
}

function readBearerToken(req: http.IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (!value || typeof value !== "string") return null;
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

async function getAuthenticatedUser(req: http.IncomingMessage): Promise<UserDoc | null> {
  const token = readBearerToken(req);
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const col = await users();
  if (!col) return null;
  const user = await col.findOne({ id: payload.uid });
  return user;
}

function isGroupMember(group: GroupDoc, username: string): boolean {
  return Array.isArray(group.memberUsernames) && group.memberUsernames.some(
    (member) => member.toLowerCase() === username.toLowerCase(),
  );
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { body += c; if (body.length > 16_384) req.destroy(new Error("too large")); });
    req.on("end",  () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("invalid JSON")); } });
    req.on("error", reject);
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin":  "*",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(body));
}

function dbUnconfigured(res: http.ServerResponse): void {
  json(res, 503, { error: "MongoDB not configured. Set MONGODB_URI to enable this route." });
}

function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function decodeProfilePathId(url: string): string {
  return decodeURIComponent(url.slice("/profiles/".length).split("?")[0] ?? "");
}

function decodeGroupMembersPathId(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const match = /^\/groups\/([^/]+)\/members$/.exec(path);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

function toInitials(input: unknown): string {
  if (typeof input !== "string") return "NA";
  const trimmed = input.trim();
  if (!trimmed) return "NA";
  const fromWords = trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (fromWords.length >= 2) return fromWords;
  return trimmed.slice(0, 2).toUpperCase();
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}
