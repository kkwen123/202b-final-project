import fs from "node:fs";
import path from "node:path";

import OpenAI, { toFile } from "openai";

import { UploadApiError } from "../types/api";

export interface OpenAIService {
  transcribe(filePath: string, sourceFilename?: string): Promise<string>;
  summarize(transcript: string): Promise<string>;
}

interface OpenAIServiceOptions {
  apiKey: string;
  transcriptionModel: string;
  summaryModel: string;
}

const SUMMARY_SYSTEM_PROMPT =
  "You are a concise assistant. Summarize this voice note into 4-6 bullet points and a final one-line action list.";

function formatOpenAIError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "unknown_error";
  }

  const err = error as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: { code?: string; type?: string; message?: string };
  };

  const status = err.status;
  const code = err.code || err.error?.code;
  const type = err.type || err.error?.type;
  const message = err.message || err.error?.message;

  const parts = [
    status ? `status=${status}` : "",
    code ? `code=${code}` : "",
    type ? `type=${type}` : "",
    message ? `message=${message}` : ""
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : "unknown_error_shape";
}

export function createOpenAIService(options: OpenAIServiceOptions): OpenAIService {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    async transcribe(filePath: string, sourceFilename?: string): Promise<string> {
      try {
        const fallbackName = "voice-note.wav";
        const baseName = sourceFilename ? path.basename(sourceFilename) : fallbackName;
        const fileNameForUpload = /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.wav`;
        const uploadable = await toFile(fs.createReadStream(filePath), fileNameForUpload, { type: "audio/wav" });

        const transcript = await client.audio.transcriptions.create({
          file: uploadable,
          model: options.transcriptionModel,
          response_format: "text"
        });

        const text = transcript.trim();
        if (!text) {
          throw new UploadApiError(502, "TRANSCRIBE_FAILED", true, "Transcription was empty");
        }

        return text;
      } catch (error) {
        if (error instanceof UploadApiError) {
          throw error;
        }
        const detail = formatOpenAIError(error);
        // eslint-disable-next-line no-console
        console.error(`[OPENAI] transcription failed model=${options.transcriptionModel} ${detail}`);
        throw new UploadApiError(502, "TRANSCRIBE_FAILED", true, `Failed to transcribe audio: ${detail}`);
      }
    },

    async summarize(transcript: string): Promise<string> {
      try {
        const response = await client.responses.create({
          model: options.summaryModel,
          input: [
            {
              role: "system",
              content: SUMMARY_SYSTEM_PROMPT
            },
            {
              role: "user",
              content: transcript
            }
          ]
        });

        const summary = response.output_text.trim();
        if (!summary) {
          throw new UploadApiError(502, "SUMMARIZE_FAILED", true, "Summary was empty");
        }

        return summary;
      } catch (error) {
        if (error instanceof UploadApiError) {
          throw error;
        }
        const detail = formatOpenAIError(error);
        // eslint-disable-next-line no-console
        console.error(`[OPENAI] summary failed model=${options.summaryModel} ${detail}`);
        throw new UploadApiError(502, "SUMMARIZE_FAILED", true, `Failed to summarize transcript: ${detail}`);
      }
    }
  };
}
