import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";

export const MAX_ACTIVITY_FILE_BYTES = 50 * 1024 * 1024;

const filenameSchema = z.string().min(1).max(255).refine(hasSupportedExtension, {
    message: "originalFilename must have a .fit or .tcx extension",
});

const filePathSchema = z.string().min(1).refine(hasSupportedExtension, {
    message: "filePath must have a .fit or .tcx extension",
});

export const uploadActivityInputSchema = z.object({
    filePath: filePathSchema.optional().describe("Absolute path to a local .fit or .tcx file."),
    contentBase64: z.string().min(1).optional().describe("Base64-encoded FIT or TCX file contents."),
    originalFilename: filenameSchema.optional().describe("Original .fit or .tcx filename; required with contentBase64."),
    timezone: z.int().min(-56).max(56).optional().describe("Timezone offset in 15-minute units, from -56 to 56."),
}).superRefine((value, ctx) => {
    const hasPath = value.filePath !== undefined;
    const hasContent = value.contentBase64 !== undefined;
    if (hasPath === hasContent) {
        ctx.addIssue({ code: "custom", message: "Provide exactly one of filePath or contentBase64." });
    }
    if (hasContent && value.originalFilename === undefined) {
        ctx.addIssue({ code: "custom", path: ["originalFilename"], message: "originalFilename is required with contentBase64." });
    }
    if (hasPath && value.originalFilename !== undefined) {
        ctx.addIssue({ code: "custom", path: ["originalFilename"], message: "originalFilename is only valid with contentBase64." });
    }
    if (hasContent && !isBase64(value.contentBase64!)) {
        ctx.addIssue({ code: "custom", path: ["contentBase64"], message: "contentBase64 must be valid base64." });
    }
});

export const listImportJobsInputSchema = z.object({
    size: z.int().min(1).max(200).optional().default(10).describe("Number of import jobs to return, from 1 to 200."),
});

export const deleteImportJobInputSchema = z.object({
    importId: z.string().min(1).describe("Import job ID returned by upload_activity or list_import_jobs."),
});

export const listActivitiesInputSchema = z.object({
    page: z.int().min(1).optional().default(1).describe("One-based page number."),
    size: z.int().min(1).max(200).optional().default(20).describe("Activities per page, from 1 to 200."),
    from: z.iso.date().optional().describe("Inclusive start date in YYYY-MM-DD format."),
    to: z.iso.date().optional().describe("Inclusive end date in YYYY-MM-DD format."),
    modeList: z.string().min(1).optional().describe("Optional raw comma-separated COROS API sport values."),
});

export const checkCorosAuthInputSchema = z.object({});

export type UploadActivityInput = z.infer<typeof uploadActivityInputSchema>;

export async function readValidatedActivityFile(input: UploadActivityInput): Promise<{ bytes: Uint8Array; filename: string }> {
    if (input.filePath !== undefined) {
        if (!isAbsolutePath(input.filePath)) throw new Error("filePath must be an absolute path.");
        if (!hasSupportedExtension(input.filePath)) throw new Error("filePath must have a .fit or .tcx extension.");

        let fileStat;
        try {
            fileStat = await stat(input.filePath);
        } catch {
            throw new Error("filePath does not exist or cannot be read.");
        }
        if (!fileStat.isFile()) throw new Error("filePath must point to a regular file.");
        if (fileStat.size > MAX_ACTIVITY_FILE_BYTES) throw new Error("Activity file exceeds the 50 MB limit.");

        const { readFile } = await import("node:fs/promises");
        return { bytes: new Uint8Array(await readFile(input.filePath)), filename: input.filePath.split(/[\\/]/).pop()! };
    }

    // The schema ensures these fields are present and valid for this branch.
    const bytes = Buffer.from(input.contentBase64!, "base64");
    if (bytes.byteLength > MAX_ACTIVITY_FILE_BYTES) throw new Error("Activity file exceeds the 50 MB limit.");
    return { bytes: new Uint8Array(bytes), filename: input.originalFilename! };
}

export function hasSupportedExtension(filename: string): boolean {
    const extension = extname(filename).toLowerCase();
    return extension === ".fit" || extension === ".tcx";
}

function isAbsolutePath(filePath: string): boolean {
    return filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath);
}

function isBase64(value: string): boolean {
    if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
    return Buffer.from(value, "base64").toString("base64") === value;
}
