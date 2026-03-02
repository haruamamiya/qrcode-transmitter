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

let receiver: ReturnType<typeof startVideoQRReceiver> | null = null;

startScanBtn.addEventListener("click", () => {
  videoContainer.style.display = "block";
  scanProgress.textContent = "";
  receivedLabel.style.display = "none";
  received.textContent = "";
  receiver = startVideoQRReceiver(video, {
    onFrame: (p) => {
      scanProgress.textContent = `Parsed frame ${p.frameIndex + 1}/${p.totalFrames} (${p.receivedCount} received)`;
    },
    onComplete: (data) => {
      try {
        const text = new TextDecoder().decode(data);
        received.textContent = text;
      } catch {
        received.textContent = `[Binary ${data.length} bytes]`;
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
  startScanBtn.disabled = false;
  stopScanBtn.disabled = true;
});
