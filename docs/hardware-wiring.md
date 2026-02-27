# Hardware Wiring (Prototype)

This wiring table matches `firmware/config.example.h` defaults.

## ESP32 <- INMP441

- `GPIO26` -> `INMP441 SCK` (BCLK)
- `GPIO25` -> `INMP441 WS` (LRCLK)
- `GPIO33` -> `INMP441 SD` (DOUT)
- `3V3` -> `INMP441 VDD`
- `GND` -> `INMP441 GND`
- `INMP441 L/R` -> `GND` (left-channel selection)

## ESP32 <- SD Module (SPI)

- `GPIO5` -> `SD CS`
- `GPIO18` -> `SD SCK`
- `GPIO23` -> `SD MOSI`
- `GPIO19` -> `SD MISO`
- `3V3 or 5V` -> `SD VCC` (depends on module; verify your board)
- `GND` -> `SD GND`

## ESP32 <- Button

- `GPIO13` -> one side of momentary button
- other side -> `GND`
- firmware uses `INPUT_PULLUP`, no external resistor required

## ESP32 -> LED

- `GPIO2` -> LED anode through resistor (~220 ohm)
- LED cathode -> `GND`

## Power

- USB power bank to ESP32 USB port (recommended for prototype stability)

## Notes

- Keep mic and SD grounds common with ESP32 ground.
- Keep I2S wires short to reduce noise.
- If SD writes fail intermittently, test SD VCC at both `3V3` and `5V` depending on module design.
