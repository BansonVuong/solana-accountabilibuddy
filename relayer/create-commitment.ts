import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Wallet } from "@anchor-lang/core";
import idl from "../target/idl/accountability.json";
import fs from "fs";

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  const staker = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")
      )
    )
  );

  const provider = new AnchorProvider(
    connection,
    new Wallet(staker),
    { commitment: "confirmed" }
  );

  const program = new Program(idl as any, provider);

  const COMMITMENT_SEED = Buffer.from("commitment");
  const VAULT_SEED = Buffer.from("vault");

  const [commitment] = PublicKey.findProgramAddressSync(
    [COMMITMENT_SEED, staker.publicKey.toBuffer()],
    program.programId
  );

  const [vault] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, commitment.toBuffer()],
    program.programId
  );

  const oracle = new PublicKey("Fd5SD96oLomuQcLDR4TRukFZze5MAyQ9bek27aan9CZ");
  const destination = Keypair.generate().publicKey;
  const deadline = new BN(Math.floor(Date.now() / 1000) + 300);

  const tx = await program.methods
    .stake(new BN(1_000_000_000), oracle, deadline, destination)
    .accounts({
      staker: staker.publicKey,
      commitment,
      vault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("tx:", tx);
  console.log("commitment PDA:", commitment.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});