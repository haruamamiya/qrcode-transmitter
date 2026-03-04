import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQrcode = vi.fn();
const mockAddData = vi.fn();
const mockMake = vi.fn();
const mockCreateSvgTag = vi.fn(() => "<svg/>");

vi.mock("qrcode-generator", () => ({
  default: mockQrcode,
}));

const mockStop = vi.fn();
const mockDestroy = vi.fn();

vi.mock("qr-scanner", () => {
  const mockStart = vi.fn();
  return {
    default: vi.fn().mockImplementation(
      (
        _video: unknown,
        onDecode: (r: { data: string }) => void,
        _opts: { maxScansPerSecond?: number; calculateScanRegion?: (v: HTMLVideoElement) => unknown }
      ) => ({
        start: mockStart,
        stop: mockStop,
        destroy: mockDestroy,
        _onDecode: onDecode,
      })
    ),
    mockStop,
    mockDestroy,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQrcode.mockReturnValue({
    addData: mockAddData,
    make: mockMake,
    createSvgTag: mockCreateSvgTag,
  });
});

describe("encodeBytesToQRCodes", () => {
  it("uses TypeNumber=15 and L error correction", async () => {
    const { encodeBytesToQRCodes } = await import("../src/index");
    await encodeBytesToQRCodes(new TextEncoder().encode("hi"));
    expect(mockQrcode).toHaveBeenCalledWith(15, "L");
  });

  it("addData uses Byte mode", async () => {
    const { encodeBytesToQRCodes } = await import("../src/index");
    await encodeBytesToQRCodes(new TextEncoder().encode("hi"));
    expect(mockAddData).toHaveBeenCalledWith(expect.any(String), "Byte");
  });

  it("uses custom typeNumber when provided", async () => {
    const { encodeBytesToQRCodes } = await import("../src/index");
    await encodeBytesToQRCodes(new TextEncoder().encode("hi"), { typeNumber: 10 });
    expect(mockQrcode).toHaveBeenCalledWith(10, "L");
  });

  it("returns array of objects with frame indices", async () => {
    const { encodeBytesToQRCodes } = await import("../src/index");
    const frames = await encodeBytesToQRCodes(new TextEncoder().encode("hi"));
    expect(Array.isArray(frames)).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const f of frames) {
      expect(f).toHaveProperty("frameIndex");
      expect(f).toHaveProperty("totalFrames");
      expect(f).toHaveProperty("svg");
      expect(f).toHaveProperty("payload");
      expect(typeof f.frameIndex).toBe("number");
      expect(typeof f.totalFrames).toBe("number");
      expect(typeof f.svg).toBe("string");
      expect(typeof f.payload).toBe("string");
    }
  });
});

describe("startVideoQRReceiver", () => {
  it("uses maxScansPerSecond 20 and full-frame calculateScanRegion", async () => {
    const QrScanner = (await import("qr-scanner")).default;
    const { startVideoQRReceiver } = await import("../src/index");
    const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, {});
    expect(QrScanner).toHaveBeenCalledWith(
      video,
      expect.any(Function),
      expect.objectContaining({
        returnDetailedScanResult: true,
        maxScansPerSecond: 20,
        calculateScanRegion: expect.any(Function),
      })
    );
    const opts = (QrScanner as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    const region = opts.calculateScanRegion(video);
    expect(region).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      downScaledWidth: 1000,
      downScaledHeight: 750,
    });
    receiver.stop();
  });

  it("stop calls stop and destroy", async () => {
    const { mockStop: stopFn, mockDestroy: destroyFn } = await import("qr-scanner");
    const { startVideoQRReceiver } = await import("../src/index");
    const video = {} as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, {});
    receiver.stop();
    expect(stopFn).toHaveBeenCalled();
    expect(destroyFn).toHaveBeenCalled();
  });

  it("calls onComplete when all chunks received and SHA-256 verification passes", async () => {
    let captured: Uint8Array | null = null;
    const onComplete = (data: Uint8Array) => {
      captured = data;
    };
    const { startVideoQRReceiver } = await import("../src/index");
    const video = {} as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, { onComplete });

    const QrScanner = (await import("qr-scanner")).default as ReturnType<typeof vi.fn>;
    const onDecode = QrScanner.mock.calls[0]![1] as (r: { data: string }) => void;

    const payload = new TextEncoder().encode("test");
    const hash = createHash("sha256").update(payload).digest("base64");
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));
    onDecode({ data: `abcd1234|0/1|${hash}|${b64}` });

    await new Promise((r) => setTimeout(r, 50));
    expect(captured).not.toBeNull();
    expect(new TextDecoder().decode(captured!)).toBe("test");

    receiver.stop();
  });

  it("calls onVerifyFailed when SHA-256 verification fails", async () => {
    let onCompleteCalled = false;
    let onVerifyFailedCalled = false;
    const { startVideoQRReceiver } = await import("../src/index");
    const video = {} as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, {
      onComplete: () => {
        onCompleteCalled = true;
      },
      onVerifyFailed: () => {
        onVerifyFailedCalled = true;
      },
    });

    const QrScanner = (await import("qr-scanner")).default as ReturnType<typeof vi.fn>;
    const onDecode = QrScanner.mock.calls[0]![1] as (r: { data: string }) => void;

    const payload = new TextEncoder().encode("test");
    const wrongHash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));
    onDecode({ data: `abcd1234|0/1|${wrongHash}|${b64}` });

    await new Promise((r) => setTimeout(r, 50));
    expect(onCompleteCalled).toBe(false);
    expect(onVerifyFailedCalled).toBe(true);

    receiver.stop();
  });

  it("triggers onFrame for each new parsed frame", async () => {
    const onFrameCalls: { frameIndex: number; totalFrames: number; msgId: string; receivedCount: number }[] = [];
    const { startVideoQRReceiver } = await import("../src/index");
    const video = {} as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, {
      onFrame: (p) => onFrameCalls.push({ ...p }),
    });

    const QrScanner = (await import("qr-scanner")).default as ReturnType<typeof vi.fn>;
    const onDecode = QrScanner.mock.calls[0]![1] as (r: { data: string }) => void;

    const payload = new TextEncoder().encode("x");
    const hash = createHash("sha256").update(payload).digest("base64");
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(payload)));
    onDecode({ data: `abcd1234|0/1|${hash}|${b64}` });

    expect(onFrameCalls.length).toBeGreaterThanOrEqual(1);
    expect(onFrameCalls[0]!.frameIndex).toBe(0);
    expect(onFrameCalls[0]!.totalFrames).toBe(1);
    expect(onFrameCalls[0]!.receivedCount).toBe(1);

    receiver.stop();
  });

  it("does not trigger onFrame for duplicate frames", async () => {
    const onFrameCalls: { frameIndex: number }[] = [];
    const { startVideoQRReceiver } = await import("../src/index");
    const video = {} as HTMLVideoElement;
    const receiver = startVideoQRReceiver(video, {
      onFrame: (p) => onFrameCalls.push({ frameIndex: p.frameIndex }),
    });

    const QrScanner = (await import("qr-scanner")).default as ReturnType<typeof vi.fn>;
    const onDecode = QrScanner.mock.calls[0]![1] as (r: { data: string }) => void;

    const full = new TextEncoder().encode("ab");
    const hash = createHash("sha256").update(full).digest("base64");
    const b64 = btoa(String.fromCharCode.apply(null, Array.from(new TextEncoder().encode("a"))));
    const frame = `dup12345|0/2|${hash}|${b64}`;
    onDecode({ data: frame });
    onDecode({ data: frame });
    onDecode({ data: frame });

    expect(onFrameCalls.length).toBe(1);
    expect(onFrameCalls[0]!.frameIndex).toBe(0);

    const b64b = btoa(String.fromCharCode.apply(null, Array.from(new TextEncoder().encode("b"))));
    onDecode({ data: `dup12345|1/2|${b64b}` });

    expect(onFrameCalls.length).toBe(2);

    receiver.stop();
  });
});
