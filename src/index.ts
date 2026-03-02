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

/**
 * Encode byte array to QR codes with TypeNumber=15 and L error correction
 * @param bytes Raw byte array
 * @returns Array of encoded results with frame indices
 */
export function encodeBytesToQRCodes(bytes: Uint8Array): EncodedFrame[] {
  const frames = splitIntoFrames(bytes);
  const result: EncodedFrame[] = [];

  for (const { frameIndex, totalFrames, frame, payloadBase64 } of frames) {
    const qr = qrcode(TYPE_NUMBER, ERROR_CORRECTION);
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
  /** Fired when the complete message is received */
  onComplete?: (data: Uint8Array) => void;
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
  const { onFrame, onComplete } = options;
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
      if (res.complete && res.data && onComplete) {
        onComplete(res.data);
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
