import fs from "node:fs/promises";

export async function safeDeleteFile(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";

    if (!isMissing) {
      throw error;
    }
  }
}
