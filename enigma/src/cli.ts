#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { createEnigmaContext } from "./agent/enigma.js";
import { dailyBrief } from "./workflows/dailyBrief.js";
import { journal } from "./workflows/journal.js";
import { riskCheck } from "./workflows/riskCheck.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("enigma")
    .description("Enigma: trader productivity & risk assistant")
    .version("0.1.0");

  program
    .command("daily-brief")
    .description("Generate daily brief for a watchlist")
    .requiredOption("--watchlist <symbols>", 'Comma-separated symbols. Example: "SOL,BONK,WIF"')
    .action(async (opts: { watchlist: string }) => {
      const context = await createEnigmaContext();
      const watchlist = opts.watchlist.split(",").map((s) => s.trim()).filter(Boolean);
      const result = await dailyBrief(context, watchlist);
      console.log(result.human);
      console.log("\nJSON:\n", JSON.stringify(result.data, null, 2));
    });

  program
    .command("risk-check")
    .description("Run risk checks for a token mint")
    .requiredOption("--mint <address>", "Token mint address")
    .action(async (opts: { mint: string }) => {
      const context = await createEnigmaContext();
      const result = await riskCheck(context, opts.mint);
      console.log(result.human);
      console.log("\nJSON:\n", JSON.stringify(result.data, null, 2));
    });

  program
    .command("journal")
    .description("Append a journal note")
    .requiredOption("--note <text>", "Journal note text")
    .action(async (opts: { note: string }) => {
      const context = await createEnigmaContext();
      const result = await journal(context, opts.note);
      console.log(result.human);
      console.log("\nJSON:\n", JSON.stringify(result.data, null, 2));
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
