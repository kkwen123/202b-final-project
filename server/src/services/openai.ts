import fs from "node:fs";

import OpenAI from "openai";

import { UploadApiError } from "../types/api";

export interface OpenAIService {
  transcribe(filePath: string): Promise<string>;
  summarize(transcript: string): Promise<string>;
}

interface OpenAIServiceOptions {
  apiKey: string;
  transcriptionModel: string;
  summaryModel: string;
}

const SUMMARY_SYSTEM_PROMPT =
  "You are a concise assistant. Summarize this voice note into 4-6 bullet points and a final one-line action list.";

export function createOpenAIService(options: OpenAIServiceOptions): OpenAIService {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    async transcribe(filePath: string): Promise<string> {
      try {
        const transcript = await client.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
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
        throw new UploadApiError(502, "TRANSCRIBE_FAILED", true, "Failed to transcribe audio");
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
        throw new UploadApiError(502, "SUMMARIZE_FAILED", true, "Failed to summarize transcript");
      }
    }
  };
}
