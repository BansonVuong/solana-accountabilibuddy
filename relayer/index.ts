// relayer/index.ts
//
// Env vars:
//   ORACLE_KEYPAIR    path to keypair JSON  (default ~/.config/solana/id.json)
//   SOLANA_RPC_URL    RPC endpoint           (default devnet)
//   PORT              HTTP port              (default 8787)
//   POLL_INTERVAL_MS  crank interval ms      (default 60_000)
//   MONGODB_URI       Mongo connection string (optional; enables data routes)
//   MONGODB_DB        Mongo database name     (default "accountabilibuddy")

import "dotenv/config";

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AnchorProvider, Program, Wallet, web3 } from "@anchor-lang/core";

import { fetchGameResult, fetchScoreboard, type Sport } from "./scraper";
import {
  isDbConfigured, groups, messages, bets, players, type MessageDoc,
} from "./db";
import idl from "../target/idl/accountability.json";
import type { Accountability } from "../target/types/accountability";

// ── config ───────────────────────────────────────────────────────────────────

const RPC_URL         = process.env.SOLANA_RPC_URL ?? web3.clusterApiUrl("devnet");
const ORACLE_KP_PATH  = process.env.ORACLE_KEYPAIR ?? "~/.config/solana/id.json";
const PORT            = Number(process.env.PORT ?? 8787);
const POLL_INTERVAL   = Number(process.env.POLL_INTERVAL_MS ?? 60_000);

const VAULT_SEED        = Buffer.from("vault");
const SPORTS_VAULT_SEED = Buffer.from("sports_vault");

// ── Solana setup ──────────────────────────────────────────────────────────────

const oracle   = loadKeypair(ORACLE_KP_PATH);
const connection = new web3.Connection(RPC_URL, "confirmed");
const provider   = new AnchorProvider(connection, new Wallet(oracle), AnchorProvider.defaultOptions());
const program    = new Program<Accountability>(idl as Accountability, provider);

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
      const col = await groups();
      if (!col) return dbUnconfigured(res);
      const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
      return json(res, 200, { groups: docs });
    }

    // GET /messages?group=1  — messages for a group (chronological)
    if (req.method === "GET" && req.url?.startsWith("/messages")) {
      const col = await messages();
      if (!col) return dbUnconfigured(res);
      const groupId = new URL(req.url, "http://x").searchParams.get("group") ?? "1";
      const docs = await col
        .find({ groupId }, { projection: { _id: 0 } })
        .sort({ createdAt: 1 })
        .toArray();
      return json(res, 200, { messages: docs });
    }

    // POST /messages  { groupId, sender, initials, text }  — append a chat message
    if (req.method === "POST" && req.url === "/messages") {
      const col = await messages();
      if (!col) return dbUnconfigured(res);
      const body = await readJson(req);
      if (typeof body.groupId !== "string" || typeof body.sender !== "string")
        return json(res, 400, { error: "groupId and sender are required" });
      const doc: MessageDoc = {
        id:        `m-${Date.now()}`,
        groupId:   body.groupId,
        sender:    body.sender,
        initials:  String(body.initials ?? body.sender).slice(0, 2).toUpperCase(),
        text:      typeof body.text === "string" ? body.text : undefined,
        system:    false,
        ts:        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        createdAt: Date.now(),
      };
      await col.insertOne(doc);
      const { ...out } = doc;
      return json(res, 201, { message: out });
    }

    // GET /bets  — all bets
    if (req.method === "GET" && req.url === "/bets") {
      const col = await bets();
      if (!col) return dbUnconfigured(res);
      const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
      return json(res, 200, { bets: docs });
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

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`relayer listening on http://localhost:${PORT}`);
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
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
