export interface WorkflowResult<T = Record<string, unknown>> {
  human: string;
  data: T;
}

export interface AgentConfig {
  agent: {
    name: string;
    role: string;
    mode: "analysis" | "strict";
  };
  limits: {
    maxToolCalls: number;
  };
  risk: {
    allowDangerousOps: boolean;
  };
  sources?: {
    news?: string[];
  };
  onchain?: {
    rpcUrl?: string;
  };
}

export interface AgentContext {
  config: AgentConfig;
  tools: AgentTools;
}

export interface AgentTools {
  web: {
    summarize(query: string): Promise<string>;
  };
  onchain: {
    riskSignals(mint: string): Promise<Record<string, unknown>>;
    killSwitchScore(mint: string): Promise<Record<string, unknown>>;
    rpcHealth(): Promise<Record<string, unknown>>;
  };
  storage: {
    appendJournal(note: string): Promise<void>;
    appendHistory(event: {
      ts: string;
      type: "daily-brief" | "risk-check" | "kill-switch" | "journal" | "chat" | "routine";
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    }): Promise<void>;
    listHistory(
      limit?: number
    ): Promise<
      Array<{
        ts: string;
        type: "daily-brief" | "risk-check" | "kill-switch" | "journal" | "chat" | "routine";
        input: Record<string, unknown>;
        output: Record<string, unknown>;
      }>
    >;
  };
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}
