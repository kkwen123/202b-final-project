import path from "node:path";

export interface AppConfig {
  port: number;
  deviceToken: string;
  openaiApiKey: string;
  openaiTranscriptionModel: string;
  openaiSummaryModel: string;
  notionApiKey: string;
  notionDatabaseId: string;
  maxUploadBytes: number;
  tempUploadDir: string;
}

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_SUMMARY_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

function requireString(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (!value || !value.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const port = parsePositiveInt("PORT", env.PORT, 3000);
  const maxUploadBytes = parsePositiveInt("MAX_UPLOAD_BYTES", env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  const tempUploadDir = env.TEMP_UPLOAD_DIR
    ? path.resolve(env.TEMP_UPLOAD_DIR)
    : path.resolve(process.cwd(), "tmp", "uploads");

  return {
    port,
    deviceToken: requireString("DEVICE_TOKEN", env.DEVICE_TOKEN),
    openaiApiKey: requireString("OPENAI_API_KEY", env.OPENAI_API_KEY),
    openaiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
    openaiSummaryModel: env.OPENAI_SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL,
    notionApiKey: requireString("NOTION_API_KEY", env.NOTION_API_KEY),
    notionDatabaseId: requireString("NOTION_DATABASE_ID", env.NOTION_DATABASE_ID),
    maxUploadBytes,
    tempUploadDir
  };
}
