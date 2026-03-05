import { describe, expect, it } from "vitest";

import { buildVoiceNoteCreateRequest } from "../src/services/notion";

describe("buildVoiceNoteCreateRequest", () => {
  it("maps required notion properties without Device ID and keeps Status as single select", () => {
    const request = buildVoiceNoteCreateRequest(
      {
        noteId: "note-123",
        recordedAtUnixMs: 1735776000000,
        durationMs: 42100,
        summary: "Short summary",
        transcript: "Line one. Line two."
      },
      "db_abc"
    );

    expect(request.parent).toEqual({ database_id: "db_abc" });

    const properties = request.properties as Record<string, any>;
    expect(properties["Device ID"]).toBeUndefined();
    expect(properties["Title"]?.title?.[0]?.text?.content).toBe("Short summary");
    expect(properties["Summary"]?.rich_text?.[0]?.text?.content).toBe("Short summary");
    expect(properties["Note ID"]?.rich_text?.[0]?.text?.content).toBe("note-123");
    expect(properties["Status"]?.select?.name).toBe("Processed");
    expect(properties["Recorded At"]?.date?.start).toMatch(/^2025-01-02T00:00:00\.000Z$/);
  });

  it("falls back to ingested time when recorded_at is implausible", () => {
    const request = buildVoiceNoteCreateRequest(
      {
        noteId: "note-epoch",
        recordedAtUnixMs: 51000,
        ingestedAtUnixMs: 1760000000000,
        durationMs: 30000,
        summary: "- Team sync planning and next steps",
        transcript: "we discussed planning and next steps in the meeting."
      },
      "db_abc"
    );

    const properties = request.properties as Record<string, any>;
    expect(properties["Title"]?.title?.[0]?.text?.content).toBe("Team sync planning and next steps");
    expect(properties["Recorded At"]?.date?.start).toBe("2025-10-09T08:53:20.000Z");
  });
});
