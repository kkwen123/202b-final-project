# Hardware Wiring (Prototype)

This wiring table matches `firmware/config.example.h` defaults.

## ESP32 <- INMP441

- `GPIO5` -> `INMP441 SCK` (BCLK)
- `GPIO4` -> `INMP441 WS` (LRCLK)
- `GPIO6` -> `INMP441 SD` (DOUT)
- `3V3` -> `INMP441 VDD`
- `GND` -> `INMP441 GND`
- `INMP441 L/R` -> `GND` (left-channel selection)

## ESP32 <- SD Module (SPI)

- `GPIO10` -> `SD CS`
- `GPIO12` -> `SD SCK`
- `GPIO11` -> `SD MOSI`
- `GPIO13` -> `SD MISO`
- `3V3` -> `SD VCC`
- `GND` -> `SD GND`

## ESP32 <- Button

- `GPIO21` -> one side of momentary button
- other side -> `GND`
- firmware uses `INPUT_PULLUP`, no external resistor required
- for a 4-prong tactile button, each same-side pin pair is internally connected
- use one leg from each opposite side (usually across the breadboard center gap), not two legs on the same side

## ESP32 -> LED

- `GPIO2` -> LED anode through resistor (~220 ohm)
- LED cathode -> `GND`

## Power

- USB power bank to ESP32 USB port (recommended for prototype stability)

## Notes

- Keep mic and SD grounds common with ESP32 ground.
- Keep I2S wires short to reduce noise.
- Start with SD VCC at `3V3`; if writes are unstable, test `5V` only if your SD module explicitly supports it.
