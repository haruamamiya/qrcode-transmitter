import qrcode from "qrcode-generator";
import QrScanner from "qr-scanner";
import { splitIntoFrames, parseFrame, FrameAggregator } from "./protocol";

const TYPE_NUMBER = 15;
const ERROR_CORRECTION = "L";

export interface EncodedFrame {
  frameIndex: number;
  totalFrames: number;
  svg: string;
  payload: string;
}

export interface EncodeOptions {
  typeNumber?: number;
}

/**
 * Compute SHA-256 of data and return base64-encoded digest
 */
export async function sha256Base64(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", copy);
  const binary = String.fromCharCode.apply(null, Array.from(new Uint8Array(hash)));
  return btoa(binary);
}

/**
 * Encode byte array to QR codes with TypeNumber=15 and L error correction.
 * Frame 0 includes SHA-256 of the full payload for integrity verification.
 * @param bytes Raw byte array
 * @returns Array of encoded results with frame indices
 */
export async function encodeBytesToQRCodes(
  bytes: Uint8Array,
  options: EncodeOptions = {}
): Promise<EncodedFrame[]> {
  const sha256Base64Str = await sha256Base64(bytes);
  const typeNumber = options.typeNumber ?? TYPE_NUMBER;
  const qrTypeNumber = typeNumber as Parameters<typeof qrcode>[0];
  const frames = splitIntoFrames(bytes, sha256Base64Str, typeNumber);
  const result: EncodedFrame[] = [];

  for (const { frameIndex, totalFrames, frame, payloadBase64 } of frames) {
    const qr = qrcode(qrTypeNumber, ERROR_CORRECTION);
    qr.addData(frame, "Byte");
    qr.make();
    result.push({
      frameIndex,
      totalFrames,
      svg: qr.createSvgTag(),
      payload: payloadBase64,
    });
  }

  return result;
}

export interface FrameProgress {
  frameIndex: number;
  totalFrames: number;
  msgId: string;
  receivedCount: number;
}

export interface VideoQRReceiverOptions {
  /** Fired when each frame is parsed */
  onFrame?: (progress: FrameProgress) => void;
  /** Fired when the complete message is received and SHA-256 verification passes */
  onComplete?: (data: Uint8Array) => void;
  /** Fired when SHA-256 verification fails after reassembly */
  onVerifyFailed?: (info: {
    msgId: string;
    expectedSha256Base64: string;
    actualSha256Base64: string;
  }) => void;
  /** Enable a short frame buffer window for backscan (default: 1200ms) */
  bufferMs?: number;
  /** Max buffered frames to retain (default: 36) */
  bufferMaxFrames?: number;
  /** How often to backscan buffered frames (default: 250ms) */
  backscanIntervalMs?: number;
  /** How many buffered frames to scan per backscan tick (default: 6) */
  backscanBatchSize?: number;
  /** De-dupe window for decoded frames (default: 1500ms) */
  dedupeWindowMs?: number;
}

export interface VideoQRReceiver {
  stop(): void;
}

/**
 * Start video stream QR code parsing, automatically reassemble complete message per protocol
 * @param video Video element for camera rendering
 * @param options Callbacks and configuration
 * @returns Returns { stop } to stop scanning
 */
export function startVideoQRReceiver(
  video: HTMLVideoElement,
  options: VideoQRReceiverOptions
): VideoQRReceiver {
  const {
    onFrame,
    onComplete,
    onVerifyFailed,
    bufferMs = 1200,
    bufferMaxFrames = 36,
    backscanIntervalMs = 250,
    backscanBatchSize = 6,
    dedupeWindowMs = 1500,
  } = options;
  const aggregator = new FrameAggregator();

  const decodedDedupe = new Map<string, number>();
  let lastDedupeCleanup = 0;

  function shouldProcessDecoded(msgId: string, frameIndex: number, now: number): boolean {
    if (dedupeWindowMs <= 0) return true;
    const key = `${msgId}:${frameIndex}`;
    const last = decodedDedupe.get(key);
    if (last !== undefined && now - last < dedupeWindowMs) return false;
    decodedDedupe.set(key, now);
    if (now - lastDedupeCleanup > dedupeWindowMs) {
      for (const [k, ts] of decodedDedupe) {
        if (now - ts > dedupeWindowMs) decodedDedupe.delete(k);
      }
      lastDedupeCleanup = now;
    }
    return true;
  }

  function handleDecodedText(text: string) {
    const parsed = parseFrame(text);
    if (!parsed) return;
    const now = Date.now();
    if (!shouldProcessDecoded(parsed.msgId, parsed.idx, now)) return;
    const res = aggregator.add(parsed);
    if (res.isNew && onFrame) {
      onFrame({
        frameIndex: res.frameIndex,
        totalFrames: res.totalFrames,
        msgId: res.msgId,
        receivedCount: res.receivedCount,
      });
    }
    if (res.complete && res.data && res.expectedSha256Base64) {
      const data = res.data;
      const expectedSha256Base64 = res.expectedSha256Base64;
      const msgId = res.msgId;
      sha256Base64(data).then((actualSha256Base64) => {
        if (actualSha256Base64 === expectedSha256Base64) {
          onComplete?.(data);
        } else {
          onVerifyFailed?.({
            msgId,
            expectedSha256Base64,
            actualSha256Base64,
          });
        }
      });
    }
  }

  const scanImage = (QrScanner as unknown as {
    scanImage?: (
      image: ImageBitmap | ImageData | HTMLCanvasElement,
      opts?: { returnDetailedScanResult?: boolean }
    ) => Promise<{ data: string } | string>;
  }).scanImage;

  const hasDocument = typeof document !== "undefined";
  const bufferEnabled =
    bufferMs > 0 && bufferMaxFrames > 0 && typeof scanImage === "function" && hasDocument;
  const captureIntervalMs = bufferEnabled
    ? Math.max(10, Math.round(bufferMs / bufferMaxFrames))
    : 0;

  type BufferedFrame = { id: number; ts: number; image: ImageBitmap | ImageData };
  const frameBuffer: BufferedFrame[] = [];
  let nextFrameId = 1;
  let lastBackscanId = 0;
  let captureTimer: ReturnType<typeof setInterval> | null = null;
  let backscanTimer: ReturnType<typeof setInterval> | null = null;
  let captureInFlight = false;
  let backscanInFlight = false;
  const captureCanvas = bufferEnabled ? document.createElement("canvas") : null;
  const captureCtx = captureCanvas ? captureCanvas.getContext("2d") : null;

  function pushFrame(image: ImageBitmap | ImageData) {
    const now = Date.now();
    frameBuffer.push({ id: nextFrameId++, ts: now, image });
    while (frameBuffer.length > bufferMaxFrames || now - frameBuffer[0]!.ts > bufferMs) {
      const old = frameBuffer.shift();
      if (old && "close" in old.image) {
        old.image.close();
      }
    }
  }

  function captureFrame() {
    if (!captureCtx || !captureCanvas || captureInFlight) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    if (captureCanvas.width !== w || captureCanvas.height !== h) {
      captureCanvas.width = w;
      captureCanvas.height = h;
    }
    captureCtx.drawImage(video, 0, 0, w, h);
    if (typeof createImageBitmap === "function") {
      captureInFlight = true;
      createImageBitmap(captureCanvas)
        .then((bitmap) => pushFrame(bitmap))
        .finally(() => {
          captureInFlight = false;
        });
    } else {
      const imageData = captureCtx.getImageData(0, 0, w, h);
      pushFrame(imageData);
    }
  }

  async function backscanBufferedFrames() {
    if (!scanImage || backscanInFlight || frameBuffer.length === 0) return;
    backscanInFlight = true;
    try {
      let scanned = 0;
      for (const frame of frameBuffer) {
        if (frame.id <= lastBackscanId) continue;
        try {
          const result = await scanImage(frame.image, { returnDetailedScanResult: true });
          const text = typeof result === "string" ? result : result.data;
          if (text) handleDecodedText(text);
        } catch {
          // ignore decode failures for buffered frames
        }
        lastBackscanId = frame.id;
        scanned += 1;
        if (scanned >= backscanBatchSize) break;
      }
    } finally {
      backscanInFlight = false;
    }
  }

  const qrScanner = new QrScanner(
    video,
    (result) => {
      const text = typeof result === "string" ? result : result.data;
      handleDecodedText(text);
    },
    {
      returnDetailedScanResult: true,
      maxScansPerSecond: 20,
      calculateScanRegion: (v: HTMLVideoElement) => {
        const w = v.videoWidth;
        const h = v.videoHeight;
        const target = 1000;
        const scale = w >= h ? target / w : target / h;
        return {
          x: 0,
          y: 0,
          width: w,
          height: h,
          downScaledWidth: Math.round(w * scale),
          downScaledHeight: Math.round(h * scale),
        };
      },
    }
  );

  if (bufferEnabled && captureIntervalMs > 0) {
    captureTimer = setInterval(captureFrame, captureIntervalMs);
    backscanTimer = setInterval(backscanBufferedFrames, backscanIntervalMs);
  }

  qrScanner.start();

  return {
    stop() {
      qrScanner.stop();
      qrScanner.destroy();
      if (captureTimer) clearInterval(captureTimer);
      if (backscanTimer) clearInterval(backscanTimer);
      captureTimer = null;
      backscanTimer = null;
      for (const frame of frameBuffer) {
        if ("close" in frame.image) {
          frame.image.close();
        }
      }
      frameBuffer.length = 0;
    },
  };
}
