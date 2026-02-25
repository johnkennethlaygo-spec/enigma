import type { AgentContext, WorkflowResult } from "../agent/schema.js";

export async function killSwitch(
  context: AgentContext,
  mint: string
): Promise<
  WorkflowResult<{
    mint: string;
    score: number;
    verdict: "PASS" | "CAUTION" | "BLOCK";
    reasons: string[];
    risk: Record<string, unknown>;
  }>
> {
  context.tools.logger.info(`Running kill-switch score for mint ${mint}`);

  const result = await context.tools.onchain.killSwitchScore(mint);

  return {
    human:
      `# Kill-Switch\n\n` +
      `- Mint: ${mint}\n` +
      `- Score: ${String(result.score)}/100\n` +
      `- Verdict: ${String(result.verdict)}\n` +
      `- Reasons: ${(result.reasons as string[]).join("; ")}`,
    data: {
      mint,
      score: Number(result.score),
      verdict: result.verdict as "PASS" | "CAUTION" | "BLOCK",
      reasons: (result.reasons as string[]) || [],
      risk: (result.risk as Record<string, unknown>) || {}
    }
  };
}
