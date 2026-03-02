/**
 * Chunking protocol
 * Frame format: msgId|idx/total|payloadBase64
 */

const TYPE15_BYTE_CAPACITY = 520; // TypeNumber 15, L error correction

function randomMsgId(): string {
  return Math.random().toString(16).slice(2, 10);
}

function estimateHeaderLength(total: number): number {
  const idxDigits = String(Math.max(0, total - 1)).length;
  const totalDigits = String(total).length;
  return 8 + 1 + idxDigits + 1 + totalDigits + 1;
}

export interface FrameInfo {
  frameIndex: number;
  totalFrames: number;
  frame: string;
  payloadBase64: string;
}

/**
 * Split byte array into chunks, each encoded as a protocol frame
 */
export function splitIntoFrames(bytes: Uint8Array): FrameInfo[] {
  if (bytes.length === 0) {
    return [{ frameIndex: 0, totalFrames: 1, frame: encodeFrame(randomMsgId(), 0, 1, ""), payloadBase64: "" }];
  }

  const msgId = randomMsgId();
  const headerOverhead = estimateHeaderLength(1) + 4;
  const maxPayloadChars = TYPE15_BYTE_CAPACITY - headerOverhead;
  const maxPayloadBytes = Math.floor((maxPayloadChars * 3) / 4);

  if (maxPayloadBytes <= 0) {
    throw new Error("Protocol header too large for Type 15 QR capacity");
  }

  const total = Math.ceil(bytes.length / maxPayloadBytes);
  const headerLen = estimateHeaderLength(total) + 4;
  const maxPayloadCharsActual = TYPE15_BYTE_CAPACITY - headerLen;
  const maxPayloadBytesActual = Math.floor((maxPayloadCharsActual * 3) / 4);

  const frames: FrameInfo[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, Math.min(offset + maxPayloadBytesActual, bytes.length));
    const chunkBase64 = btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    const frame = encodeFrame(msgId, frames.length, total, chunkBase64);
    frames.push({ frameIndex: frames.length, totalFrames: total, frame, payloadBase64: chunkBase64 });
    offset += chunk.length;
  }

  return frames;
}

function encodeFrame(msgId: string, idx: number, total: number, payloadBase64: string): string {
  return `${msgId}|${idx}/${total}|${payloadBase64}`;
}

export interface ParsedFrame {
  msgId: string;
  idx: number;
  total: number;
  payloadBase64: string;
}

/**
 * Parse protocol frame, returns null for invalid format
 */
export function parseFrame(text: string): ParsedFrame | null {
  const pipe1 = text.indexOf("|");
  if (pipe1 < 0) return null;
  const msgId = text.slice(0, pipe1);
  const rest2 = text.slice(pipe1 + 1);
  const slash = rest2.indexOf("/");
  const pipe2 = rest2.indexOf("|");
  if (slash < 0 || pipe2 < 0 || slash > pipe2) return null;
  const idx = parseInt(rest2.slice(0, slash), 10);
  const total = parseInt(rest2.slice(slash + 1, pipe2), 10);
  const payloadBase64 = rest2.slice(pipe2 + 1);
  if (isNaN(idx) || isNaN(total) || idx < 0 || total < 1 || idx >= total) return null;
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
}

/**
 * Message aggregation state: collect frames by msgId, reassemble when complete
 */
export class FrameAggregator {
  private chunks = new Map<string, Map<number, string>>();

  add(parsed: ParsedFrame): AddFrameResult {
    const { msgId, idx, total, payloadBase64 } = parsed;
    let map = this.chunks.get(msgId);
    if (!map) {
      map = new Map();
      this.chunks.set(msgId, map);
    }
    const isNew = !map.has(idx);
    if (isNew) map.set(idx, payloadBase64);
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

    const parts: Uint8Array[] = [];
    for (let i = 0; i < total; i++) {
      const b64 = map.get(i);
      if (!b64) {
        return { isNew, frameIndex: idx, totalFrames: total, msgId, receivedCount, complete: false };
      }
      parts.push(base64ToBytes(b64));
    }
    this.chunks.delete(msgId);
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
    };
  }
}
