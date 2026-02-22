import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  publicDir: resolve(__dirname, "../assets"),
  resolve: {
    alias: {
      "@gunslinger/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
});
