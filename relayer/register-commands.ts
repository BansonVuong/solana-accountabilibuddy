// relayer/register-commands.ts
//
// Run once to register Discord slash commands globally:
//   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... ts-node relayer/register-commands.ts

import "dotenv/config";
import { registerDiscordCommands } from "./discord";

void registerDiscordCommands().then(() => {
  console.log("Done.");
  process.exit(0);
}).catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
