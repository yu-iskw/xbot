import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@yu-iskw/xbot-core": src("core"),
      "@yu-iskw/xbot-cli": src("cli"),
      "@yu-iskw/xbot-http": src("http"),
      "@yu-iskw/xbot-mcp": src("mcp"),
      "@yu-iskw/xbot-slack": src("slack"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/live/**", "**/node_modules/**"],
    testTimeout: 30_000,
  },
});
