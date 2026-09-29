import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/empty.ts"),
    },
    conditions: ["react-server", "node", "import", "default"],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // Las pruebas de integración comparten una base real: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
