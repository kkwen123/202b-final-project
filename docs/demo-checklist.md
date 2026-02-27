# Demo Checklist

## Pre-demo

1. Confirm backend is running (`GET /health` returns `{ "status": "ok" }`).
2. Confirm `server/.env` has valid OpenAI + Notion credentials.
3. Confirm firmware `config.h` has correct Wi-Fi, backend host, and token.
4. Insert SD card and power ESP32 from USB power bank.
5. Open serial monitor at `115200` baud.

## Demo flow: online immediate sync

1. Press button to start recording.
2. Speak for 15-30 seconds.
3. Press button to stop recording.
4. Watch serial logs for upload + processed confirmation.
5. Verify note appears in Notion with transcript and summary.
6. Verify note files are removed from SD queue.

## Demo flow: offline then sync

1. Turn off Wi-Fi AP or use wrong Wi-Fi temporarily.
2. Record and stop.
3. Confirm `.wav` + `.meta` remain in `/queue`.
4. Restore Wi-Fi.
5. Trigger retry (wait idle interval, press/stop again, or reboot).
6. Confirm successful upload and local deletion.

## Fault injection

1. Break backend token intentionally.
2. Record and stop.
3. Confirm upload fails and `.meta` state increments attempts.
4. Restore token.
5. Confirm next retry succeeds.

## Quick troubleshooting

- `S100`: SD init failure (check wiring/card).
- `I100`: I2S init failure (check mic pins).
- `N101`: Wi-Fi timeout (check credentials/signal).
- `U104`: backend response not confirmed (check API payload and token).
