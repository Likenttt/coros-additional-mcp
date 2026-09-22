import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
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

export const downloadActivityInputSchema = z.object({
    labelId: z.string().min(1).describe("Activity labelId from list_activities."),
    sportType: z.union([z.int(), z.string().min(1)]).optional().describe("Sport type from the activity list item. Defaults to running."),
    fileType: z.enum(["fit", "tcx", "gpx", "kml", "csv"]).optional().default("fit").describe("Export format. Defaults to fit."),
    outputPath: z.string().min(1).optional().describe("Absolute path to write. Defaults to ~/.coros-additional-mcp/downloads/{labelId}.{fileType}."),
}).superRefine((value, ctx) => {
    if (value.outputPath !== undefined && !isAbsolutePath(value.outputPath)) {
        ctx.addIssue({ code: "custom", path: ["outputPath"], message: "outputPath must be an absolute path." });
    }
});

export const migrationLaneSchema = z.enum(["garmin_to_coros", "coros_to_garmin"]);

export const migrationEnqueueInputSchema = z.object({
    lane: migrationLaneSchema.describe("garmin_to_coros or coros_to_garmin. The two lanes keep separate progress."),
    items: z.array(z.object({
        id: z.string().min(1).max(80).describe("Garmin activityId or COROS labelId."),
        sourceDate: z.iso.date().optional(),
        title: z.string().max(120).optional(),
    })).min(1).max(20).describe("At most 20 ids. Do not enqueue an entire history in one call."),
});

export const migrationNextInputSchema = z.object({
    lane: migrationLaneSchema.optional().describe("Omit to let the ledger choose the lane that has been idle longer."),
});

export const migrationRecordInputSchema = z.object({
    lane: migrationLaneSchema,
    id: z.string().min(1).max(80),
    outcome: z.enum(["downloaded", "succeeded", "failed", "skipped"]),
    remoteId: z.string().max(80).optional().describe("COROS importId or Garmin activity id after a successful write."),
    fileName: z.string().max(120).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    localPath: z.string().min(1).optional().describe("Absolute path returned by download_activity or migration_locate_garmin_fit."),
    error: z.string().max(300).optional(),
});

export const migrationLocateInputSchema = z.object({
    activityId: z.string().regex(/^\d+$/).describe("Garmin activity id. The file is expected as {activityId}.fit."),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const checkCorosAuthInputSchema = z.object({});

export type UploadActivityInput = z.infer<typeof uploadActivityInputSchema>;
export type DownloadActivityInput = z.infer<typeof downloadActivityInputSchema>;

export async function writeDownloadedActivity(
    bytes: Uint8Array,
    input: Pick<DownloadActivityInput, "labelId" | "fileType" | "outputPath">,
    env: Record<string, string | undefined> = process.env,
): Promise<{ filePath: string; bytes: number; fileType: DownloadActivityInput["fileType"] }> {
    const fileType = input.fileType ?? "fit";
    const filePath = input.outputPath ?? join(downloadDirectory(env), `${safeFileStem(input.labelId)}.${fileType}`);
    if (!isAbsolutePath(filePath)) throw new Error("outputPath must be an absolute path.");
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, bytes, { mode: 0o600 });
    return { filePath, bytes: bytes.byteLength, fileType };
}

function downloadDirectory(env: Record<string, string | undefined>): string {
    const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
    return join(home, ".coros-additional-mcp", "downloads");
}

function safeFileStem(labelId: string): string {
    const stem = labelId.replace(/[^A-Za-z0-9._-]/g, "_");
    return stem.length > 0 ? stem : "activity";
}

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
