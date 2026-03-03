import { encodeBytesToQRCodes, startVideoQRReceiver } from "qrcode-transmitter";

const SWITCH_INTERVAL_MS = 1000 / 5;

// --- Encode ---
const encodeInput = document.getElementById("encode-input") as HTMLTextAreaElement;
const encodeTextBtn = document.getElementById("encode-text") as HTMLButtonElement;
const encodeFileBtn = document.getElementById("encode-file") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const qrDisplay = document.getElementById("qr-display")!;
const qrStatus = document.getElementById("qr-status")!;
const qrFrameInfo = document.getElementById("qr-frame-info")!;

let encodeInterval: ReturnType<typeof setInterval> | null = null;

function stopEncodeInterval() {
  if (encodeInterval) {
    clearInterval(encodeInterval);
    encodeInterval = null;
  }
}

function showQRCodes(frames: { frameIndex: number; totalFrames: number; svg: string }[]) {
  stopEncodeInterval();
  if (frames.length === 0) return;
  let idx = 0;
  const total = frames.length;
  qrDisplay.innerHTML = frames[0]!.svg;
  qrStatus.textContent = `${total} frames total, 5 frames per second`;
  qrFrameInfo.textContent = `Frame ${frames[0]!.frameIndex + 1} / ${total}`;
  encodeInterval = setInterval(() => {
    idx = (idx + 1) % frames.length;
    qrDisplay.innerHTML = frames[idx]!.svg;
    qrFrameInfo.textContent = `Frame ${frames[idx]!.frameIndex + 1} / ${total}`;
  }, SWITCH_INTERVAL_MS);
}

encodeTextBtn.addEventListener("click", () => {
  const text = encodeInput.value.trim();
  const bytes = new TextEncoder().encode(text);
  const frames = encodeBytesToQRCodes(bytes);
  showQRCodes(frames);
});

encodeFileBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const buf = reader.result as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    const frames = encodeBytesToQRCodes(bytes);
    showQRCodes(frames);
    qrStatus.textContent = `File ${file.name}, ${frames.length} frames`;
  };
  reader.readAsArrayBuffer(file);
});

// --- Decode ---
const video = document.getElementById("video") as HTMLVideoElement;
const videoContainer = document.getElementById("video-container")!;
const startScanBtn = document.getElementById("start-scan") as HTMLButtonElement;
const stopScanBtn = document.getElementById("stop-scan") as HTMLButtonElement;
const scanProgress = document.getElementById("scan-progress")!;
const receivedLabel = document.getElementById("received-label")!;
const received = document.getElementById("received")!;
const downloadControls = document.getElementById("download-controls")!;
const downloadFilenameInput = document.getElementById("download-filename") as HTMLInputElement;
const downloadReceivedBtn = document.getElementById("download-received") as HTMLButtonElement;

let receiver: ReturnType<typeof startVideoQRReceiver> | null = null;
let lastReceivedData: Uint8Array | null = null;

function isProbablyText(data: Uint8Array): { isText: boolean; text?: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    let suspicious = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        suspicious++;
      }
    }
    const suspiciousRatio = text.length > 0 ? suspicious / text.length : 0;
    if (suspiciousRatio > 0.05) return { isText: false };
    return { isText: true, text };
  } catch {
    return { isText: false };
  }
}

downloadReceivedBtn.addEventListener("click", () => {
  if (!lastReceivedData) return;
  const payload = Uint8Array.from(lastReceivedData);
  const blob = new Blob([payload], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const rawFilename = downloadFilenameInput.value.trim();
  a.download = rawFilename.length > 0 ? rawFilename : "received.bin";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

startScanBtn.addEventListener("click", () => {
  videoContainer.style.display = "block";
  scanProgress.textContent = "";
  receivedLabel.style.display = "none";
  received.textContent = "";
  downloadControls.style.display = "none";
  downloadFilenameInput.value = "received.bin";
  lastReceivedData = null;
  receiver = startVideoQRReceiver(video, {
    onFrame: (p) => {
      scanProgress.textContent = `Parsed frame ${p.frameIndex + 1}/${p.totalFrames} (${p.receivedCount} received)`;
    },
    onComplete: (data) => {
      lastReceivedData = data;
      const result = isProbablyText(data);
      if (result.isText) {
        const text = result.text ?? "";
        received.textContent = text;
        downloadControls.style.display = "none";
      } else {
        received.textContent = `[Binary ${data.length} bytes]`;
        downloadControls.style.display = "block";
      }
      receivedLabel.style.display = "block";
      scanProgress.textContent = `Complete, ${data.length} bytes received`;
    },
  });
  startScanBtn.disabled = true;
  stopScanBtn.disabled = false;
});

stopScanBtn.addEventListener("click", () => {
  if (receiver) {
    receiver.stop();
    receiver = null;
  }
  videoContainer.style.display = "none";
  scanProgress.textContent = "";
  downloadControls.style.display = "none";
  downloadFilenameInput.value = "received.bin";
  lastReceivedData = null;
  startScanBtn.disabled = false;
  stopScanBtn.disabled = true;
});
