import type { AgentContext, WorkflowResult } from "../agent/schema.js";

export async function journal(
  context: AgentContext,
  note: string
): Promise<WorkflowResult<{ note: string; saved: boolean }>> {
  context.tools.logger.info("Appending journal note");
  await context.tools.storage.appendJournal(note);

  return {
    human: `# Journal\n\n- Note saved: ${note}`,
    data: { note, saved: true }
  };
}
