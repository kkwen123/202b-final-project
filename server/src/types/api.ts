export type UploadErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_FAILED"
  | "HASH_MISMATCH"
  | "TRANSCRIBE_FAILED"
  | "SUMMARIZE_FAILED"
  | "NOTION_FAILED"
  | "INTERNAL_ERROR";

export interface UploadSuccessResponse {
  status: "processed";
  note_id: string;
  notion_page_id: string;
  transcript_chars: number;
  summary_chars: number;
}

export interface UploadErrorResponse {
  status: "error";
  code: UploadErrorCode;
  retryable: boolean;
  message: string;
}

export interface UploadRequestFields {
  device_id: string;
  note_id: string;
  recorded_at_unix_ms: string;
  duration_ms: string;
  sample_rate_hz: string;
  sha256_hex: string;
}

export interface ValidatedUploadRequest {
  deviceId: string;
  noteId: string;
  recordedAtUnixMs: number;
  durationMs: number;
  sampleRateHz: number;
  sha256Hex: string;
}

export interface NotionWriteInput {
  deviceId: string;
  noteId: string;
  recordedAtUnixMs: number;
  durationMs: number;
  summary: string;
  transcript: string;
}

export interface NotionWriteResult {
  notionPageId: string;
}

export class UploadApiError extends Error {
  readonly statusCode: number;
  readonly code: UploadErrorCode;
  readonly retryable: boolean;

  constructor(statusCode: number, code: UploadErrorCode, retryable: boolean, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.name = "UploadApiError";
  }
}
