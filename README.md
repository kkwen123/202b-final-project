# Voice Note Device Prototype (ESP32 + Node.js)

Prototype repository for a single-purpose physical voice note device.

## Scope

- ESP32 + INMP441 records `16kHz mono PCM16 WAV`.
- Audio is queued on SD card.
- Backend receives WAV upload, transcribes via OpenAI, summarizes, writes to Notion.
- Device deletes local audio only after backend confirms full processing success.
- Supports temporary offline operation with retry on boot, recording stop, and idle intervals.

## Monorepo layout

- `server/`: Express TypeScript backend.
- `firmware/`: Arduino `.ino` sketch and configuration template.
- `docs/`: architecture, wiring, demo steps.

## Quick Start

### 1) Backend setup

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Required environment values in `server/.env`:

- `DEVICE_TOKEN`
- `OPENAI_API_KEY`
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID`

Optional overrides:

- `PORT`
- `OPENAI_TRANSCRIPTION_MODEL`
- `OPENAI_SUMMARY_MODEL`
- `MAX_UPLOAD_BYTES`
- `TEMP_UPLOAD_DIR`

### 2) Firmware setup

1. Copy `firmware/config.example.h` to `firmware/config.h`.
2. Set Wi-Fi credentials, backend host/port/path, and token.
3. Verify pin mapping for your board and wiring.
4. Flash `firmware/voice_note_device.ino` via Arduino IDE.

## API contract

`POST /api/v1/notes/upload`

- Header: `Authorization: Bearer <DEVICE_TOKEN>`
- Multipart fields:
  - `device_id`
  - `note_id`
  - `recorded_at_unix_ms`
  - `duration_ms`
  - `sample_rate_hz` (must be `16000`)
  - `sha256_hex`
  - `audio` (`.wav`)

Success response:

```json
{
  "status": "processed",
  "note_id": "a1b2c3d4e5f6g7h8",
  "notion_page_id": "xxxxxxxx",
  "transcript_chars": 1234,
  "summary_chars": 280
}
```

Error response:

```json
{
  "status": "error",
  "code": "TRANSCRIBE_FAILED",
  "retryable": true,
  "message": "short diagnostic"
}
```

## Notion database properties

Expected properties in your existing Notion database:

- `Title` (title)
- `Device ID` (rich_text)
- `Recorded At` (date)
- `Duration Sec` (number)
- `Summary` (rich_text)
- `Note ID` (rich_text)
- `Status` (select)

Transcript is stored as page content blocks.

## Testing

```bash
cd server
npm test
npm run build
```

Current test suite covers auth, validation, retryable upstream failures, temp-file cleanup, and happy-path upload contract behavior.
