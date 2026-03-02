# qrcode-transmitter

[![npm downloads](https://img.shields.io/npm/dm/qrcode-transmitter?logo=npm)](https://www.npmjs.com/package/qrcode-transmitter)

A lightweight browser-oriented library for splitting arbitrary binary data into multiple QR frames and reassembling it on scan.

## Features

- Splits `Uint8Array` payloads into protocol frames and encodes each frame as QR SVG
- Scans QR codes from camera input and reassembles payloads automatically
- Handles duplicate frames and out-of-order frame delivery (`msgId + frameIndex` aggregation)
- Includes a runnable example app for local testing and demos

## Installation

```bash
pnpm add qrcode-transmitter
```

You can also install it with `npm` or `yarn`.

## Quick Start

```ts
import { encodeBytesToQRCodes, startVideoQRReceiver } from "qrcode-transmitter";

// 1) Sender: encode data into multiple QR frames
const bytes = new TextEncoder().encode("Hello QR");
const frames = encodeBytesToQRCodes(bytes);
// frames[i].svg can be injected into the DOM directly

// 2) Receiver: scan with a video element and reassemble
const video = document.querySelector("video") as HTMLVideoElement;
const receiver = startVideoQRReceiver(video, {
  onFrame: (progress) => {
    console.log(progress.frameIndex + 1, "/", progress.totalFrames);
  },
  onComplete: (data) => {
    console.log(new TextDecoder().decode(data));
  },
});

// Stop scanning when needed
receiver.stop();
```

## API

### `encodeBytesToQRCodes(bytes: Uint8Array): EncodedFrame[]`

Encodes a raw byte array and returns QR frame objects:

- `frameIndex`: frame index (starting from 0)
- `totalFrames`: total number of frames
- `svg`: QR code SVG string for this frame
- `payload`: base64 payload of this frame

Encoding settings are fixed to:

- QR `TypeNumber = 15`
- error correction level `L`
- `Byte` mode for writing payload data

### `startVideoQRReceiver(video, options): { stop(): void }`

Starts scanning and reassembles data by protocol:

- `video`: `HTMLVideoElement`
- `options.onFrame`: called when each new (non-duplicate) frame is parsed
- `options.onComplete`: called when all frames are received, with the complete `Uint8Array`

Returns an object with `stop()` to stop and destroy the scanner.

## Protocol

Frame text format:

`msgId|idx/total|payloadBase64`

- `msgId`: 8-character random hexadecimal string
- `idx`: current chunk index
- `total`: total chunk count
- `payloadBase64`: base64 payload of the chunk

## Local Development

```bash
pnpm install
pnpm build
pnpm test
pnpm example
```

Common scripts:

- `pnpm build`: build to `dist/` with `tsup`
- `pnpm dev`: watch build
- `pnpm typecheck`: run TypeScript type checks
- `pnpm test`: run Vitest
- `pnpm example`: start the example app (Vite)

## Run the Example

Live demo: https://haruamamiya.github.io/qrcode-transmitter/

After running `pnpm example`:

- In the "Encode" section, enter text or select a file to render QR frames at 5fps
- In the "Decode" section, allow camera permission and scan to see reconstructed output
