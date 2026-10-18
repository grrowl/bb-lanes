import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "reference/**"],
  },
});
