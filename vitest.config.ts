import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // This machine has little free virtual memory; one worker avoids native out-of-memory crashes.
    maxWorkers: 1,
    fileParallelism: false,
  },
});
