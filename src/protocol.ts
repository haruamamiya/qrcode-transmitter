/**
 * Chunking protocol
 * Frame 0: msgId|0/total|sha256Base64|payloadBase64
 * Frame i>0: msgId|idx/total|payloadBase64
 */

const TYPE15_BYTE_CAPACITY = 520; // TypeNumber 15, L error correction
const SHA256_BASE64_LENGTH = 44; // 32 bytes -> base64

function randomMsgId(): string {
  return Math.random().toString(16).slice(2, 10);
}

function estimateHeaderLength(total: number, forFrame0: boolean): number {
  const idxDigits = String(Math.max(0, total - 1)).length;
  const totalDigits = String(total).length;
  let len = 8 + 1 + idxDigits + 1 + totalDigits + 1;
  if (forFrame0) {
    len += SHA256_BASE64_LENGTH + 1; // |sha256Base64|
  }
  return len;
}

export interface FrameInfo {
  frameIndex: number;
  totalFrames: number;
  frame: string;
  payloadBase64: string;
}

/**
 * Split byte array into chunks, each encoded as a protocol frame.
 * @param bytes Raw byte array
 * @param sha256Base64 SHA-256 of bytes, base64-encoded (required for integrity verification)
 */
export function splitIntoFrames(bytes: Uint8Array, sha256Base64: string): FrameInfo[] {
  const msgId = randomMsgId();
  if (bytes.length === 0) {
    const frame = encodeFrame(msgId, 0, 1, "", sha256Base64);
    return [{ frameIndex: 0, totalFrames: 1, frame, payloadBase64: "" }];
  }

  const headerOverhead = estimateHeaderLength(1, true) + 4;
  const maxPayloadChars = TYPE15_BYTE_CAPACITY - headerOverhead;
  const maxPayloadBytes = Math.floor((maxPayloadChars * 3) / 4);

  if (maxPayloadBytes <= 0) {
    throw new Error("Protocol header too large for Type 15 QR capacity");
  }

  const total = Math.ceil(bytes.length / maxPayloadBytes);
  const headerLen = estimateHeaderLength(total, true) + 4;
  const maxPayloadCharsActual = TYPE15_BYTE_CAPACITY - headerLen;
  const maxPayloadBytesActual = Math.floor((maxPayloadCharsActual * 3) / 4);

  const frames: FrameInfo[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, Math.min(offset + maxPayloadBytesActual, bytes.length));
    const chunkBase64 = btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    const sha256 = frames.length === 0 ? sha256Base64 : undefined;
    const frame = encodeFrame(msgId, frames.length, total, chunkBase64, sha256);
    frames.push({ frameIndex: frames.length, totalFrames: total, frame, payloadBase64: chunkBase64 });
    offset += chunk.length;
  }

  return frames;
}

function encodeFrame(
  msgId: string,
  idx: number,
  total: number,
  payloadBase64: string,
  sha256Base64?: string
): string {
  if (idx === 0 && sha256Base64 !== undefined) {
    return `${msgId}|${idx}/${total}|${sha256Base64}|${payloadBase64}`;
  }
  return `${msgId}|${idx}/${total}|${payloadBase64}`;
}

export interface ParsedFrame {
  msgId: string;
  idx: number;
  total: number;
  payloadBase64: string;
  /** Present only for frame 0 */
  sha256Base64?: string;
}

/**
 * Parse protocol frame, returns null for invalid format.
 * Frame 0 must include sha256Base64; otherwise returns null.
 */
export function parseFrame(text: string): ParsedFrame | null {
  const pipe1 = text.indexOf("|");
  if (pipe1 < 0) return null;
  const msgId = text.slice(0, pipe1);
  const rest = text.slice(pipe1 + 1);
  const slash = rest.indexOf("/");
  const pipe2 = rest.indexOf("|");
  if (slash < 0 || pipe2 < 0 || slash > pipe2) return null;
  const idx = parseInt(rest.slice(0, slash), 10);
  const total = parseInt(rest.slice(slash + 1, pipe2), 10);
  if (isNaN(idx) || isNaN(total) || idx < 0 || total < 1 || idx >= total) return null;

  if (idx === 0) {
    const pipe3 = rest.indexOf("|", pipe2 + 1);
    if (pipe3 < 0) return null;
    const sha256Base64 = rest.slice(pipe2 + 1, pipe3);
    if (!sha256Base64) return null;
    const payloadBase64 = rest.slice(pipe3 + 1);
    return { msgId, idx, total, payloadBase64, sha256Base64 };
  }

  const payloadBase64 = rest.slice(pipe2 + 1);
  return { msgId, idx, total, payloadBase64 };
}

/**
 * Decode base64 to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface AddFrameResult {
  isNew: boolean;
  frameIndex: number;
  totalFrames: number;
  msgId: string;
  receivedCount: number;
  complete: boolean;
  data?: Uint8Array;
  expectedSha256Base64?: string;
}

/**
 * Message aggregation state: collect frames by msgId, reassemble when complete
 */
export class FrameAggregator {
  private chunks = new Map<string, Map<number, string>>();
  private expectedSha256 = new Map<string, string>();

  add(parsed: ParsedFrame): AddFrameResult {
    const { msgId, idx, total, payloadBase64, sha256Base64 } = parsed;
    let map = this.chunks.get(msgId);
    if (!map) {
      map = new Map();
      this.chunks.set(msgId, map);
    }
    const isNew = !map.has(idx);
    if (isNew) {
      map.set(idx, payloadBase64);
      if (idx === 0 && sha256Base64) {
        this.expectedSha256.set(msgId, sha256Base64);
      }
    }
    const receivedCount = map.size;

    if (receivedCount !== total) {
      return {
        isNew,
        frameIndex: idx,
        totalFrames: total,
        msgId,
        receivedCount,
        complete: false,
      };
    }

    const expectedSha256Base64 = this.expectedSha256.get(msgId);
    if (!expectedSha256Base64) {
      return { isNew, frameIndex: idx, totalFrames: total, msgId, receivedCount, complete: false };
    }

    const parts: Uint8Array[] = [];
    for (let i = 0; i < total; i++) {
      const b64 = map.get(i);
      if (!b64) {
        return { isNew, frameIndex: idx, totalFrames: total, msgId, receivedCount, complete: false };
      }
      parts.push(base64ToBytes(b64));
    }
    this.chunks.delete(msgId);
    this.expectedSha256.delete(msgId);
    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const data = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) {
      data.set(p, off);
      off += p.length;
    }
    return {
      isNew,
      frameIndex: idx,
      totalFrames: total,
      msgId,
      receivedCount,
      complete: true,
      data,
      expectedSha256Base64,
    };
  }
}
