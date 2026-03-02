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

function formatTitle(recordedAtUnixMs: number): string {
  const date = new Date(recordedAtUnixMs);
  const iso = Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
  return `Voice Note ${iso.replace("T", " ").slice(0, 19)}`;
}

export function buildVoiceNoteCreateRequest(input: NotionWriteInput, databaseId: string): VoiceNoteCreateRequest {
  const recordedAt = new Date(input.recordedAtUnixMs);
  const safeRecordedAt = Number.isNaN(recordedAt.valueOf()) ? new Date() : recordedAt;

  return {
    parent: { database_id: databaseId },
    properties: {
      Title: {
        title: [{ type: "text", text: { content: formatTitle(input.recordedAtUnixMs) } }]
      },
      "Recorded At": {
        date: { start: safeRecordedAt.toISOString() }
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
