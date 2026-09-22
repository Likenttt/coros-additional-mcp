import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatToolError } from "../src/mcp/errors.ts";
import { uploadStatusMessage } from "../src/mcp/server.ts";
import { downloadActivityInputSchema, uploadActivityInputSchema, writeDownloadedActivity } from "../src/mcp/validation.ts";

describe("MCP upload input validation", () => {
    it("requires exactly one upload source", () => {
        expect(uploadActivityInputSchema.safeParse({
            filePath: "/tmp/activity.fit",
            contentBase64: "Zml0",
            originalFilename: "activity.fit",
        }).success).toBe(false);
        expect(uploadActivityInputSchema.safeParse({}).success).toBe(false);
    });

    it("rejects unsupported activity extensions", () => {
        expect(uploadActivityInputSchema.safeParse({ filePath: "/tmp/activity.gpx" }).success).toBe(false);
        expect(uploadActivityInputSchema.safeParse({
            contentBase64: "Zml0",
            originalFilename: "activity.gpx",
        }).success).toBe(false);
    });
});

describe("MCP download", () => {
    it("rejects a relative output path", () => {
        expect(downloadActivityInputSchema.safeParse({
            labelId: "1",
            outputPath: "activity.fit",
        }).success).toBe(false);
    });

    it("writes an owner-only file and sanitizes the label id", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-download-"));
        const written = await writeDownloadedActivity(
            new Uint8Array([1, 2, 3]),
            { labelId: "../4805 fit", fileType: "fit" },
            { HOME: home },
        );
        expect(written.filePath).toBe(join(home, ".coros-additional-mcp", "downloads", ".._4805_fit.fit"));
        expect(written.bytes).toBe(3);
        expect((await stat(written.filePath)).mode & 0o777).toBe(0o600);
    });
});

describe("MCP tool responses", () => {
    it("formats errors without exposing bearer tokens", () => {
        expect(formatToolError(new Error("Request failed: Bearer very-secret-token")))
            .toBe("Request failed: Bearer [redacted]");
    });

    it("instructs callers to query import jobs for incomplete imports", () => {
        expect(uploadStatusMessage(1)).toBe("Import may still be processing; use list_import_jobs to check its status.");
        expect(uploadStatusMessage(2)).toBe("Activity import completed.");
    });
});
