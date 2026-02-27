import fs from "node:fs/promises";

import dotenv from "dotenv";
import express, { type Express } from "express";
import multer from "multer";

import { loadConfig, type AppConfig } from "./config";
import { requireDeviceBearerToken } from "./middleware/auth";
import { createHealthRouter } from "./routes/health";
import { createUploadRouter } from "./routes/upload";
import { createNotionService, type NotionService } from "./services/notion";
import { createOpenAIService, type OpenAIService } from "./services/openai";
import { UploadApiError, type UploadErrorResponse } from "./types/api";

dotenv.config();

export interface AppDependencies {
  openaiService: OpenAIService;
  notionService: NotionService;
}

export interface AppBootstrapOptions {
  config: Pick<AppConfig, "deviceToken" | "tempUploadDir" | "maxUploadBytes">;
  dependencies: AppDependencies;
}

export async function createApp(options: AppBootstrapOptions): Promise<Express> {
  await fs.mkdir(options.config.tempUploadDir, { recursive: true });

  const app = express();
  const upload = multer({
    dest: options.config.tempUploadDir,
    limits: { fileSize: options.config.maxUploadBytes }
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(createHealthRouter());
  app.use(requireDeviceBearerToken(options.config.deviceToken));
  app.use(
    createUploadRouter({
      upload,
      openaiService: options.dependencies.openaiService,
      notionService: options.dependencies.notionService
    })
  );

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof UploadApiError) {
      const payload: UploadErrorResponse = {
        status: "error",
        code: err.code,
        retryable: err.retryable,
        message: err.message
      };
      res.status(err.statusCode).json(payload);
      return;
    }

    const isMulterError =
      typeof err === "object" && err !== null && "name" in err && (err as { name?: string }).name === "MulterError";

    if (isMulterError) {
      res.status(400).json({
        status: "error",
        code: "VALIDATION_FAILED",
        retryable: false,
        message: "Invalid multipart upload payload"
      });
      return;
    }

    res.status(500).json({
      status: "error",
      code: "INTERNAL_ERROR",
      retryable: true,
      message: "Unhandled server error"
    });
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const openaiService = createOpenAIService({
    apiKey: config.openaiApiKey,
    transcriptionModel: config.openaiTranscriptionModel,
    summaryModel: config.openaiSummaryModel
  });
  const notionService = createNotionService({
    apiKey: config.notionApiKey,
    databaseId: config.notionDatabaseId
  });

  const app = await createApp({
    config,
    dependencies: {
      openaiService,
      notionService
    }
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server", error);
    process.exit(1);
  });
}
