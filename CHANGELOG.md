# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `encodeBytesToQRCodes` to split `Uint8Array` payloads into protocol frames and generate QR SVG output
- Added `startVideoQRReceiver` to scan QR frames from camera input and reconstruct complete data automatically
- Added chunk protocol and aggregation logic (frame parsing, deduplication, and out-of-order reassembly)
- Added example app and tests covering protocol and main flow
