import { describe, it, expect } from "vitest";
import {
  splitIntoFrames,
  parseFrame,
  base64ToBytes,
  FrameAggregator,
  type ParsedFrame,
} from "../src/protocol";

describe("splitIntoFrames", () => {
  it("empty input returns single frame with empty payload", () => {
    const frames = splitIntoFrames(new Uint8Array(0));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frameIndex).toBe(0);
    expect(frames[0]!.totalFrames).toBe(1);
    expect(frames[0]!.payloadBase64).toBe("");
    const parsed = parseFrame(frames[0]!.frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.total).toBe(1);
    expect(parsed!.idx).toBe(0);
  });

  it("splits normal input correctly and conforms to protocol format", () => {
    const bytes = new TextEncoder().encode("hello");
    const frames = splitIntoFrames(bytes);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      const p = parseFrame(f.frame);
      expect(p).not.toBeNull();
      expect(p!.msgId.length).toBe(8);
      expect(f.frameIndex).toBe(i);
      expect(f.totalFrames).toBe(frames.length);
    }
    const decoded = base64ToBytes(frames[0]!.payloadBase64);
    expect(new TextDecoder().decode(decoded)).toBe("hello");
  });

  it("large data produces multiple chunks", () => {
    const size = 1000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    const frames = splitIntoFrames(bytes);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.totalFrames).toBe(frames.length);
  });
});

describe("parseFrame", () => {
  it("parses valid frame correctly", () => {
    const text = "abcd1234|0/2|SGVsbG8=";
    const p = parseFrame(text);
    expect(p).toEqual({
      msgId: "abcd1234",
      idx: 0,
      total: 2,
      payloadBase64: "SGVsbG8=",
    });
  });

  it("returns null for invalid format", () => {
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("no-pipe")).toBeNull();
    expect(parseFrame("a|b/c")).toBeNull();
    expect(parseFrame("a|1/0|x")).toBeNull();
    expect(parseFrame("a|-1/1|x")).toBeNull();
    expect(parseFrame("a|0/1|x")).not.toBeNull();
  });
});

describe("FrameAggregator", () => {
  function makeParsed(msgId: string, idx: number, total: number, payload: Uint8Array): ParsedFrame {
    const payloadBase64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));
    return { msgId, idx, total, payloadBase64 };
  }

  it("outputs complete bytes when all chunks received out of order", () => {
    const agg = new FrameAggregator();
    const msgId = "test1234";
    const p1 = makeParsed(msgId, 1, 3, new TextEncoder().encode("bb"));
    const p0 = makeParsed(msgId, 0, 3, new TextEncoder().encode("aa"));
    const p2 = makeParsed(msgId, 2, 3, new TextEncoder().encode("cc"));

    expect(agg.add(p1).complete).toBe(false);
    expect(agg.add(p0).complete).toBe(false);
    const result = agg.add(p2);
    expect(result.complete).toBe(true);
    expect(result.data).toBeDefined();
    expect(new TextDecoder().decode(result.data!)).toBe("aabbcc");
  });

  it("does not count duplicate frames twice", () => {
    const agg = new FrameAggregator();
    const msgId = "dup12345";
    const p0 = makeParsed(msgId, 0, 2, new TextEncoder().encode("a"));
    const p1 = makeParsed(msgId, 1, 2, new TextEncoder().encode("b"));
    agg.add(p0);
    expect(agg.add(p0).isNew).toBe(false); // duplicate add idx=0
    const r = agg.add(p1);
    expect(r.complete).toBe(true);
    expect(r.data).toBeDefined();
  });

  it("messages with different msgId do not interfere", () => {
    const agg = new FrameAggregator();
    const a0 = makeParsed("aaaa1111", 0, 1, new TextEncoder().encode("A"));
    const b0 = makeParsed("bbbb2222", 0, 1, new TextEncoder().encode("B"));
    const ra = agg.add(a0);
    const rb = agg.add(b0);
    expect(ra.complete).toBe(true);
    expect(rb.complete).toBe(true);
    expect(new TextDecoder().decode(ra.data!)).toBe("A");
    expect(new TextDecoder().decode(rb.data!)).toBe("B");
  });
});
