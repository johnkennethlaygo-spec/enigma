import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

interface HistoryEvent {
  ts: string;
  type: "daily-brief" | "risk-check" | "kill-switch" | "journal" | "chat" | "routine";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export function createStorageTool(
  journalPath = "./enigma_journal.log",
  historyPath = "./enigma_history.jsonl"
) {
  return {
    async appendJournal(note: string): Promise<void> {
      await mkdir(dirname(journalPath), { recursive: true });
      await appendFile(journalPath, `${new Date().toISOString()} | ${note}\n`, "utf8");
    },

    async appendHistory(event: HistoryEvent): Promise<void> {
      await mkdir(dirname(historyPath), { recursive: true });
      await appendFile(historyPath, `${JSON.stringify(event)}\n`, "utf8");
    },

    async listHistory(limit = 50): Promise<HistoryEvent[]> {
      try {
        const raw = await readFile(historyPath, "utf8");
        const lines = raw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        const parsed = lines
          .map((line) => {
            try {
              return JSON.parse(line) as HistoryEvent;
            } catch {
              return null;
            }
          })
          .filter((value): value is HistoryEvent => value !== null);

        return parsed.slice(-limit).reverse();
      } catch {
        return [];
      }
    }
  };
}
