# ESP32 Firmware (Arduino IDE)

This folder contains the prototype firmware for the INMP441 voice note device.

## Files

- `voice_note_device.ino`: main firmware sketch.
- `config.example.h`: template for local secrets and board-specific pin mapping.

## Required parts
- ESP32-S3-WROOM-1 dev board
- INMP441 I2S MEMS microphone module
- MicroSD card (FAT32)
- SPI MicroSD card module/adapter
- Momentary push button
- Single LED
- Current-limiting resistor for LED (typically ~220Ω)
- Breadboard
- Jumper wires
- USB power bank / 5V power source
- USB Micro B to power bank cord

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

- INMP441 `WS/LRCLK` -> `GPIO4`
- INMP441 `SCK/BCLK` -> `GPIO5`
- INMP441 `SD` -> `GPIO6`
- SD module `CS` -> `GPIO10`
- SD module `MOSI` -> `GPIO11`
- SD module `SCK` -> `GPIO12`
- SD module `MISO` -> `GPIO13`
- Button -> `GPIO21` (to GND, uses `INPUT_PULLUP`)
- LED -> `GPIO2`

## Runtime behavior

- Press button once: start recording (LED ON).
- Press again: stop recording (LED OFF).
- Recording is saved as `PCM16 WAV` at `16kHz mono` into `/queue` on SD.
- Device tries upload on boot, on stop, and periodically while idle.
- Local files are deleted only when backend returns confirmed `status=processed` with matching `note_id`.
