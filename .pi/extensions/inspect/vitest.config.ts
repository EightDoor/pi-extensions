import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: [".pi/extensions/inspect/test/*.test.ts"], testTimeout: 5000, maxWorkers: 2 },
});
