import fs from "node:fs";
import { createHash } from "node:crypto";

import { Router, type Request } from "express";
import type multer from "multer";

import { safeDeleteFile } from "../services/cleanup";
import type { NotionService } from "../services/notion";
import type { OpenAIService } from "../services/openai";
import {
  UploadApiError,
  type UploadErrorResponse,
  type UploadRequestFields,
  type UploadSuccessResponse,
  type ValidatedUploadRequest
} from "../types/api";

interface UploadRouterDependencies {
  upload: multer.Multer;
  openaiService: OpenAIService;
  notionService: NotionService;
}

function validateBody(req: Request): ValidatedUploadRequest {
  const fields = req.body as Partial<UploadRequestFields>;

  const requiredFields: Array<keyof UploadRequestFields> = [
    "device_id",
    "note_id",
    "recorded_at_unix_ms",
    "duration_ms",
    "sample_rate_hz",
    "sha256_hex"
  ];

  for (const field of requiredFields) {
    if (!fields[field] || !fields[field]?.trim()) {
      throw new UploadApiError(400, "VALIDATION_FAILED", false, `Missing required field: ${field}`);
    }
  }

  const recordedAtUnixMs = Number.parseInt(fields.recorded_at_unix_ms as string, 10);
  const durationMs = Number.parseInt(fields.duration_ms as string, 10);
  const sampleRateHz = Number.parseInt(fields.sample_rate_hz as string, 10);

  if (!Number.isFinite(recordedAtUnixMs) || recordedAtUnixMs <= 0) {
    throw new UploadApiError(400, "VALIDATION_FAILED", false, "Invalid recorded_at_unix_ms");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 5 * 60 * 1000) {
    throw new UploadApiError(400, "VALIDATION_FAILED", false, "Invalid duration_ms");
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz !== 16000) {
    throw new UploadApiError(400, "VALIDATION_FAILED", false, "sample_rate_hz must be 16000");
  }

  const sha256Hex = (fields.sha256_hex as string).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256Hex)) {
    throw new UploadApiError(400, "VALIDATION_FAILED", false, "sha256_hex must be 64 hex chars");
  }

  return {
    deviceId: fields.device_id as string,
    noteId: fields.note_id as string,
    recordedAtUnixMs,
    durationMs,
    sampleRateHz,
    sha256Hex
  };
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sendUploadError(res: ResponseLike, error: unknown): void {
  if (error instanceof UploadApiError) {
    const payload: UploadErrorResponse = {
      status: "error",
      code: error.code,
      retryable: error.retryable,
      message: error.message
    };
    res.status(error.statusCode).json(payload);
    return;
  }

  const payload: UploadErrorResponse = {
    status: "error",
    code: "INTERNAL_ERROR",
    retryable: true,
    message: "Unhandled server error"
  };
  res.status(500).json(payload);
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(payload: unknown): void;
}

export function createUploadRouter(deps: UploadRouterDependencies): Router {
  const router = Router();

  router.post("/api/v1/notes/upload", deps.upload.single("audio"), async (req, res) => {
    const uploadedFilePath = req.file?.path;
    const ingestedAtUnixMs = Date.now();

    try {
      if (!req.file?.path) {
        throw new UploadApiError(400, "VALIDATION_FAILED", false, "Missing audio file field 'audio'");
      }

      const validated = validateBody(req);
      // eslint-disable-next-line no-console
      console.log(
        `[UPLOAD] received note_id=${validated.noteId} device_id=${validated.deviceId} duration_ms=${validated.durationMs}`
      );
      const computedHash = await sha256File(req.file.path);
      if (computedHash !== validated.sha256Hex) {
        throw new UploadApiError(400, "HASH_MISMATCH", true, "Uploaded file hash did not match sha256_hex");
      }

      const transcript = await deps.openaiService.transcribe(req.file.path, req.file.originalname);
      // eslint-disable-next-line no-console
      console.log(`[UPLOAD] transcribed note_id=${validated.noteId} transcript_chars=${transcript.length}`);
      const summary = await deps.openaiService.summarize(transcript);
      // eslint-disable-next-line no-console
      console.log(`[UPLOAD] summarized note_id=${validated.noteId} summary_chars=${summary.length}`);
      const notionResult = await deps.notionService.writeVoiceNote({
        noteId: validated.noteId,
        recordedAtUnixMs: validated.recordedAtUnixMs,
        ingestedAtUnixMs,
        durationMs: validated.durationMs,
        transcript,
        summary
      });
      // eslint-disable-next-line no-console
      console.log(`[UPLOAD] notion_write_ok note_id=${validated.noteId} page_id=${notionResult.notionPageId}`);

      const payload: UploadSuccessResponse = {
        status: "processed",
        note_id: validated.noteId,
        notion_page_id: notionResult.notionPageId,
        transcript_chars: transcript.length,
        summary_chars: summary.length
      };

      res.status(200).json(payload);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("[UPLOAD] failed", error);
      sendUploadError(res as ResponseLike, error);
    } finally {
      await safeDeleteFile(uploadedFilePath);
    }
  });

  return router;
}
