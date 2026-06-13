// relayer/sports-bet.ts
//
// CLI helper for the 1v1 / group-chat sports bets settled by the ESPN oracle.
// The dashboard drives the same instructions from the user's wallet; this script
// is a convenient way to exercise the full lifecycle from the terminal.
//
// Usage (amounts in SOL; times are unix seconds, default derived from --in):
//
//   # Creator opens a bet backing the HOME team of an ESPN game.
//   ts-node relayer/sports-bet.ts create \
//     --sport nba --game 401584793 --side home --amount 0.1 \
//     --start <unixKickoff> --settle <unixGameEnd>
//
//   # Opponent (different keypair) matches the stake, taking the away side.
//   ts-node relayer/sports-bet.ts accept \
//     --creator <creatorPubkey> --game 401584793 --keypair ~/opponent.json
//
//   # Creator cancels while still OPEN (no opponent yet) — full refund.
//   ts-node relayer/sports-bet.ts cancel --game 401584793
//
//   # Either side backs out of a LOCKED bet — allowed up to 5 min before kickoff.
//   ts-node relayer/sports-bet.ts backout --creator <creatorPubkey> --game 401584793 \
//     --keypair ~/opponent.json
//
//   # List all on-chain sports bets.
//   ts-node relayer/sports-bet.ts list
//
// Env: SOLANA_RPC_URL, ORACLE_PUBKEY (defaults to the relayer oracle).

import "dotenv/config";

import fs from "fs";
import os from "os";
import path from "path";
import { AnchorProvider, BN, Program, Wallet, web3 } from "@anchor-lang/core";

import idl from "../target/idl/accountability.json";
import type { Accountability } from "../target/types/accountability";

const SPORTS_BET_SEED   = Buffer.from("sports_bet");
const SPORTS_VAULT_SEED = Buffer.from("sports_vault");
const SPORT_IDS: Record<string, number> = { soccer: 0, nba: 1, nfl: 2 };

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(3); // skip node, script, subcommand
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "true";
  }
  return out;
}

function loadKeypair(filename?: string): web3.Keypair {
  const file = filename ?? process.env.ORACLE_KEYPAIR ?? "~/.config/solana/id.json";
  const expanded = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf8")) as number[]),
  );
}

function gameIdBytes(id: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(id, "utf8").copy(buf);
  if (Buffer.byteLength(id, "utf8") > 32) throw new Error("game id too long (max 32 bytes)");
  return Array.from(buf);
}

function betPda(programId: web3.PublicKey, creator: web3.PublicKey, gameId: number[]) {
  return web3.PublicKey.findProgramAddressSync(
    [SPORTS_BET_SEED, creator.toBuffer(), Buffer.from(gameId)],
    programId,
  )[0];
}

function vaultPda(programId: web3.PublicKey, bet: web3.PublicKey) {
  return web3.PublicKey.findProgramAddressSync(
    [SPORTS_VAULT_SEED, bet.toBuffer()],
    programId,
  )[0];
}

function explorer(sig: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

async function main() {
  const cmd = process.argv[2];
  const a = args();

  const rpc = process.env.SOLANA_RPC_URL ?? web3.clusterApiUrl("devnet");
  const connection = new web3.Connection(rpc, "confirmed");
  const signer = loadKeypair(a.keypair);
  const provider = new AnchorProvider(connection, new Wallet(signer), { commitment: "confirmed" });
  const program = new Program<Accountability>(idl as Accountability, provider);

  if (cmd === "list") {
    const all = await program.account.sportsBet.all();
    for (const { publicKey, account } of all) {
      const raw = Buffer.from(account.gameId);
      const gid = raw.slice(0, raw.indexOf(0) === -1 ? 32 : raw.indexOf(0)).toString("utf8");
      const state = "open" in account.state ? "OPEN" : "locked" in account.state ? "LOCKED" : "SETTLED";
      console.log(
        `${publicKey.toBase58()}  [${state}] sport=${account.sport} game=${gid} ` +
        `stake=${account.amount.toNumber() / web3.LAMPORTS_PER_SOL} SOL ` +
        `creatorBacksHome=${account.creatorBacksHome} opponent=${account.opponent?.toBase58() ?? "-"}`,
      );
    }
    if (all.length === 0) console.log("(no sports bets on chain)");
    return;
  }

  if (cmd === "create") {
    const sport = SPORT_IDS[a.sport ?? "nba"];
    if (sport === undefined) throw new Error("--sport must be soccer | nba | nfl");
    if (!a.game) throw new Error("--game <espnGameId> is required");
    const amount = new BN(Math.round(Number(a.amount ?? "0.1") * web3.LAMPORTS_PER_SOL));
    const backsHome = (a.side ?? "home") === "home";

    // Default to kicking off in --in minutes (10) and settling 3h later, so you
    // can demo the back-out window without hunting for real schedule times.
    const now = Math.floor(Date.now() / 1000);
    const inMin = Number(a.in ?? "10");
    const start = a.start ? Number(a.start) : now + inMin * 60;
    const settle = a.settle ? Number(a.settle) : start + 3 * 3600;

    const oracle = new web3.PublicKey(
      a.oracle ?? process.env.ORACLE_PUBKEY ?? signer.publicKey.toBase58(),
    );

    const gid = gameIdBytes(a.game);
    const bet = betPda(program.programId, signer.publicKey, gid);
    const vault = vaultPda(program.programId, bet);

    const sig = await program.methods
      .createBet(amount, oracle, sport, gid, backsHome, new BN(start), new BN(settle))
      .accountsStrict({
        creator: signer.publicKey,
        sportsBet: bet,
        vault,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("created bet:", bet.toBase58());
    console.log("oracle:", oracle.toBase58());
    console.log(`kickoff: ${new Date(start * 1000).toISOString()}  settle-after: ${new Date(settle * 1000).toISOString()}`);
    console.log("tx:", explorer(sig));
    return;
  }

  // accept / cancel / backout all need the bet PDA. cancel acts as the creator;
  // accept/backout pass --creator to locate someone else's bet.
  if (!a.game) throw new Error("--game <espnGameId> is required");
  const gid = gameIdBytes(a.game);
  const creator = a.creator ? new web3.PublicKey(a.creator) : signer.publicKey;
  const bet = betPda(program.programId, creator, gid);
  const vault = vaultPda(program.programId, bet);

  if (cmd === "accept") {
    const sig = await program.methods
      .acceptBet()
      .accountsStrict({
        opponent: signer.publicKey,
        sportsBet: bet,
        vault,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log("accepted bet:", bet.toBase58());
    console.log("tx:", explorer(sig));
    return;
  }

  if (cmd === "cancel") {
    const sig = await program.methods
      .cancelBet()
      .accountsStrict({ creator: signer.publicKey, sportsBet: bet, vault })
      .rpc();
    console.log("cancelled (refunded) bet:", bet.toBase58());
    console.log("tx:", explorer(sig));
    return;
  }

  if (cmd === "backout") {
    const account = await program.account.sportsBet.fetch(bet);
    if (!account.opponent) throw new Error("bet has no opponent — use `cancel` instead");
    const sig = await program.methods
      .backOut()
      .accountsStrict({
        backer: signer.publicKey,
        creator,
        opponent: account.opponent,
        sportsBet: bet,
        vault,
      })
      .rpc();
    console.log("backed out (both refunded):", bet.toBase58());
    console.log("tx:", explorer(sig));
    return;
  }

  throw new Error(`unknown command: ${cmd ?? "(none)"}\nuse: create | accept | cancel | backout | list`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
