export function createWebTool() {
  return {
    async summarize(query: string): Promise<string> {
      return `Web summary placeholder for query: ${query}`;
    }
  };
}
