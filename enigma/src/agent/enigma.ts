import { readFile } from "node:fs/promises";
import { createLogger } from "../tools/logger.js";
import { createOnchainTool } from "../tools/onchain.js";
import { createStorageTool } from "../tools/storage.js";
import { createWebTool } from "../tools/web.js";
import type { AgentConfig, AgentContext } from "./schema.js";

export async function loadConfig(): Promise<AgentConfig> {
  const configUrl = new URL("../config/default.json", import.meta.url);
  const raw = await readFile(configUrl, "utf8");
  return JSON.parse(raw) as AgentConfig;
}

function resolveRpcUrl(config: AgentConfig): string | undefined {
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }

  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }

  return config.onchain?.rpcUrl;
}

export async function createEnigmaContext(): Promise<AgentContext> {
  const config = await loadConfig();
  const logger = createLogger(process.env.ENIGMA_LOG_LEVEL);
  const rpcUrl = resolveRpcUrl(config);

  return {
    config,
    tools: {
      web: createWebTool(),
      onchain: createOnchainTool(rpcUrl),
      storage: createStorageTool(),
      logger
    }
  };
}
