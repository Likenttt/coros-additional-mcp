import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { emptyMigrationState, type MigrationState } from "./migration.ts";

const FILE_MODE = 0o600;

export function migrationFilePath(env: Record<string, string | undefined> = process.env): string {
    const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
    return join(home, ".coros-additional-mcp", "migration.json");
}

export async function loadMigrationState(path: string): Promise<MigrationState> {
    try {
        return normalize(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
        if (isMissing(error)) return emptyMigrationState();
        throw new Error("Migration progress file is unreadable.");
    }
}

export async function saveMigrationState(path: string, state: MigrationState): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, FILE_MODE);
    try {
        if (process.platform !== "win32") await handle.chmod(FILE_MODE);
        await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporary, path);
}

export async function locateGarminFit(
    root: string,
    activityId: string,
    expectedSha256?: string,
): Promise<{ filePath: string; sha256: string }> {
    const fileName = `${activityId}.fit`;
    const found = await findFile(resolve(root), fileName, 3);
    if (!found) throw new Error(`No ${fileName} under GARMIN_FIT_DOWNLOAD_DIR.`);
    await assertRegularFile(found);
    const sha256 = createHash("sha256").update(await readFile(found)).digest("hex");
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error("Located FIT file does not match the expected sha256.");
    return { filePath: found, sha256 };
}

async function findFile(root: string, fileName: string, depth: number): Promise<string | undefined> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(root, entry.name);
        if (entry.isFile() && entry.name === fileName) return path;
        if (entry.isDirectory() && depth > 0) {
            const nested = await findFile(path, fileName, depth - 1);
            if (nested) return nested;
        }
    }
    return undefined;
}

function normalize(value: unknown): MigrationState {
    const state = emptyMigrationState();
    if (!value || typeof value !== "object") return state;
    const record = value as Partial<MigrationState>;
    state.nextActionAt = record.nextActionAt;
    for (const lane of ["garmin_to_coros", "coros_to_garmin"] as const) {
        const items = record.lanes?.[lane]?.items;
        if (items && typeof items === "object") state.lanes[lane].items = items;
        state.lanes[lane].lastWriteAt = record.lanes?.[lane]?.lastWriteAt;
    }
    return state;
}

function isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function assertRegularFile(path: string): Promise<void> {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error("Located FIT path is not a regular file.");
}
