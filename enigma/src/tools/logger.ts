const levelOrder = ["error", "warn", "info"] as const;
type Level = (typeof levelOrder)[number];

function canLog(current: Level, target: Level): boolean {
  return levelOrder.indexOf(target) <= levelOrder.indexOf(current);
}

export function createLogger(level: string | undefined) {
  const current: Level = (level as Level) || "info";

  return {
    info(message: string) {
      if (canLog(current, "info")) {
        console.log(`[info] ${message}`);
      }
    },
    warn(message: string) {
      if (canLog(current, "warn")) {
        console.warn(`[warn] ${message}`);
      }
    },
    error(message: string) {
      if (canLog(current, "error")) {
        console.error(`[error] ${message}`);
      }
    }
  };
}
