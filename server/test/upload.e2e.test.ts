import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/index";
import type { NotionService } from "../src/services/notion";
import type { OpenAIService } from "../src/services/openai";
import { UploadApiError } from "../src/types/api";

const DEVICE_TOKEN = "test-device-token";
const SAMPLE_NOTE_ID = "note-abc-123";

const cleanupDirs: string[] = [];

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function buildForm(overrides?: Partial<Record<string, string>>) {
  return {
    device_id: "device-1",
    note_id: SAMPLE_NOTE_ID,
    recorded_at_unix_ms: String(Date.now()),
    duration_ms: "20000",
    sample_rate_hz: "16000",
    sha256_hex: "",
    ...overrides
  };
}

async function createTestApp(options?: {
  openaiService?: OpenAIService;
  notionService?: NotionService;
}) {
  const tempUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-note-server-test-"));
  cleanupDirs.push(tempUploadDir);

  const openaiService: OpenAIService =
    options?.openaiService ||
    ({
      async transcribe() {
        return "test transcript";
      },
      async summarize() {
        return "test summary";
      }
    } as OpenAIService);

  const notionService: NotionService =
    options?.notionService ||
    ({
      async writeVoiceNote() {
        return { notionPageId: "notion-page-id" };
      }
    } as NotionService);

  return createApp({
    config: {
      deviceToken: DEVICE_TOKEN,
      maxUploadBytes: 12 * 1024 * 1024,
      tempUploadDir
    },
    dependencies: {
      openaiService,
      notionService
    }
  });
}

async function uploadAudio(app: Awaited<ReturnType<typeof createTestApp>>, options?: {
  token?: string;
  formOverrides?: Partial<Record<string, string>>;
  content?: Buffer;
}) {
  const content = options?.content || Buffer.from("RIFF....WAVEfmt ");
  const form = buildForm(options?.formOverrides);
  form.sha256_hex = sha256Hex(content);

  let req = request(app)
    .post("/api/v1/notes/upload")
    .set("Authorization", `Bearer ${options?.token ?? DEVICE_TOKEN}`)
    .field("device_id", form.device_id)
    .field("note_id", form.note_id)
    .field("recorded_at_unix_ms", form.recorded_at_unix_ms)
    .field("duration_ms", form.duration_ms)
    .field("sample_rate_hz", form.sample_rate_hz)
    .field("sha256_hex", form.sha256_hex)
    .attach("audio", content, { filename: "note.wav", contentType: "audio/wav" });

  return req;
}

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("voice note upload flow", () => {
  it("returns health status", async () => {
    const app = await createTestApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("rejects unauthorized upload", async () => {
    const app = await createTestApp();
    const response = await uploadAudio(app, { token: "wrong-token" });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects invalid form", async () => {
    const app = await createTestApp();
    const response = await uploadAudio(app, {
      formOverrides: {
        duration_ms: "99999999"
      }
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("maps transcription errors to retryable 502", async () => {
    const app = await createTestApp({
      openaiService: {
        async transcribe() {
          throw new UploadApiError(502, "TRANSCRIBE_FAILED", true, "bad transcript");
        },
        async summarize() {
          return "will not run";
        }
      }
    });

    const response = await uploadAudio(app);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("TRANSCRIBE_FAILED");
    expect(response.body.retryable).toBe(true);
  });

  it("maps notion errors to retryable 502", async () => {
    const app = await createTestApp({
      notionService: {
        async writeVoiceNote() {
          throw new UploadApiError(502, "NOTION_FAILED", true, "notion down");
        }
      }
    });

    const response = await uploadAudio(app);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("NOTION_FAILED");
    expect(response.body.retryable).toBe(true);
  });

  it("deletes temp upload file after failure", async () => {
    const app = await createTestApp({
      openaiService: {
        async transcribe() {
          throw new UploadApiError(502, "TRANSCRIBE_FAILED", true, "bad transcript");
        },
        async summarize() {
          return "will not run";
        }
      }
    });

    const response = await uploadAudio(app);
    expect(response.status).toBe(502);

    const dir = cleanupDirs[cleanupDirs.length - 1];
    const entries = await fs.readdir(dir);
    expect(entries.length).toBe(0);
  });

  it("processes a full upload and returns success payload", async () => {
    const app = await createTestApp();

    const response = await uploadAudio(app);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("processed");
    expect(response.body.note_id).toBe(SAMPLE_NOTE_ID);
    expect(response.body.notion_page_id).toBe("notion-page-id");
    expect(typeof response.body.transcript_chars).toBe("number");
    expect(typeof response.body.summary_chars).toBe("number");
  });
});
