// relayer/index.ts
//
// Env vars:
//   ORACLE_KEYPAIR    path to keypair JSON  (default ~/.config/solana/id.json)
//   SOLANA_RPC_URL    RPC endpoint           (default devnet)
//   PORT              HTTP port              (default 8787)
//   POLL_INTERVAL_MS  crank interval ms      (default 60_000)

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AnchorProvider, Program, Wallet, web3 } from "@anchor-lang/core";

import { fetchGameResult, fetchScoreboard, type Sport } from "./scraper";
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
    const raw    = Buffer.from(bet.gameId);
    const nullAt = raw.indexOf(0);
    const gameId = raw.slice(0, nullAt === -1 ? 32 : nullAt).toString("utf8");

    // sport is stored as a u8 enum: 0=soccer, 1=nba, 2=nfl
    const sportMap: Sport[] = ["soccer", "nba", "nfl"];
    const sport: Sport = sportMap[bet.sport as number] ?? "soccer";

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
    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ok: true,
        oracle:  oracle.publicKey.toBase58(),
        program: program.programId.toBase58(),
        rpc:     RPC_URL,
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

    // GET /scoreboard?sport=nba|nfl|soccer  — list today's games + IDs
    if (req.method === "GET" && req.url?.startsWith("/scoreboard")) {
      const sport = (new URL(req.url, "http://x").searchParams.get("sport") ?? "nba") as Sport;
      if (!["soccer", "nba", "nfl"].includes(sport))
        return json(res, 400, { error: "sport must be soccer | nba | nfl" });
      const games = await fetchScoreboard(sport);
      return json(res, 200, { sport, games });
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

    // POST /settle-bet  — manually trigger crank
    if (req.method === "POST" && req.url === "/settle-bet") {
      await crankSportsBets();
      return json(res, 200, { ok: true });
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

function json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
