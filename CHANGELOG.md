# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `typeNumber` parameter for `encodeBytesToQRCodes` to customize QR version (default 15)
- Buffered backscan for `startVideoQRReceiver` to recover fast-switched frames (configurable via options)

## [1.1.0] - 2026-03-03

### Added

- SHA-256 integrity verification: frame 0 now carries `sha256Base64` of the full payload
- `onVerifyFailed` callback in `VideoQRReceiverOptions` when SHA-256 verification fails
- `sha256Base64(data)` helper for computing SHA-256 digest in base64

### Changed

- `encodeBytesToQRCodes` is now async (returns `Promise<EncodedFrame[]>`)
- `onComplete` only fires when SHA-256 verification passes
- Protocol: frame 0 format is `msgId|0/total|sha256Base64|payloadBase64`; old format without hash is no longer supported

### Breaking

- `encodeBytesToQRCodes` returns `Promise<EncodedFrame[]>`; callers must await
- Frame 0 must include `sha256Base64`; receivers reject frames without it

## [1.0.0] - 2026-03-03

### Added

- Added `encodeBytesToQRCodes` to split `Uint8Array` payloads into protocol frames and generate QR SVG output
- Added `startVideoQRReceiver` to scan QR frames from camera input and reconstruct complete data automatically
- Added chunk protocol and aggregation logic (frame parsing, deduplication, and out-of-order reassembly)
- Added example app and tests covering protocol and main flow
