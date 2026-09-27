import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  publicDir: resolve(__dirname, "../assets"),
  server: {
    port: 5173,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
