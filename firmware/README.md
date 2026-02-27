# ESP32 Firmware (Arduino IDE)

This folder contains the prototype firmware for the INMP441 voice note device.

## Files

- `voice_note_device.ino`: main firmware sketch.
- `config.example.h`: template for local secrets and board-specific pin mapping.

## Setup

1. Copy `config.example.h` to `config.h` in this folder.
2. Fill Wi-Fi, backend host/port/path, `DEVICE_TOKEN`, and pin mappings.
3. Install Arduino board support: `esp32 by Espressif Systems`.
4. Select your ESP32 board and serial port in Arduino IDE.

## Required Libraries

- Built-in ESP32 core libraries:
  - `WiFi`
  - `SPI`
  - `SD`
  - `driver/i2s.h`
  - `mbedtls/sha256.h`

No third-party Arduino library is required for the current sketch.

## Wiring assumptions

Default pins from `config.example.h`:

- INMP441 `WS/LRCLK` -> `GPIO25`
- INMP441 `SCK/BCLK` -> `GPIO26`
- INMP441 `SD` -> `GPIO33`
- SD module `CS` -> `GPIO5`
- Button -> `GPIO13` (to GND, uses `INPUT_PULLUP`)
- LED -> `GPIO2`

## Runtime behavior

- Press button once: start recording (LED ON).
- Press again: stop recording (LED OFF).
- Recording is saved as `PCM16 WAV` at `16kHz mono` into `/queue` on SD.
- Device tries upload on boot, on stop, and periodically while idle.
- Local files are deleted only when backend returns confirmed `status=processed` with matching `note_id`.
