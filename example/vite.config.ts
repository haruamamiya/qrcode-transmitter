import path from "path";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  root: __dirname,
  base: process.env.GITHUB_ACTIONS ? pagesBase : "/",
  server: {
    port: 5174,
  },
  resolve: {
    alias: {
      "qrcode-transmitter": path.resolve(__dirname, "../src/index.ts"),
    },
  },
});
