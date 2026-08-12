import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", testTimeout: 30000, hookTimeout: 30000, coverage: { reporter: ["text", "html"] } },
});
