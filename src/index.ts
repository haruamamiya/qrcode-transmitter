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
  const { onFrame, onComplete, onVerifyFailed } = options;
  const aggregator = new FrameAggregator();

  const qrScanner = new QrScanner(
    video,
    (result) => {
      const text = typeof result === "string" ? result : result.data;
      const parsed = parseFrame(text);
      if (!parsed) return;
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

  qrScanner.start();

  return {
    stop() {
      qrScanner.stop();
      qrScanner.destroy();
    },
  };
}
