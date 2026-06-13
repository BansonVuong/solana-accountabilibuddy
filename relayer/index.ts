import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AnchorProvider, Program, Wallet, web3 } from "@anchor-lang/core";

import idl from "../target/idl/accountability.json";
import type { Accountability } from "../target/types/accountability";

const RPC_URL = process.env.SOLANA_RPC_URL ?? web3.clusterApiUrl("devnet");
const ORACLE_KEYPAIR = process.env.ORACLE_KEYPAIR ?? "~/.config/solana/id.json";
const PORT = Number(process.env.PORT ?? 8787);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const VAULT_SEED = Buffer.from("vault");

const oracle = loadKeypair(ORACLE_KEYPAIR);
const connection = new web3.Connection(RPC_URL, "confirmed");
const provider = new AnchorProvider(
  connection,
  new Wallet(oracle),
  AnchorProvider.defaultOptions()
);
const program = new Program<Accountability>(idl as Accountability, provider);

async function resolveSuccess(commitmentId: string): Promise<string> {
  const commitment = new web3.PublicKey(commitmentId);
  const account = await program.account.commitment.fetch(commitment);
  assertOracle(account.oraclePubkey);

  const [vault] = web3.PublicKey.findProgramAddressSync(
    [VAULT_SEED, commitment.toBuffer()],
    program.programId
  );

  return program.methods
    .resolve(true)
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
  const now = await connection.getBlockTime(slot);
  if (now === null) {
    throw new Error(`could not read block time for slot ${slot}`);
  }
  const commitments = await program.account.commitment.all();

  for (const { publicKey, account } of commitments) {
    if (!("active" in account.state) || account.deadline.gtn(now)) {
      continue;
    }

    const [vault] = web3.PublicKey.findProgramAddressSync(
      [VAULT_SEED, publicKey.toBuffer()],
      program.programId
    );

    try {
      const signature = await program.methods
        .timeout()
        .accountsStrict({
          cranker: oracle.publicKey,
          staker: account.staker,
          commitment: publicKey,
          vault,
          destination: account.failureDestination,
        })
        .rpc();
      console.log(`timed out ${publicKey.toBase58()}: ${signature}`);
    } catch (error) {
      console.error(`timeout failed for ${publicKey.toBase58()}:`, error);
    }
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, {
        ok: true,
        oracle: oracle.publicKey.toBase58(),
        program: program.programId.toBase58(),
        rpc: RPC_URL,
      });
    }

    if (request.method === "POST" && request.url === "/verify") {
      const body = await readJson(request);
      if (typeof body.commitmentId !== "string") {
        return json(response, 400, { error: "commitmentId is required" });
      }

      const signature = await resolveSuccess(body.commitmentId);
      return json(response, 200, {
        commitmentId: body.commitmentId,
        didSucceed: true,
        signature,
        explorer: explorerUrl(signature),
      });
    }

    return json(response, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    return json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`relayer listening on http://localhost:${PORT}`);
  console.log(`oracle: ${oracle.publicKey.toBase58()}`);
  console.log(`program: ${program.programId.toBase58()}`);
});

setInterval(() => void runTimeoutPoll(), POLL_INTERVAL_MS);
void runTimeoutPoll();

async function runTimeoutPoll(): Promise<void> {
  try {
    await crankTimeouts();
  } catch (error) {
    console.error("timeout poll failed:", error);
  }
}

function assertOracle(expected: web3.PublicKey): void {
  if (!expected.equals(oracle.publicKey)) {
    throw new Error(
      `oracle mismatch: commitment expects ${expected.toBase58()}, relayer is ${oracle.publicKey.toBase58()}`
    );
  }
}

function loadKeypair(filename: string): web3.Keypair {
  const expanded =
    filename === "~" || filename.startsWith("~/")
      ? path.join(os.homedir(), filename.slice(2))
      : filename;
  const secret = JSON.parse(fs.readFileSync(expanded, "utf8")) as number[];
  return web3.Keypair.fromSecretKey(Uint8Array.from(secret));
}

function readJson(
  request: http.IncomingMessage
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        request.destroy(new Error("request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function json(
  response: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
