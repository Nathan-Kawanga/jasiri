import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";

// Tests run against the local Supabase stack (npm run db:start) using .env.local.
const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
