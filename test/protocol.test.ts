import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  splitIntoFrames,
  parseFrame,
  base64ToBytes,
  FrameAggregator,
  type ParsedFrame,
} from "../src/protocol";

function sha256Base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

describe("splitIntoFrames", () => {
  it("empty input returns single frame with empty payload", () => {
    const hash = sha256Base64(new Uint8Array(0));
    const frames = splitIntoFrames(new Uint8Array(0), hash);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frameIndex).toBe(0);
    expect(frames[0]!.totalFrames).toBe(1);
    expect(frames[0]!.payloadBase64).toBe("");
    const parsed = parseFrame(frames[0]!.frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.total).toBe(1);
    expect(parsed!.idx).toBe(0);
    expect(parsed!.sha256Base64).toBe(hash);
  });

  it("splits normal input correctly and conforms to protocol format", () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = sha256Base64(bytes);
    const frames = splitIntoFrames(bytes, hash);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      const p = parseFrame(f.frame);
      expect(p).not.toBeNull();
      expect(p!.msgId.length).toBe(8);
      expect(f.frameIndex).toBe(i);
      expect(f.totalFrames).toBe(frames.length);
      if (i === 0) expect(p!.sha256Base64).toBe(hash);
    }
    const decoded = base64ToBytes(frames[0]!.payloadBase64);
    expect(new TextDecoder().decode(decoded)).toBe("hello");
  });

  it("large data produces multiple chunks", () => {
    const size = 1000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    const hash = sha256Base64(bytes);
    const frames = splitIntoFrames(bytes, hash);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.totalFrames).toBe(frames.length);
  });
});

describe("parseFrame", () => {
  const sha44 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

  it("parses valid frame 0 with sha256 correctly", () => {
    const text = `abcd1234|0/2|${sha44}|SGVsbG8=`;
    const p = parseFrame(text);
    expect(p).toEqual({
      msgId: "abcd1234",
      idx: 0,
      total: 2,
      payloadBase64: "SGVsbG8=",
      sha256Base64: sha44,
    });
  });

  it("parses valid frame idx>0 without sha256", () => {
    const text = "abcd1234|1/2|V29ybGQ=";
    const p = parseFrame(text);
    expect(p).toEqual({
      msgId: "abcd1234",
      idx: 1,
      total: 2,
      payloadBase64: "V29ybGQ=",
    });
  });

  it("returns null for frame 0 without sha256", () => {
    expect(parseFrame("abcd1234|0/2|SGVsbG8=")).toBeNull();
  });

  it("returns null for invalid format", () => {
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("no-pipe")).toBeNull();
    expect(parseFrame("a|b/c")).toBeNull();
    expect(parseFrame("a|1/0|x")).toBeNull();
    expect(parseFrame("a|-1/1|x")).toBeNull();
    expect(parseFrame(`a|0/1|${sha44}|x`)).not.toBeNull();
  });
});

describe("FrameAggregator", () => {
  function makeParsed(
    msgId: string,
    idx: number,
    total: number,
    payload: Uint8Array,
    sha256Base64?: string
  ): ParsedFrame {
    const payloadBase64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));
    const p: ParsedFrame = { msgId, idx, total, payloadBase64 };
    if (idx === 0 && sha256Base64) p.sha256Base64 = sha256Base64;
    return p;
  }

  it("outputs complete bytes when all chunks received out of order", () => {
    const agg = new FrameAggregator();
    const msgId = "test1234";
    const full = new TextEncoder().encode("aabbcc");
    const hash = createHash("sha256").update(full).digest("base64");
    const p1 = makeParsed(msgId, 1, 3, new TextEncoder().encode("bb"));
    const p0 = makeParsed(msgId, 0, 3, new TextEncoder().encode("aa"), hash);
    const p2 = makeParsed(msgId, 2, 3, new TextEncoder().encode("cc"));

    expect(agg.add(p1).complete).toBe(false);
    expect(agg.add(p0).complete).toBe(false);
    const result = agg.add(p2);
    expect(result.complete).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.expectedSha256Base64).toBe(hash);
    expect(new TextDecoder().decode(result.data!)).toBe("aabbcc");
  });

  it("does not count duplicate frames twice", () => {
    const agg = new FrameAggregator();
    const msgId = "dup12345";
    const full = new TextEncoder().encode("ab");
    const hash = createHash("sha256").update(full).digest("base64");
    const p0 = makeParsed(msgId, 0, 2, new TextEncoder().encode("a"), hash);
    const p1 = makeParsed(msgId, 1, 2, new TextEncoder().encode("b"));
    agg.add(p0);
    expect(agg.add(p0).isNew).toBe(false);
    const r = agg.add(p1);
    expect(r.complete).toBe(true);
    expect(r.data).toBeDefined();
  });

  it("messages with different msgId do not interfere", () => {
    const agg = new FrameAggregator();
    const hashA = createHash("sha256").update(new TextEncoder().encode("A")).digest("base64");
    const hashB = createHash("sha256").update(new TextEncoder().encode("B")).digest("base64");
    const a0 = makeParsed("aaaa1111", 0, 1, new TextEncoder().encode("A"), hashA);
    const b0 = makeParsed("bbbb2222", 0, 1, new TextEncoder().encode("B"), hashB);
    const ra = agg.add(a0);
    const rb = agg.add(b0);
    expect(ra.complete).toBe(true);
    expect(rb.complete).toBe(true);
    expect(new TextDecoder().decode(ra.data!)).toBe("A");
    expect(new TextDecoder().decode(rb.data!)).toBe("B");
  });
});
