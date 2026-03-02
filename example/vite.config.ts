import path from "path";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  server: {
    port: 5174,
  },
  resolve: {
    alias: {
      "qrcode-transmitter": path.resolve(__dirname, "../src/index.ts"),
    },
  },
});
