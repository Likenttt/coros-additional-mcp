import { describe, expect, it } from "vitest";
import { formatToolError } from "../src/mcp/errors.ts";
import { uploadStatusMessage } from "../src/mcp/server.ts";
import { uploadActivityInputSchema } from "../src/mcp/validation.ts";

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
