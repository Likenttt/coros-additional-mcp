import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { ApiRegion } from "../coros/constants.ts";
import type { Credentials } from "../coros/types/auth.ts";
import { verifyNoGrantingDarwinAcl } from "./darwin-private-acl.ts";

const MAX_SESSION_BYTES = 64 * 1024;
const SESSION_DIRECTORY_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

export interface StoredCorosSession {
    accessToken: string;
    region: ApiRegion;
    userId: string;
    savedAt: string;
}

export type CorosAuthSource = "token-env" | "token-file" | "password" | "none";

export interface ResolvedCorosAuthentication {
    source: CorosAuthSource;
    region?: ApiRegion;
    accessToken?: string;
    userId?: string;
    credentials?: Credentials;
    tokenFile?: string;
}

export interface AuthenticationResolutionOptions {
    accessToken?: string;
    tokenFile?: string;
    email?: string;
    password?: string;
    region?: ApiRegion;
}

export interface TokenFileInspection {
    path: string;
    exists: boolean;
    mode?: string;
}

export class TokenStoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TokenStoreError";
    }
}

/** Default owner-local session path. */
export function defaultTokenFilePath(env: Record<string, string | undefined> = process.env): string {
    const home = env.HOME?.trim() || homedir();
    return join(home, ".coros-additional-mcp", "session.json");
}

/** Expand a leading `~/` and return an absolute token path. */
export function resolveTokenFilePath(value: string): string {
    const expanded = value === "~"
        ? homedir()
        : value.startsWith("~/")
            ? join(homedir(), value.slice(2))
            : value;
    return isAbsolute(expanded) ? expanded : resolve(expanded);
}

/** Read and validate an owner-only session. Missing files return undefined. */
export async function readTokenFile(path: string): Promise<StoredCorosSession | undefined> {
    const absolutePath = resolveTokenFilePath(path);
    let handle: FileHandle | undefined;
    try {
        await assertPrivateDirectory(dirname(absolutePath));
        const before = await lstat(absolutePath);
        assertPrivateFile(before, absolutePath);
        if (process.platform === "darwin") await verifyNoGrantingDarwinAcl(absolutePath);

        const flags = process.platform === "win32"
            ? constants.O_RDONLY
            : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
        handle = await open(absolutePath, flags);
        const opened = await handle.stat();
        assertPrivateFile(opened, absolutePath);
        if (before.dev !== opened.dev || before.ino !== opened.ino) {
            throw new TokenStoreError("COROS session file changed while it was being read.");
        }
        if (opened.size > MAX_SESSION_BYTES) throw new TokenStoreError("COROS session file is invalid.");
        const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
        return normalizeStoredSession(parsed);
    } catch (error) {
        if (isMissingError(error)) return undefined;
        if (error instanceof TokenStoreError) throw error;
        throw new TokenStoreError("COROS session file is invalid or could not be read.");
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

/** Persist a session with a private directory and atomic owner-only replace. */
export async function writeTokenFile(path: string, value: StoredCorosSession): Promise<void> {
    const absolutePath = resolveTokenFilePath(path);
    const session = normalizeStoredSession(value);
    const parent = dirname(absolutePath);
    let temporaryPath: string | undefined;
    let handle: FileHandle | undefined;

    try {
        await ensurePrivateDirectory(parent);
        await assertSafeExistingDestination(absolutePath);
        temporaryPath = join(parent, `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`);
        const flags = process.platform === "win32"
            ? "wx"
            : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
        handle = await open(temporaryPath, flags, SESSION_FILE_MODE);
        if (process.platform !== "win32") await handle.chmod(SESSION_FILE_MODE);
        assertPrivateFile(await handle.stat(), temporaryPath);
        if (process.platform === "darwin") await verifyNoGrantingDarwinAcl(temporaryPath);
        await handle.writeFile(`${JSON.stringify(session)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;

        await assertPrivateDirectory(parent);
        await assertSafeExistingDestination(absolutePath);
        await rename(temporaryPath, absolutePath);
        temporaryPath = undefined;
    } catch (error) {
        await handle?.close().catch(() => undefined);
        if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
        if (error instanceof TokenStoreError) throw error;
        throw new TokenStoreError("COROS session file could not be written securely.");
    }
}

export async function deleteTokenFile(path: string): Promise<boolean> {
    try {
        await rm(resolveTokenFilePath(path));
        return true;
    } catch (error) {
        if (isMissingError(error)) return false;
        throw new TokenStoreError("COROS session file could not be removed.");
    }
}

/** Return only non-secret filesystem metadata for status output. */
export async function inspectTokenFile(path: string): Promise<TokenFileInspection> {
    const absolutePath = resolveTokenFilePath(path);
    try {
        const info = await lstat(absolutePath);
        return {
            path: absolutePath,
            exists: true,
            mode: process.platform === "win32" ? "platform-managed" : modeString(info.mode),
        };
    } catch (error) {
        if (isMissingError(error)) return { path: absolutePath, exists: false };
        throw new TokenStoreError("COROS session file metadata could not be read.");
    }
}

/** Resolve authentication in the documented priority order without network I/O. */
export async function resolveCorosAuthentication(
    options: AuthenticationResolutionOptions = {},
    env: Record<string, string | undefined> = process.env,
): Promise<ResolvedCorosAuthentication> {
    const configuredRegion = options.region ?? parseRegion(env.COROS_REGION);
    const directToken = nonEmpty(options.accessToken) ?? nonEmpty(env.COROS_ACCESS_TOKEN);
    if (directToken) {
        return { source: "token-env", accessToken: directToken, region: configuredRegion ?? "en" };
    }

    const explicitPathValue = nonEmpty(options.tokenFile) ?? nonEmpty(env.COROS_TOKEN_FILE);
    const defaultPath = defaultTokenFilePath(env);
    const candidates = explicitPathValue
        ? [resolveTokenFilePath(explicitPathValue)]
        : [defaultPath];
    for (const candidate of [...new Set(candidates)]) {
        const session = await readTokenFile(candidate);
        if (session) {
            return {
                source: "token-file",
                accessToken: session.accessToken,
                region: session.region,
                userId: session.userId,
                tokenFile: candidate,
            };
        }
    }

    const email = nonEmpty(options.email) ?? nonEmpty(env.COROS_EMAIL);
    const password = options.password ?? env.COROS_PASSWORD;
    if (email && password) {
        return {
            source: "password",
            credentials: { email, password },
            region: configuredRegion,
        };
    }
    return { source: "none", region: configuredRegion };
}

function normalizeStoredSession(value: unknown): StoredCorosSession {
    if (!isPlainRecord(value)) throw new TokenStoreError("COROS session file is invalid.");
    const keys = Object.keys(value);
    const expected = ["accessToken", "region", "userId", "savedAt"];
    if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
        throw new TokenStoreError("COROS session file is invalid.");
    }
    if (typeof value.accessToken !== "string" || value.accessToken.trim().length === 0) {
        throw new TokenStoreError("COROS session file is invalid.");
    }
    if (value.region !== "en" && value.region !== "eu" && value.region !== "cn") {
        throw new TokenStoreError("COROS session file is invalid.");
    }
    if (typeof value.userId !== "string" || value.userId.trim().length === 0) {
        throw new TokenStoreError("COROS session file is invalid.");
    }
    if (typeof value.savedAt !== "string" || Number.isNaN(Date.parse(value.savedAt))) {
        throw new TokenStoreError("COROS session file is invalid.");
    }
    return {
        accessToken: value.accessToken.trim(),
        region: value.region,
        userId: value.userId,
        savedAt: value.savedAt,
    };
}

async function ensurePrivateDirectory(path: string): Promise<void> {
    try {
        await mkdir(path, { recursive: true, mode: SESSION_DIRECTORY_MODE });
        const info = await lstat(path);
        if (process.platform !== "win32" && (info.mode & 0o777) !== SESSION_DIRECTORY_MODE) {
            // Only repair this product's own default directory. Never chmod an
            // arbitrary existing parent selected through COROS_TOKEN_FILE.
            if (basename(path) !== ".coros-additional-mcp") {
                throw insecureDirectoryError(path);
            }
            await chmod(path, SESSION_DIRECTORY_MODE);
        }
        await assertPrivateDirectory(path);
    } catch (error) {
        if (error instanceof TokenStoreError) throw error;
        throw new TokenStoreError("COROS session directory could not be prepared securely.");
    }
}

async function assertPrivateDirectory(path: string): Promise<void> {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new TokenStoreError("COROS session directory must be a real directory, not a symlink.");
    }
    assertCurrentOwner(info, "directory");
    if (process.platform !== "win32" && (info.mode & 0o777) !== SESSION_DIRECTORY_MODE) {
        throw insecureDirectoryError(path);
    }
    if (process.platform === "darwin") await verifyNoGrantingDarwinAcl(path);
}

async function assertSafeExistingDestination(path: string): Promise<void> {
    try {
        const info = await lstat(path);
        assertPrivateFile(info, path);
        if (process.platform === "darwin") await verifyNoGrantingDarwinAcl(path);
    } catch (error) {
        if (isMissingError(error)) return;
        throw error;
    }
}

function assertPrivateFile(info: Stats, path: string): void {
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new TokenStoreError("COROS session path must be a regular file, not a symlink.");
    }
    assertCurrentOwner(info, "file");
    if (process.platform !== "win32" && (info.mode & 0o777) !== SESSION_FILE_MODE) {
        throw new TokenStoreError(
            `COROS session file permissions are ${modeString(info.mode)}; fix them with: chmod 600 ${shellQuote(path)}`,
        );
    }
}

function assertCurrentOwner(info: Stats, kind: "file" | "directory"): void {
    if (typeof process.geteuid === "function" && info.uid !== process.geteuid()) {
        throw new TokenStoreError(`COROS session ${kind} is not owned by the current user.`);
    }
}

function insecureDirectoryError(path: string): TokenStoreError {
    return new TokenStoreError(
        `COROS session directory permissions must be 0700; fix them with: chmod 700 ${shellQuote(path)}`,
    );
}

function modeString(mode: number): string {
    return (mode & 0o777).toString(8).padStart(4, "0");
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseRegion(value: string | undefined): ApiRegion | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    if (value === "en" || value === "eu" || value === "cn") return value;
    throw new TokenStoreError("COROS_REGION must be one of en, eu, or cn.");
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isMissingError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
