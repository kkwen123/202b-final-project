import { Client } from "@notionhq/client";

import { UploadApiError, type NotionWriteInput, type NotionWriteResult } from "../types/api";

export interface NotionService {
  writeVoiceNote(input: NotionWriteInput): Promise<NotionWriteResult>;
}

interface NotionServiceOptions {
  apiKey: string;
  databaseId: string;
}
type VoiceNoteCreateRequest = Parameters<Client["pages"]["create"]>[0];

const MAX_RICH_TEXT_CHARS = 1800;
const MAX_BLOCK_CHARS = 1800;
const MAX_TITLE_CHARS = 80;
const MIN_REASONABLE_RECORDING_UNIX_MS = Date.UTC(2020, 0, 1);

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function toTranscriptBlocks(transcript: string) {
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += MAX_BLOCK_CHARS) {
    chunks.push(transcript.slice(i, i + MAX_BLOCK_CHARS));
  }

  if (chunks.length === 0) {
    chunks.push("(No transcript text)");
  }

  return chunks.map((chunk) => ({
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: [
        {
          type: "text" as const,
          text: {
            content: chunk
          }
        }
      ]
    }
  }));
}

function isReasonableRecordedTime(unixMs: number, nowUnixMs: number): boolean {
  if (!Number.isFinite(unixMs) || unixMs <= 0) {
    return false;
  }
  if (unixMs < MIN_REASONABLE_RECORDING_UNIX_MS) {
    return false;
  }
  if (unixMs > nowUnixMs + 24 * 60 * 60 * 1000) {
    return false;
  }
  return true;
}

function resolveRecordedDate(input: NotionWriteInput): Date {
  const nowUnixMs = Date.now();
  const candidate = isReasonableRecordedTime(input.recordedAtUnixMs, nowUnixMs)
    ? input.recordedAtUnixMs
    : input.ingestedAtUnixMs || nowUnixMs;

  const date = new Date(candidate);
  if (Number.isNaN(date.valueOf())) {
    return new Date(nowUnixMs);
  }

  return date;
}

function cleanTitleCandidateLine(line: string): string {
  return line
    .replace(/^[\s*\-•\d.)]+/, "")
    .replace(/^summary[:\-\s]*/i, "")
    .replace(/^title[:\-\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBriefTitle(summary: string, transcript: string): string | null {
  const candidates: string[] = [];

  for (const source of [summary, transcript]) {
    if (!source?.trim()) {
      continue;
    }

    const lines = source
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => cleanTitleCandidateLine(line))
      .filter((line) => line.length > 0);

    if (lines.length > 0) {
      candidates.push(lines[0]);
    }
  }

  for (const raw of candidates) {
    const firstSentence = raw.split(/[.!?]/)[0]?.trim() || raw;
    const cleaned = firstSentence.replace(/["`]/g, "").trim();
    if (cleaned.length < 4) {
      continue;
    }
    return truncate(cleaned, MAX_TITLE_CHARS);
  }

  return null;
}

function formatFallbackTitle(recordedAt: Date): string {
  return `Voice Note ${recordedAt.toISOString().replace("T", " ").slice(0, 19)}`;
}

function buildTitle(input: NotionWriteInput, recordedAt: Date): string {
  const brief = extractBriefTitle(input.summary, input.transcript);
  return brief || formatFallbackTitle(recordedAt);
}

export function buildVoiceNoteCreateRequest(input: NotionWriteInput, databaseId: string): VoiceNoteCreateRequest {
  const recordedAt = resolveRecordedDate(input);
  const title = buildTitle(input, recordedAt);

  return {
    parent: { database_id: databaseId },
    properties: {
      Title: {
        title: [{ type: "text", text: { content: title } }]
      },
      "Recorded At": {
        date: { start: recordedAt.toISOString() }
      },
      "Duration Sec": {
        number: Math.round(input.durationMs / 1000)
      },
      Summary: {
        rich_text: [{ type: "text", text: { content: truncate(input.summary, MAX_RICH_TEXT_CHARS) } }]
      },
      "Note ID": {
        rich_text: [{ type: "text", text: { content: input.noteId } }]
      },
      Status: {
        select: { name: "Processed" }
      }
    },
    children: toTranscriptBlocks(input.transcript)
  };
}

export function createNotionService(options: NotionServiceOptions): NotionService {
  const notion = new Client({ auth: options.apiKey });

  return {
    async writeVoiceNote(input: NotionWriteInput): Promise<NotionWriteResult> {
      try {
        const request = buildVoiceNoteCreateRequest(input, options.databaseId);
        const page = await notion.pages.create(request);

        return { notionPageId: page.id };
      } catch {
        throw new UploadApiError(502, "NOTION_FAILED", true, "Failed to write note into Notion");
      }
    }
  };
}
