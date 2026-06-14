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
import { AnchorProvider, BN, Program, Wallet, web3 } from "@anchor-lang/core";

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
const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-only-insecure-auth-secret";
const AUTH_SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 30);
const IMESSAGE_DEEP_LINK_BASE = process.env.IMESSAGE_DEEP_LINK_BASE ?? "accountabilibuddy://bet";

// Custodial wallets + on-chain SOL bets.
//   WALLET_SECRET_KEY      encryption key for stored wallet secrets (falls back to AUTH_SECRET)
//   WALLET_AIRDROP_LAMPORTS devnet airdrop per new wallet (default 2 SOL)
//   SPORTS_BET_CREATE_WINDOW_SECS max lead time before kickoff to create a sports bet (default 24h)
//   SPORTS_BET_SCOREBOARD_LOOKAHEAD_DAYS how many future days to fetch for upcoming sports games (default 3)
//   SPORTS_BET_SETTLE_AFTER_SECS earliest settle-at offset after kickoff for sports bets (default 60s)
//   SOCIAL_BET_SETTLE_DELAY_SECS  delay before an accepted witness bet can settle (default 15s)
const WALLET_AIRDROP_LAMPORTS = Number(process.env.WALLET_AIRDROP_LAMPORTS ?? 2 * web3.LAMPORTS_PER_SOL);
const SPORTS_BET_CREATE_WINDOW_SECS = Number(process.env.SPORTS_BET_CREATE_WINDOW_SECS ?? 24 * 60 * 60);
const SPORTS_BET_SCOREBOARD_LOOKAHEAD_DAYS = Number(process.env.SPORTS_BET_SCOREBOARD_LOOKAHEAD_DAYS ?? 3);
const SPORTS_BET_SETTLE_AFTER_SECS = Number(process.env.SPORTS_BET_SETTLE_AFTER_SECS ?? 60);
// Witness bets escrow both stakes atomically at acceptance, so this only spans that
// single transaction. A posted witness bet itself never expires — it waits for a taker.
const SOCIAL_BET_SETTLE_DELAY_SECS = Number(
  process.env.SOCIAL_BET_SETTLE_DELAY_SECS ?? 15,
);
const SOCIAL_BET_SPORT        = 0; // reuse the sportsBet program; sport is irrelevant for chat bets
const BET_BALANCE_BUFFER_LAMPORTS = Number(
  process.env.BET_BALANCE_BUFFER_LAMPORTS ?? 0.02 * web3.LAMPORTS_PER_SOL,
);

const VAULT_SEED        = Buffer.from("vault");
const SPORTS_BET_SEED   = Buffer.from("sports_bet");
const SPORTS_VAULT_SEED = Buffer.from("sports_vault");
const SOCIAL_BET_SEED   = Buffer.from("social_bet");
const SOCIAL_VAULT_SEED = Buffer.from("social_vault");

// Standard Solana incinerator — burned lamports are unrecoverable.
const BURN_ADDRESS = new web3.PublicKey("1nc1nerator11111111111111111111111111111111");
const FALLBACK_KIND_CODE: Record<string, number> = { return: 0, burn: 1, charity: 2 };

const WALLET_ENC_KEY = deriveWalletKey();

// ── Solana setup ──────────────────────────────────────────────────────────────

const oracle   = loadKeypair(ORACLE_KP_PATH);
const connection = new web3.Connection(RPC_URL, "confirmed");
const provider   = new AnchorProvider(connection, new Wallet(oracle), AnchorProvider.defaultOptions());
const program    = new Program<Accountability>(idl as Accountability, provider);
const profileWallet = parsePublicKey(process.env.PROFILE_WALLET, oracle.publicKey);

// ── custodial wallets ───────────────────────────────────────────────────────────
// Each user gets a relayer-managed devnet keypair. The secret is stored encrypted;
// the relayer signs create/accept on the user's behalf (settle is signed by the oracle).

function deriveWalletKey(): Buffer {
  const raw = process.env.WALLET_SECRET_KEY;
  if (raw && raw.length > 0) return crypto.createHash("sha256").update(raw).digest();
  console.warn("WALLET_SECRET_KEY not set; deriving custodial wallet key from AUTH_SECRET");
  return crypto.createHash("sha256").update(`wallet:${AUTH_SECRET}`).digest();
}

function encryptSecret(plain: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", WALLET_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptSecret(stored: string): Buffer {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("malformed wallet secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", WALLET_ENC_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
}

function loadUserKeypair(user: UserDoc): web3.Keypair {
  if (!user.walletSecret) throw new Error(`user ${user.username} has no custodial wallet`);
  return web3.Keypair.fromSecretKey(Uint8Array.from(decryptSecret(user.walletSecret)));
}

const isDevnet = /devnet/i.test(RPC_URL);

async function airdrop(pubkey: web3.PublicKey, lamports: number): Promise<void> {
  if (!isDevnet || lamports <= 0) return;
  const sig = await connection.requestAirdrop(pubkey, lamports);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  console.log(`airdropped ${lamports / web3.LAMPORTS_PER_SOL} SOL to ${pubkey.toBase58()}`);
}


/** Provision (and devnet-fund) a custodial wallet on first need; mutates `user`. */
async function ensureUserWallet(user: UserDoc): Promise<web3.Keypair> {
  if (user.walletPubkey && user.walletSecret) return loadUserKeypair(user);
  const col = await users();
  if (!col) throw new Error("database unavailable");
  const kp = web3.Keypair.generate();
  user.walletPubkey = kp.publicKey.toBase58();
  user.walletSecret = encryptSecret(Buffer.from(kp.secretKey));
  await col.updateOne({ id: user.id }, { $set: { walletPubkey: user.walletPubkey, walletSecret: user.walletSecret } });
  await airdrop(kp.publicKey, WALLET_AIRDROP_LAMPORTS).catch((err) =>
    console.warn(`airdrop failed for ${user.walletPubkey}:`, err instanceof Error ? err.message : err),
  );
  return kp;
}

/** A Program bound to `keypair` as fee-payer/signer (the oracle `program` settles). */
function programAs(keypair: web3.Keypair): Program<Accountability> {
  const prov = new AnchorProvider(connection, new Wallet(keypair), AnchorProvider.defaultOptions());
  return new Program<Accountability>(idl as Accountability, prov);
}

// ── on-chain chat-bet (reuses the sportsBet escrow) ─────────────────────────────

function gameIdBytes(id: string): number[] {
  if (Buffer.byteLength(id, "utf8") > 32) throw new Error("bet id too long for on-chain game id");
  const buf = Buffer.alloc(32);
  Buffer.from(id, "utf8").copy(buf);
  return Array.from(buf);
}

function sportsBetPda(creator: web3.PublicKey, gameId: number[]): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [SPORTS_BET_SEED, creator.toBuffer(), Buffer.from(gameId)],
    program.programId,
  )[0];
}

function sportsVaultPda(bet: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync([SPORTS_VAULT_SEED, bet.toBuffer()], program.programId)[0];
}

function socialBetPda(challenger: web3.PublicKey, betId: number[]): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [SOCIAL_BET_SEED, challenger.toBuffer(), Buffer.from(betId)],
    program.programId,
  )[0];
}

function socialVaultPda(bet: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync([SOCIAL_VAULT_SEED, bet.toBuffer()], program.programId)[0];
}

function solStakeToLamports(stake: string): number {
  const n = Number(stake);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid SOL stake");
  const lamports = Math.round(n * web3.LAMPORTS_PER_SOL);
  if (lamports <= 0) throw new Error("SOL stake too small");
  return lamports;
}

class InsufficientSolBalanceError extends Error {
  constructor(
    public readonly actor: "challenger" | "acceptor",
    public readonly availableLamports: number,
    public readonly requiredLamports: number,
  ) {
    super(
      `${actor} has insufficient SOL: requires ${formatSol(requiredLamports)} SOL, available ${formatSol(availableLamports)} SOL`,
    );
    this.name = "InsufficientSolBalanceError";
  }
}

function formatSol(lamports: number): string {
  return (lamports / web3.LAMPORTS_PER_SOL).toFixed(4);
}
async function currentUnixTimeSec(): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

function isSportsBetWithinCreateWindow(startTimeSec: number, nowSec: number): boolean {
  if (startTimeSec <= nowSec) return false;
  return (startTimeSec - nowSec) <= SPORTS_BET_CREATE_WINDOW_SECS;
}

async function requireSolBalanceForBet(
  pubkey: web3.PublicKey,
  amountLamports: number,
  actor: "challenger" | "acceptor",
): Promise<void> {
  const requiredLamports = amountLamports + BET_BALANCE_BUFFER_LAMPORTS;
  const availableLamports = await connection.getBalance(pubkey, "confirmed");
  if (availableLamports < requiredLamports) {
    throw new InsufficientSolBalanceError(actor, availableLamports, requiredLamports);
  }
}

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

const SUPPORTED_SPORTS: Sport[] = ["soccer", "nba", "nfl", "nhl"];
// On-chain program currently allows sport ids 0..2 only. NHL shares id=2; the
// Mongo bet document keeps the true source sport for settlement lookups.
const ON_CHAIN_SPORT_BY_INDEX: Record<number, Exclude<Sport, "nhl">> = {
  0: "soccer",
  1: "nba",
  2: "nfl",
};
const ON_CHAIN_SPORT_INDEX: Record<Sport, number> = {
  soccer: 0,
  nba: 1,
  nfl: 2,
  nhl: 2,
};
type BetVoteChoice = "challenger" | "acceptor";

function isSupportedSport(value: unknown): value is Sport {
  return typeof value === "string" && SUPPORTED_SPORTS.includes(value as Sport);
}

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

type BetPresentationStatus = "pending" | "active" | "completed";

function getBetResolvedWinner(doc: BetDoc): BetVoteChoice | undefined {
  const normalized = normalizeBetDoc(doc);
  if (normalized.status === "PENDING") return undefined;
  if (normalized.resolvedWinner) return normalized.resolvedWinner;
  const votes = countBetVotes(normalized.votesByVoter ?? {});
  const threshold = Math.max(1, Number(normalized.witnesses) || 1);
  if (votes.challenger >= threshold) return "challenger";
  if (votes.acceptor >= threshold) return "acceptor";
  return undefined;
}

function getBetPresentationStatus(doc: BetDoc): BetPresentationStatus {
  const normalized = normalizeBetStatus(doc.status);
  if (normalized === "PENDING") return "pending";
  if (normalized === "ACTIVE") return "active";
  return "completed";
}

function getOnChainStateLabel(state?: BetDoc["onChainState"]): string {
  switch (state) {
    case "open": return "ESCROW OPEN · awaiting match";
    case "locked": return "LOCKED IN ESCROW · on-chain";
    case "settled": return "PAID OUT ON-CHAIN";
    case "cancelled": return "REFUNDED · window expired";
    default: return "ON-CHAIN ESCROW";
  }
}

function buildIMessageBetDeepLink(betId: string): string {
  const base = IMESSAGE_DEEP_LINK_BASE.endsWith("/")
    ? IMESSAGE_DEEP_LINK_BASE.slice(0, -1)
    : IMESSAGE_DEEP_LINK_BASE;
  return `${base}/${encodeURIComponent(betId)}`;
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
    sport:            ON_CHAIN_SPORT_BY_INDEX[bet.sport as number] ?? "soccer",
    gameId:           decodeGameId(bet.gameId),
    creatorBacksHome: bet.creatorBacksHome,
    startTime:        bet.startTime.toNumber(),
    settleAfter:      bet.settleAfter.toNumber(),
    state,
  };
}

// ── sports bet crank (sports-feed powered) ───────────────────────────────────

async function crankSportsBets(): Promise<void> {
  const slot = await connection.getSlot("confirmed");
  const now  = await connection.getBlockTime(slot);
  if (now === null) return;

  const onChainBets = await program.account.sportsBet.all();
  const betsCol = await bets();

  for (const { publicKey: betPubkey, account: bet } of onChainBets) {
    if (!("locked" in bet.state)) continue;
    if (bet.settleAfter.toNumber() > now) continue;
    if (!bet.oraclePubkey.equals(oracle.publicKey)) continue;
    if (!bet.opponent) continue;

    // Decode game_id ([u8; 32], zero-padded) back to a string
    const gameId = decodeGameId(bet.gameId);

    // Chat bets reuse this escrow but store a non-numeric bet id as the game id and
    // are settled from witness votes by crankWitnessBets — never from sports feeds.
    if (!/^\d+$/.test(gameId)) continue;
    // sport is stored on-chain as a u8 enum (0=soccer, 1=nba, 2=nfl), but the
    // linked bet doc can override this (e.g. NHL shares enum id=2).
    let sport: Sport = ON_CHAIN_SPORT_BY_INDEX[bet.sport as number] ?? "soccer";
    if (betsCol) {
      const linkedBet = await betsCol.findOne(
        { betPda: betPubkey.toBase58() },
        { projection: { _id: 0, validation: 1, sport: 1 } },
      );
      if (linkedBet?.validation === "sports" && isSupportedSport(linkedBet.sport)) {
        sport = linkedBet.sport;
      }
    }

    let result;
    try {
      result = await fetchGameResult(sport, gameId);
    } catch (err) {
      console.error(`sports data fetch error for game ${gameId} (${sport}):`, err);
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

      // Mirror the on-chain result back to the chat bet doc so the UI updates.
      // The challenger is the on-chain creator; they back home iff creatorBacksHome.
      if (betsCol) {
        const resolvedWinner =
          result.homeWon === null
            ? undefined
            : bet.creatorBacksHome === result.homeWon
              ? "challenger"
              : "acceptor";
        await betsCol.updateOne(
          { betPda: betPubkey.toBase58() },
          { $set: {
            status: "COMPLETED",
            onChainState: "settled",
            settleSig: sig,
            ...(resolvedWinner ? { resolvedWinner } : {}),
          } },
        );
      }
    } catch (err) {
      console.error(`settle failed for ${betPubkey.toBase58()}:`, err);
    }
  }
}

// ── chat-bet crank (witness-vote settled) ──────────────────────────────────────
// Settles on-chain SOL chat bets from their off-chain resolution: pays the winner
// once both sides have staked (Locked) and a witness quorum picked a side, and
// refunds the creator if the accept window lapses with no opponent.

async function crankWitnessBets(): Promise<void> {
  const betsCol = await bets();
  const usersCol = await users();
  if (!betsCol || !usersCol) return;

  const slot = await connection.getSlot("confirmed");
  const now = await connection.getBlockTime(slot);
  if (now === null) return;

  const docs = await betsCol
    .find({ onChain: true, onChainState: { $in: ["open", "locked"] } }, { projection: { _id: 0 } })
    .toArray();

  for (const doc of docs) {
    const bet = normalizeBetDoc(doc);
    if (!bet.betPda) continue;
    const betPubkey = new web3.PublicKey(bet.betPda);

    let acct: Awaited<ReturnType<typeof program.account.sportsBet.fetch>>;
    try {
      acct = await program.account.sportsBet.fetch(betPubkey);
    } catch {
      continue; // already closed (settled/cancelled) on-chain
    }
    const vault = sportsVaultPda(betPubkey);

    if ("locked" in acct.state) {
      // Sports bets are settled from sports feeds by crankSportsBets, not votes.
      if (bet.validation === "sports") continue;
      if (!bet.resolvedWinner || !acct.opponent) continue;
      if (acct.settleAfter.toNumber() > now) continue;
      // creator backs "home"/challenger, so home_won === challenger won.
      const homeWon = bet.resolvedWinner === "challenger";
      try {
        const sig = await program.methods
          .settleBet(homeWon)
          .accountsStrict({
            oracle: oracle.publicKey,
            creator: acct.creator,
            opponent: acct.opponent,
            sportsBet: betPubkey,
            vault,
          })
          .rpc();
        await betsCol.updateOne(
          { id: bet.id },
          { $set: { settleSig: sig, onChainState: "settled", status: "COMPLETED" } },
        );
        console.log(`settled chat bet ${bet.id} (winner=${bet.resolvedWinner}): ${sig}`);
      } catch (err) {
        console.error(`settle failed for chat bet ${bet.id}:`, err);
      }
    } else if ("open" in acct.state) {
      // Accept window elapsed with no opponent — refund the creator and close out.
      if (acct.startTime.toNumber() > now) continue;
      const challengerUser = await usersCol.findOne({ usernameLower: bet.challenger.toLowerCase() });
      if (!challengerUser?.walletSecret) continue;
      try {
        const sig = await programAs(loadUserKeypair(challengerUser))
          .methods.cancelBet()
          .accountsStrict({ creator: acct.creator, sportsBet: betPubkey, vault })
          .rpc();
        await betsCol.updateOne(
          { id: bet.id },
          { $set: { onChainState: "cancelled", status: "COMPLETED", createSig: bet.createSig ?? sig } },
        );
        console.log(`refunded expired chat bet ${bet.id}: ${sig}`);
      } catch (err) {
        console.error(`refund failed for chat bet ${bet.id}:`, err);
      }
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
      await ensureUserWallet(user).catch((err) =>
        console.warn("wallet provisioning failed on signup:", err instanceof Error ? err.message : err),
      );
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
      await ensureUserWallet(user).catch((err) =>
        console.warn("wallet provisioning failed on login:", err instanceof Error ? err.message : err),
      );
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
      let wallet = profileWallet;
      if (authUser) {
        await ensureUserWallet(authUser).catch((err) =>
          console.warn("wallet provisioning failed on profile:", err instanceof Error ? err.message : err),
        );
        if (authUser.walletPubkey) wallet = new web3.PublicKey(authUser.walletPubkey);
      }
      const solBalance = await connection
        .getBalance(wallet, "confirmed")
        .then((lamports) => lamports / web3.LAMPORTS_PER_SOL)
        .catch((err) => {
          console.error("failed to fetch SOL balance:", err);
          return 0;
        });
      return json(res, 200, {
        name: authUser?.username ?? PROFILE_NAME,
        initials: authUser ? toInitials(authUser.username) : PROFILE_INITIALS,
        github: authUser?.username ?? PROFILE_GITHUB,
        wallet: wallet.toBase58(),
        solBalance,
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

    // GET /scoreboard?sport=nba|nfl|nhl|soccer[&league=epl|laliga|mls|<leagueId>]
    // Returns upcoming games currently in the sports-bet creation window.
    if (req.method === "GET" && req.url?.startsWith("/scoreboard")) {
      const params = new URL(req.url, "http://x").searchParams;
      const sport  = (params.get("sport") ?? "nba") as Sport;
      const league = params.get("league") ?? undefined;
      if (!isSupportedSport(sport))
        return json(res, 400, { error: "sport must be soccer | nba | nfl | nhl" });
      const nowMs = Date.now();
      const betWindowEndMs = nowMs + SPORTS_BET_CREATE_WINDOW_SECS * 1000;
      const scrapedGames = await fetchScoreboard(sport, league, {
        daysAhead: SPORTS_BET_SCOREBOARD_LOOKAHEAD_DAYS,
        includeStarted: false,
        maxGames: 120,
      });
      const games = scrapedGames
        .filter((game) => !game.isFinal)
        .filter((game): game is typeof game & { startTimeMs: number } => typeof game.startTimeMs === "number")
        .filter((game) => game.startTimeMs <= betWindowEndMs);
      return json(res, 200, {
        sport,
        league: league ?? null,
        games,
        bettingWindowSeconds: SPORTS_BET_CREATE_WINDOW_SECS,
      });
    }

    // GET /game?sport=nba&id=401584793  — check one game's result
    if (req.method === "GET" && req.url?.startsWith("/game")) {
      const params = new URL(req.url, "http://x").searchParams;
      const sport  = (params.get("sport") ?? "nba") as Sport;
      const gameId = params.get("id") ?? "";
      if (!gameId) return json(res, 400, { error: "id is required" });
      if (!isSupportedSport(sport)) {
        return json(res, 400, { error: "sport must be soccer | nba | nfl | nhl" });
      }
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
    // GET /imessage/deeplink?betId=...    -> canonical deep-link URL
    // GET /imessage/deeplink?url=...      -> extract betId from a deep-link URL
    if (req.method === "GET" && req.url?.startsWith("/imessage/deeplink")) {
      const params = new URL(req.url, "http://x").searchParams;
      const betId = params.get("betId");
      const rawUrl = params.get("url");
      if (betId && betId.trim()) {
        return json(res, 200, {
          betId: betId.trim(),
          url: buildIMessageBetDeepLink(betId.trim()),
        });
      }
      if (rawUrl && rawUrl.trim()) {
        return json(res, 200, {
          betId: parseIMessageBetDeepLink(rawUrl),
        });
      }
      return json(res, 400, { error: "provide either betId or url query param" });
    }

    // POST /imessage/participants/link { participantId }
    // Links the current account to the opaque identifier supplied by Messages.framework.
    if (req.method === "POST" && req.url === "/imessage/participants/link") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const col = await users();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      const participantId = normalizeIMessageParticipantId(body.participantId);
      if (!participantId) return json(res, 400, { error: "valid participantId is required" });

      const claimed = await col.findOne(
        { imessageParticipantIds: participantId, id: { $ne: authUser.id } },
        { projection: { username: 1 } },
      );
      if (claimed) return json(res, 409, { error: "this Messages identity is linked to another account" });

      await col.updateOne(
        { id: authUser.id },
        { $addToSet: { imessageParticipantIds: participantId } },
      );
      return json(res, 200, { linked: true, username: authUser.username });
    }

    // POST /imessage/participants/resolve { participantIds: string[] }
    if (req.method === "POST" && req.url === "/imessage/participants/resolve") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const col = await users();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      const rawIds = Array.isArray(body.participantIds) ? body.participantIds.slice(0, 50) : [];
      const participantIds = Array.from(new Set(rawIds.map(normalizeIMessageParticipantId).filter((id): id is string => Boolean(id))));
      if (!participantIds.length) return json(res, 200, { participants: [] });

      const docs = await col.find(
        { imessageParticipantIds: { $in: participantIds } },
        { projection: { _id: 0, username: 1, imessageParticipantIds: 1 } },
      ).toArray();
      const participants = participantIds.flatMap((participantId) => {
        const user = docs.find((doc) => doc.imessageParticipantIds?.includes(participantId));
        return user ? [{ participantId, username: user.username }] : [];
      });
      return json(res, 200, { participants });
    }

    // GET /imessage/bets/:id  — compact, iMessage-friendly card payload
    const imessageBetPathId = req.url ? decodeIMessageBetPathId(req.url) : null;
    if (req.method === "GET" && imessageBetPathId) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const lookup = await loadAuthorizedBetForUser(authUser, imessageBetPathId);
      if ("error" in lookup) return json(res, lookup.status, { error: lookup.error });
      return json(res, 200, {
        card: toIMessageBetCard(authUser.username, lookup.bet, lookup.group),
      });
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
        .find({}, { projection: { _id: 0 } })
        .toArray();
      const visibleGroups = docs.filter((group) => isGroupMember(group, authUser.username));
      return json(res, 200, { groups: visibleGroups });
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
        time: formatChatClock(now),
        updatedAt: now,
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
      const now = Date.now();
      const nowLabel = formatChatClock(now);
      await groupsCol.updateOne(
        { id: groupMembersPathId },
        {
          $set: {
            memberUsernames: nextMemberUsernames,
            members: nextMembers,
            lastMsg: `${user.username} joined the group`,
            time: nowLabel,
            updatedAt: now,
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
      const now = Date.now();
      const doc: MessageDoc = {
        id:        `m-${now}`,
        groupId:   body.groupId,
        sender:    authUser.username,
        initials:  toInitials(authUser.username),
        text:      typeof body.text === "string" ? body.text : undefined,
        system:    false,
        ts:        formatChatClock(now),
        createdAt: now,
      };
      await messagesCol.insertOne(doc);
      await groupsCol.updateOne(
        { id: body.groupId },
        { $set: { lastMsg: doc.text ?? "New message", time: doc.ts, updatedAt: now } },
      );
      const { ...out } = doc;
      return json(res, 201, { message: out });
    }

    // POST /bets  { groupId?, source?, type, acceptor, terms, stake, currency, witnesses?, minBettors? }
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
      const isIMessage = body.source === "imessage";
      const type = body.type === "PERSONAL" || body.type === "DEV" ? body.type : null;
      const challenger = authUser.username;
      const acceptorInput = typeof body.acceptor === "string" ? body.acceptor.trim() : "";
      let terms = typeof body.terms === "string" ? body.terms.trim() : "";
      const stakeInput = typeof body.stake === "string" ? body.stake.trim() : `${body.stake ?? ""}`.trim();
      // All bets are on-chain SOL now.
      const currency = "SOL";

      // DEV "sports" bets are settled by sports feed data rather than witness votes.
      // They carry a sport + numeric event id + which side the challenger backs.
      const isSports = type === "DEV" && typeof body.sport === "string" && body.sport.length > 0;
      const sport = isSports ? (body.sport as Sport) : null;
      const sportsGameId = isSports ? `${body.gameId ?? ""}`.trim() : "";
      const challengerBacksHome = isSports ? body.backsHome !== false : undefined;
      let homeTeam = isSports ? `${body.homeTeam ?? ""}`.trim() : undefined;
      let awayTeam = isSports ? `${body.awayTeam ?? ""}`.trim() : undefined;
      let sportsKickoffSec: number | null = null;

      if (!isIMessage && !groupId) return json(res, 400, { error: "groupId is required" });
      if (!type) return json(res, 400, { error: "type must be PERSONAL or DEV" });
      if (type === "DEV" && !isSports) {
        return json(res, 400, { error: "DEV bets are sports bets now; include sport and gameId" });
      }
      const acceptor = type === "DEV" ? (acceptorInput || "anyone") : acceptorInput;
      if (!acceptor) return json(res, 400, { error: "acceptor is required" });
      if (acceptorInput && acceptorInput.toLowerCase() === challenger.toLowerCase()) {
        return json(res, 400, { error: "you cannot challenge yourself" });
      }
      if (!isSports && terms.length < 8) return json(res, 400, { error: "terms must be at least 8 characters" });
      const numericStake = Number(stakeInput);
      if (!stakeInput || !Number.isFinite(numericStake) || numericStake <= 0) {
        return json(res, 400, { error: "stake must be a positive number" });
      }
      const amountLamports = solStakeToLamports(stakeInput);
      if (isSports) {
        if (!isSupportedSport(sport)) {
          return json(res, 400, { error: "sport must be soccer | nba | nfl | nhl" });
        }
        const sportsSport = sport;
        // crankSportsBets only settles bets whose on-chain game id is numeric.
        if (!/^\d+$/.test(sportsGameId)) {
          return json(res, 400, { error: "gameId must be a numeric TheSportsDB event id" });
        }
        let upcomingGames: Awaited<ReturnType<typeof fetchScoreboard>> = [];
        try {
          upcomingGames = await fetchScoreboard(sportsSport, undefined, {
            daysAhead: SPORTS_BET_SCOREBOARD_LOOKAHEAD_DAYS,
            includeStarted: true,
            maxGames: 200,
          });
        } catch (err) {
          return json(res, 502, {
            error: `failed to fetch upcoming games: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        const selectedGame = upcomingGames.find((game) => game.gameId === sportsGameId);
        if (!selectedGame) {
          return json(res, 400, { error: "selected game is not available on the upcoming board" });
        }
        if (selectedGame.isFinal) {
          return json(res, 400, { error: "selected game is already final" });
        }
        if (typeof selectedGame.startTimeMs !== "number" || !Number.isFinite(selectedGame.startTimeMs)) {
          return json(res, 400, { error: "selected game kickoff time is unavailable" });
        }
        const chainNowSec = await currentUnixTimeSec();
        const kickoffSec = Math.floor(selectedGame.startTimeMs / 1000);
        if (kickoffSec <= chainNowSec) {
          return json(res, 400, { error: "selected game has already started" });
        }
        if (!isSportsBetWithinCreateWindow(kickoffSec, chainNowSec)) {
          return json(res, 400, {
            error: "sports bets can only be created within 24 hours before kickoff",
          });
        }
        sportsKickoffSec = kickoffSec;
        homeTeam = selectedGame.homeTeam?.trim() || homeTeam;
        awayTeam = selectedGame.awayTeam?.trim() || awayTeam;
        if (!homeTeam || !awayTeam) {
          return json(res, 400, { error: "selected game teams are unavailable" });
        }
        if (terms.length < 8) {
          const backedTeam = challengerBacksHome ? homeTeam : awayTeam;
          terms = `${sportsSport.toUpperCase()}: ${awayTeam} @ ${homeTeam} — ${challenger} backs ${backedTeam}.`;
        }
      }
      if (terms.length < 8) {
        return json(res, 400, { error: "terms must be at least 8 characters" });
      }

      const group = groupId
        ? await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } })
        : null;
      if (!isIMessage && !group) return json(res, 404, { error: "group not found" });
      if (!isIMessage && group && !isGroupMember(group, authUser.username)) {
        return json(res, 403, { error: "group membership required" });
      }
      let challengerKp: web3.Keypair;
      try {
        challengerKp = await ensureUserWallet(authUser);
        await requireSolBalanceForBet(challengerKp.publicKey, amountLamports, "challenger");
      } catch (err) {
        if (err instanceof InsufficientSolBalanceError) {
          return json(res, 400, { error: err.message });
        }
        return json(res, 502, {
          error: `failed to verify challenger SOL balance: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const now = Date.now();
      const ts = formatChatClock(now);
      const witnesses = isIMessage ? 1 : Math.max(1, Math.floor(toFiniteNumber(body.witnesses, 1)));
      const minBettors = isIMessage ? 2 : Math.max(1, Math.floor(toFiniteNumber(body.minBettors, 2)));
      const groupSize = isIMessage ? 2 : Math.max(1, Math.floor(toFiniteNumber(group?.members, 1)));

      // Witness bets (non-sports) carry a resolve-by deadline, an optional accept-by
      // deadline (indefinite when omitted), and a precommitted unresolved fallback.
      let witnessFields: Partial<BetDoc> = {};
      if (!isSports) {
        const resolveByDate = toFiniteNumber(
          body.resolveByDate,
          isIMessage ? now + 7 * 24 * 60 * 60 * 1000 : 0,
        );
        if (!resolveByDate || resolveByDate <= now) {
          return json(res, 400, { error: "resolveByDate (a future time) is required" });
        }
        const acceptByRaw = body.acceptByDate;
        const acceptByDate = acceptByRaw === null || acceptByRaw === undefined
          ? null
          : isFiniteNumber(acceptByRaw) ? acceptByRaw : NaN;
        if (typeof acceptByDate === "number" && Number.isNaN(acceptByDate)) {
          return json(res, 400, { error: "acceptByDate must be a number or null (indefinite)" });
        }
        if (acceptByDate !== null && acceptByDate <= now) {
          return json(res, 400, { error: "acceptByDate must be in the future or indefinite" });
        }
        if (acceptByDate !== null && acceptByDate > resolveByDate) {
          return json(res, 400, { error: "acceptByDate must be on or before resolveByDate" });
        }
        const fallbackKind: BetDoc["fallbackKind"] =
          body.fallbackKind === "burn" || body.fallbackKind === "charity" ? body.fallbackKind : "return";
        let fallbackDest = BURN_ADDRESS.toBase58();
        let charityName: string | undefined;
        if (fallbackKind === "charity") {
          const addr = typeof body.charityAddress === "string" ? body.charityAddress.trim() : "";
          try {
            fallbackDest = new web3.PublicKey(addr).toBase58();
          } catch {
            return json(res, 400, { error: "a valid charity address is required" });
          }
          charityName = typeof body.charityName === "string" && body.charityName.trim()
            ? body.charityName.trim()
            : undefined;
        }
        witnessFields = { acceptByDate, resolveByDate, fallbackKind, fallbackDest, charityName };
      }

      const betDoc: BetDoc = {
        id: `bet-${now}-${crypto.randomBytes(3).toString("hex")}`,
        ...(isIMessage ? { source: "imessage" as const } : { groupId }),
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
        ...(isSports ? {
          validation: "sports" as const,
          sport: sport as BetDoc["sport"],
          espnGameId: sportsGameId,
          homeTeam,
          awayTeam,
          challengerBacksHome,
        } : {}),
        ...witnessFields,
      };
      await betsCol.insertOne(betDoc);

      // Sports bets escrow the challenger's stake at post time and must be accepted
      // before kickoff (an acceptor after the result is known would be unfair). Witness
      // bets escrow nothing yet — they stay PENDING and wait indefinitely for a taker;
      // both stakes are escrowed atomically when someone accepts (see POST /bets/accept).
      if (isSports) {
        try {
          if (!sportsKickoffSec) {
            return json(res, 500, { error: "sports bet kickoff was not resolved" });
          }
          const startTime = sportsKickoffSec;
          const settleAfter = startTime + Math.max(1, SPORTS_BET_SETTLE_AFTER_SECS);
          // Sports bets store the real numeric event id so crankSportsBets settles them.
          const onChainSport = ON_CHAIN_SPORT_INDEX[sport as Sport];
          const backsHome    = challengerBacksHome ?? true;
          const gid = gameIdBytes(sportsGameId);
          const betPda = sportsBetPda(challengerKp.publicKey, gid);
          const vault = sportsVaultPda(betPda);
          const sig = await programAs(challengerKp)
            .methods.createBet(
              new BN(amountLamports),
              oracle.publicKey,
              onChainSport,
              gid,
              backsHome, // creator (challenger) backs home/challenger side
              new BN(startTime),
              new BN(settleAfter),
            )
            .accountsStrict({
              creator: challengerKp.publicKey,
              sportsBet: betPda,
              vault,
              systemProgram: web3.SystemProgram.programId,
            })
            .rpc();
          Object.assign(betDoc, {
            onChain: true,
            betPda: betPda.toBase58(),
            commitmentId: betPda.toBase58(),
            startTime,
            settleAfter,
            onChainState: "open" as const,
            createSig: sig,
          });
          await betsCol.updateOne({ id: betDoc.id }, { $set: {
            onChain: true, betPda: betDoc.betPda, commitmentId: betDoc.commitmentId,
            startTime, settleAfter, onChainState: "open", createSig: sig,
          } });
        } catch (err) {
          await betsCol.deleteOne({ id: betDoc.id });
          if (err instanceof InsufficientSolBalanceError) {
            return json(res, 400, { error: err.message });
          }
          return json(res, 502, {
            error: `failed to escrow SOL on-chain: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (isIMessage) {
        return json(res, 201, { bet: normalizeBetDoc(betDoc) });
      }

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
            lastMsg: `${challenger} posted a new ${isSports ? "sports" : type === "DEV" ? "dev" : "personal"} bet`,
            time: ts,
            updatedAt: now,
          },
        },
      );

      return json(res, 201, { bet: normalizeBetDoc(betDoc), message: systemMessage });
    }

    // POST /bets/accept  { betId }  — intended opponent accepts and activates a pending bet
    if (req.method === "POST" && req.url === "/bets/accept") {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) return json(res, 401, { error: "unauthorized" });
      const betsCol = await bets();
      const groupsCol = await groups();
      const messagesCol = await messages();
      if (!betsCol || !groupsCol || !messagesCol) return dbUnconfigured(res);

      const body = await readJson(req);
      const betId = typeof body.betId === "string" ? body.betId.trim() : "";
      if (!betId) return json(res, 400, { error: "betId is required" });

      const existing = await betsCol.findOne({ id: betId }, { projection: { _id: 0 } });
      if (!existing) return json(res, 404, { error: "bet not found" });
      const bet = normalizeBetDoc(existing);
      if (bet.status !== "PENDING") {
        return json(res, 409, { error: "bet is no longer open for acceptance", bet });
      }

      const linkedMessage = bet.groupId ? null : await messagesCol.findOne({ betId }, { projection: { groupId: 1 } });
      const groupId = bet.groupId ?? linkedMessage?.groupId;
      const group = groupId ? await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } }) : null;
      if (bet.source !== "imessage" && (!group || !isGroupMember(group, authUser.username))) {
        return json(res, 403, { error: "group membership required" });
      }
      if (authUser.username.toLowerCase() === bet.challenger.toLowerCase()) {
        return json(res, 400, { error: "you cannot accept your own bet" });
      }
      const addressed = bet.acceptor && bet.acceptor.toLowerCase() !== "anyone";
      if (addressed && bet.acceptor.toLowerCase() !== authUser.username.toLowerCase()) {
        return json(res, 403, { error: "this bet is addressed to someone else" });
      }

      const acceptedAt = Date.now();
      const update: Partial<BetDoc> = {
        status: "ACTIVE",
        opponentUsername: authUser.username,
        acceptedBy: authUser.username,
        acceptedAt,
      };
      // "anyone" DEV bets adopt the actual acceptor so the card shows who accepted.
      if (!addressed) update.acceptor = authUser.username;

      const usersCol = await users();
      if (!usersCol) return dbUnconfigured(res);

      try {
        const amountLamports = solStakeToLamports(bet.stake);
        const acceptorKp = await ensureUserWallet(authUser);
        await requireSolBalanceForBet(acceptorKp.publicKey, amountLamports, "acceptor");

        if (bet.validation === "sports") {
          // Sports bets are escrowed at post time; the opponent just stakes the other
          // side, and the program enforces accept-before-kickoff.
          if (!bet.onChain || !bet.betPda || bet.onChainState !== "open") {
            return json(res, 409, { error: "this sports bet is no longer open for acceptance", bet });
          }
          const betPda = new web3.PublicKey(bet.betPda);
          const vault = sportsVaultPda(betPda);
          const sig = await programAs(acceptorKp)
            .methods.acceptBet()
            .accountsStrict({
              opponent: acceptorKp.publicKey,
              sportsBet: betPda,
              vault,
              systemProgram: web3.SystemProgram.programId,
            })
            .rpc();
          Object.assign(update, { onChainState: "locked", acceptSig: sig });
        } else {
          // Witness bets escrow BOTH stakes atomically here — nothing was on-chain while
          // the bet waited, so it never expired. The relayer signs for the (custodial)
          // challenger even though they posted the bet earlier.
          const challengerUser = await usersCol.findOne({ usernameLower: bet.challenger.toLowerCase() });
          if (!challengerUser) return json(res, 409, { error: "challenger account not found" });
          const challengerKp = await ensureUserWallet(challengerUser);
          await requireSolBalanceForBet(challengerKp.publicKey, amountLamports, "challenger");

          const gid = gameIdBytes(bet.id);
          const betPda = sportsBetPda(challengerKp.publicKey, gid);
          const vault = sportsVaultPda(betPda);

          // Base timestamps on the chain clock (avoids skew); the accept window only has
          // to span this single atomic transaction.
          const slot = await connection.getSlot("confirmed");
          const base = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
          const startTime = base + SOCIAL_BET_SETTLE_DELAY_SECS;
          const settleAfter = startTime + 1;

          const createIx = await programAs(challengerKp)
            .methods.createBet(
              new BN(amountLamports),
              oracle.publicKey,
              SOCIAL_BET_SPORT,
              gid,
              true, // challenger backs the "home"/challenger side
              new BN(startTime),
              new BN(settleAfter),
            )
            .accountsStrict({
              creator: challengerKp.publicKey,
              sportsBet: betPda,
              vault,
              systemProgram: web3.SystemProgram.programId,
            })
            .instruction();
          const acceptIx = await programAs(acceptorKp)
            .methods.acceptBet()
            .accountsStrict({
              opponent: acceptorKp.publicKey,
              sportsBet: betPda,
              vault,
              systemProgram: web3.SystemProgram.programId,
            })
            .instruction();

          const tx = new web3.Transaction().add(createIx, acceptIx);
          const sig = await web3.sendAndConfirmTransaction(connection, tx, [challengerKp, acceptorKp]);

          Object.assign(update, {
            onChain: true,
            betPda: betPda.toBase58(),
            commitmentId: betPda.toBase58(),
            startTime,
            settleAfter,
            onChainState: "locked",
            createSig: sig,
            acceptSig: sig,
          });
        }

        // The on-chain program already prevents a second acceptance (the PDA/state is
        // unique), so this just records the result.
        await betsCol.updateOne({ id: betId }, { $set: update });
        const updated = await betsCol.findOne({ id: betId }, { projection: { _id: 0 } });
        return json(res, 200, { bet: updated ? normalizeBetDoc(updated) : { ...bet, ...update } });
      } catch (err) {
        if (err instanceof InsufficientSolBalanceError) {
          return json(res, 400, { error: err.message });
        }
        return json(res, 502, {
          error: `failed to escrow SOL on-chain: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
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
        .find({}, { projection: { id: 1, memberUsernames: 1 } })
        .toArray();
      const groupIds = memberGroups
        .filter((group) => (
          Array.isArray(group.memberUsernames)
          && group.memberUsernames.some((member) => member.toLowerCase() === authUser.username.toLowerCase())
        ))
        .map((group) => group.id);
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
      const voterLower = voter.toLowerCase();
      const isParticipant = [
        current.challenger,
        current.acceptor,
        current.acceptedBy,
        current.opponentUsername,
      ].some(
        (name) => typeof name === "string" && name.trim().toLowerCase() === voterLower,
      );
      if (isParticipant) {
        return json(res, 403, {
          error: "bet participants cannot vote as witnesses",
          bet: current,
        });
      }
      if (current.validation === "sports") {
        return json(res, 409, {
          error: "sports bets are settled by the official sports feed result, not witness votes",
          bet: current,
        });
      }
      if (isBetCompletedStatus(current.status)) {
        return json(res, 409, { error: "bet is already completed", bet: current });
      }
      if (current.status !== "ACTIVE") {
        return json(res, 409, { error: "bet must be accepted before voting", bet: current });
      }
      // On-chain SOL bets can only be resolved once both sides have staked (locked).
      if (current.onChain && current.currency === "SOL" && current.onChainState !== "locked") {
        return json(res, 409, {
          error: "both sides must stake before this bet can be voted on",
          bet: current,
        });
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

    // GET /leaderboard  — players ranked by SOL balance
    if (req.method === "GET" && req.url === "/leaderboard") {
      const col = await players();
      if (!col) return dbUnconfigured(res);
      const docs = await col
        .find({}, { projection: { _id: 0 } })
        .sort({ sol: -1 })
        .toArray();
      return json(res, 200, { players: docs });
    }

    // GET /profiles  — all profile records
    if (req.method === "GET" && req.url === "/profiles") {
      const col = await profiles();
      if (!col) return dbUnconfigured(res);
      const docs = await col
        .find({}, { projection: { _id: 0 } })
        .sort({ sol: -1, updatedAt: -1 })
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
    await crankWitnessBets();
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
function formatChatClock(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function normalizeIMessageParticipantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const participantId = value.trim().toLowerCase();
  if (!participantId || participantId.length > 128) return null;
  return /^[a-z0-9-]+$/.test(participantId) ? participantId : null;
}

function toPublicUser(user: UserDoc): {
  id: string;
  email: string;
  username: string;
  initials: string;
  createdAt: number;
  walletPubkey?: string;
} {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    initials: toInitials(user.username),
    createdAt: user.createdAt,
    walletPubkey: user.walletPubkey,
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

type AuthorizedBetLookup =
  | { status: 200; bet: BetDoc; group: GroupDoc }
  | { status: number; error: string };

async function loadAuthorizedBetForUser(authUser: UserDoc, rawBetId: string): Promise<AuthorizedBetLookup> {
  const betId = rawBetId.trim();
  if (!betId) return { status: 400, error: "bet id is required" };

  const betsCol = await bets();
  const groupsCol = await groups();
  const messagesCol = await messages();
  if (!betsCol || !groupsCol || !messagesCol) {
    return { status: 503, error: "MongoDB not configured. Set MONGODB_URI to enable this route." };
  }

  const existing = await betsCol.findOne({ id: betId }, { projection: { _id: 0 } });
  if (!existing) return { status: 404, error: "bet not found" };
  const normalized = normalizeBetDoc(existing);
  if (normalized.source === "imessage") {
    return {
      status: 200,
      bet: normalized,
      group: {
        id: "imessage",
        name: "iMessage conversation",
        initials: "IM",
        members: 2,
        pendingBet: normalized.status === "PENDING",
        lastMsg: normalized.terms,
        time: "",
      },
    };
  }

  const linkedMessage = existing.groupId
    ? null
    : await messagesCol.findOne({ betId }, { projection: { groupId: 1 } });
  const groupId = existing.groupId ?? linkedMessage?.groupId;
  if (!groupId) return { status: 422, error: "bet is not linked to a group" };

  const group = await groupsCol.findOne({ id: groupId }, { projection: { _id: 0 } });
  if (!group) return { status: 404, error: "group not found" };
  if (!isGroupMember(group, authUser.username)) {
    return { status: 403, error: "group membership required" };
  }

  return { status: 200, bet: { ...normalized, groupId }, group };
}

function toIMessageBetCard(viewerUsername: string, bet: BetDoc, group: GroupDoc): Record<string, unknown> {
  const normalized = normalizeBetDoc(bet);
  const status = getBetPresentationStatus(normalized);
  const votesByVoter = normalized.votesByVoter ?? {};
  const votes = countBetVotes(votesByVoter);
  const witnessThreshold = Math.max(1, Number(normalized.witnesses) || 1);
  const winner = getBetResolvedWinner(normalized) ?? null;
  const winnerName = winner === "challenger"
    ? normalized.challenger
    : winner === "acceptor"
      ? normalized.acceptor
      : null;
  const isSports = normalized.validation === "sports";
  const viewerLower = viewerUsername.toLowerCase();
  const canAccept = status === "pending"
    && normalized.challenger.toLowerCase() !== viewerLower
    && (
      normalized.acceptor.toLowerCase() === viewerLower
      || normalized.acceptor.toLowerCase() === "anyone"
    );
  const canVote = normalized.source !== "imessage"
    && !isSports
    && status === "active"
    && !winner
    && !(normalized.onChain && normalized.currency === "SOL" && normalized.onChainState !== "locked");

  return {
    betId: normalized.id,
    group: {
      id: group.id,
      name: group.name,
    },
    type: normalized.type,
    status,
    statusLabel: status.toUpperCase(),
    terms: normalized.terms,
    stake: {
      amount: normalized.stake,
      currency: normalized.currency,
    },
    challenger: normalized.challenger,
    acceptor: normalized.acceptor,
    witnessesRequired: witnessThreshold,
    votes: {
      challenger: votes.challenger,
      acceptor: votes.acceptor,
      total: votes.total,
      byVoter: votesByVoter,
      myVote: votesByVoter[viewerUsername] ?? null,
    },
    winner,
    winnerName,
    validation: isSports ? "sports" : "witness",
    sports: isSports ? {
      sport: normalized.sport ?? null,
      gameId: normalized.espnGameId ?? null,
      homeTeam: normalized.homeTeam ?? null,
      awayTeam: normalized.awayTeam ?? null,
      challengerBacksHome: normalized.challengerBacksHome ?? null,
    } : null,
    onChain: {
      enabled: Boolean(normalized.onChain),
      state: normalized.onChainState ?? null,
      label: getOnChainStateLabel(normalized.onChainState),
      signatures: {
        create: normalized.createSig ?? null,
        accept: normalized.acceptSig ?? null,
        settle: normalized.settleSig ?? null,
      },
      explorer: {
        create: normalized.createSig ? explorerUrl(normalized.createSig) : null,
        accept: normalized.acceptSig ? explorerUrl(normalized.acceptSig) : null,
        settle: normalized.settleSig ? explorerUrl(normalized.settleSig) : null,
      },
    },
    actions: {
      canAccept,
      canVote,
      acceptEndpoint: "/bets/accept",
      voteEndpoint: "/bets/vote",
    },
    links: {
      deepLink: buildIMessageBetDeepLink(normalized.id),
    },
  };
}

function parseIMessageBetDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get("betId");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim();

    if (url.protocol === "accountabilibuddy:" && url.hostname === "bet") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? decodeURIComponent(id) : null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => part === "bet" || part === "bets");
    if (marker !== -1 && parts[marker + 1]) {
      return decodeURIComponent(parts[marker + 1]);
    }
    return null;
  } catch {
    return null;
  }
}

function decodeProfilePathId(url: string): string {
  return decodeURIComponent(url.slice("/profiles/".length).split("?")[0] ?? "");
}

function decodeIMessageBetPathId(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const match = /^\/imessage\/bets\/([^/]+)$/.exec(path);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
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
