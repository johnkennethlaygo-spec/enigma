import type { AgentContext, WorkflowResult } from "../agent/schema.js";

export async function riskCheck(
  context: AgentContext,
  mint: string
): Promise<WorkflowResult<{ mint: string; risk: Record<string, unknown> }>> {
  context.tools.logger.info(`Running risk check for mint ${mint}`);

  const risk = await context.tools.onchain.riskSignals(mint);

  return {
    human: `# Risk Check\n\n- Mint: ${mint}\n- Signals: ${JSON.stringify(risk, null, 2)}`,
    data: { mint, risk }
  };
}
