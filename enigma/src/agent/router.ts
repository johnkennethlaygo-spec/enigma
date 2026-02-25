import { dailyBrief } from "../workflows/dailyBrief.js";
import { journal } from "../workflows/journal.js";
import { killSwitch } from "../workflows/killSwitch.js";
import { riskCheck } from "../workflows/riskCheck.js";
import type { AgentContext, WorkflowResult } from "./schema.js";

type ChatResult = WorkflowResult<{
  command: string;
  parsedIntent: string;
  workflow?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  routine?: Record<string, unknown>;
}>;

function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractAfterKeyword(input: string, keyword: string): string {
  const idx = input.toLowerCase().indexOf(keyword);
  if (idx === -1) return "";
  return input.slice(idx + keyword.length).trim();
}

export async function runMorningRoutine(
  context: AgentContext,
  options: { watchlist: string[]; mint?: string; note?: string }
): Promise<WorkflowResult<{ steps: Record<string, unknown>; watchlist: string[] }>> {
  const steps: Record<string, unknown> = {};

  const brief = await dailyBrief(context, options.watchlist);
  steps.dailyBrief = brief.data;

  if (options.mint) {
    const score = await killSwitch(context, options.mint);
    steps.killSwitch = score.data;

    const risk = await riskCheck(context, options.mint);
    steps.riskCheck = risk.data;
  }

  if (options.note) {
    const jr = await journal(context, options.note);
    steps.journal = jr.data;
  }

  return {
    human:
      "# Morning Routine\n\n- Daily brief executed\n" +
      (options.mint ? "- Kill-switch score executed\n" : "") +
      (options.mint ? "- Risk check executed\n" : "") +
      (options.note ? "- Journal entry saved\n" : "") +
      "- Ready for session planning",
    data: { steps, watchlist: options.watchlist }
  };
}

export async function routeAgentCommand(
  context: AgentContext,
  command: string
): Promise<ChatResult> {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();

  if (lower.startsWith("daily brief") || lower.startsWith("brief")) {
    const raw = extractAfterKeyword(normalized, "brief");
    const watchlist = parseCsv(raw);
    if (watchlist.length === 0) {
      return {
        human: "Please provide a watchlist. Example: daily brief SOL,BONK,WIF",
        data: { command, parsedIntent: "daily-brief" }
      };
    }

    const result = await dailyBrief(context, watchlist);
    return {
      human: result.human,
      data: {
        command,
        parsedIntent: "daily-brief",
        workflow: "daily-brief",
        payload: { watchlist },
        result: result.data
      }
    };
  }

  if (lower.startsWith("risk check") || lower.startsWith("risk")) {
    const mint = extractAfterKeyword(normalized, "risk").replace(/^check\s+/i, "").trim();
    if (!mint) {
      return {
        human: "Please provide a token mint. Example: risk check <MINT>",
        data: { command, parsedIntent: "risk-check" }
      };
    }

    const result = await riskCheck(context, mint);
    return {
      human: result.human,
      data: {
        command,
        parsedIntent: "risk-check",
        workflow: "risk-check",
        payload: { mint },
        result: result.data
      }
    };
  }

  if (lower.startsWith("kill switch") || lower.startsWith("killswitch")) {
    const mint = normalized
      .replace(/kill\s*switch/i, "")
      .replace(/killswitch/i, "")
      .trim();
    if (!mint) {
      return {
        human: "Please provide a token mint. Example: kill switch <MINT>",
        data: { command, parsedIntent: "kill-switch" }
      };
    }

    const result = await killSwitch(context, mint);
    return {
      human: result.human,
      data: {
        command,
        parsedIntent: "kill-switch",
        workflow: "kill-switch",
        payload: { mint },
        result: result.data
      }
    };
  }

  if (lower.startsWith("journal")) {
    const note = extractAfterKeyword(normalized, "journal");
    if (!note) {
      return {
        human: "Please provide a journal note. Example: journal Entered with reduced size.",
        data: { command, parsedIntent: "journal" }
      };
    }

    const result = await journal(context, note);
    return {
      human: result.human,
      data: {
        command,
        parsedIntent: "journal",
        workflow: "journal",
        payload: { note },
        result: result.data
      }
    };
  }

  if (lower.startsWith("morning routine") || lower.startsWith("run morning routine")) {
    const input = normalized
      .replace(/run\s+/i, "")
      .replace(/morning routine/i, "")
      .trim();

    const [watchlistRaw, mintRaw] = input.split(" mint=");
    const watchlist = parseCsv(watchlistRaw);
    const mint = mintRaw?.trim();

    if (watchlist.length === 0) {
      return {
        human:
          "Please provide watchlist for routine. Example: morning routine SOL,BONK,WIF mint=<MINT>",
        data: { command, parsedIntent: "morning-routine" }
      };
    }

    const routine = await runMorningRoutine(context, { watchlist, mint });
    return {
      human: routine.human,
      data: {
        command,
        parsedIntent: "morning-routine",
        workflow: "morning-routine",
        payload: { watchlist, mint },
        routine: routine.data
      }
    };
  }

  return {
    human:
      "Command not recognized. Try: daily brief SOL,BONK,WIF | kill switch <MINT> | risk check <MINT> | journal <NOTE> | morning routine SOL,BONK,WIF mint=<MINT>",
    data: { command, parsedIntent: "unknown" }
  };
}
