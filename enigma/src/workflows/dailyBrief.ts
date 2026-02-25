import type { AgentContext, WorkflowResult } from "../agent/schema.js";

export async function dailyBrief(
  context: AgentContext,
  watchlist: string[]
): Promise<WorkflowResult<{ watchlist: string[]; bullets: string[] }>> {
  context.tools.logger.info(`Generating daily brief for ${watchlist.join(", ")}`);

  const summary = await context.tools.web.summarize(
    `Daily market catalysts for ${watchlist.join(", ")}`
  );

  const bullets = [
    `Watchlist: ${watchlist.join(", ")}`,
    "Regime note: assess volatility compression/expansion before entries.",
    `Catalyst summary: ${summary}`
  ];

  return {
    human: `# Daily Brief\n\n- ${bullets.join("\n- ")}`,
    data: { watchlist, bullets }
  };
}
