// Node 18+ has built-in atob/btoa, no polyfill needed
// Add polyfill here if running tests in older environments
if (typeof globalThis.atob === "undefined") {
  (globalThis as unknown as { atob: (s: string) => string }).atob = (s: string) =>
    Buffer.from(s, "base64").toString("binary");
}
if (typeof globalThis.btoa === "undefined") {
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = (s: string) =>
    Buffer.from(s, "binary").toString("base64");
}
