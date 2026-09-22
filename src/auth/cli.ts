#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { AuthError, HttpError } from "../coros/errors.ts";
import { CorosClient, type ResolvedSession } from "../coros/client.ts";
import { TRAINING_HUB_URL_BY_REGION, type ApiRegion } from "../coros/constants.ts";
import {
    defaultTokenFilePath,
    deleteTokenFile,
    inspectTokenFile,
    resolveCorosAuthentication,
    resolveTokenFilePath,
    TokenStoreError,
    writeTokenFile,
} from "./token-store.ts";

const MANUAL_IMPORT_GUIDE = `Manual token import:
  1. Sign in on the official Training Hub: https://training.coros.com,
     https://trainingcn.coros.com (mainland China), or
     https://trainingeu.coros.com (Europe).
  2. Open browser DevTools, then Application (Chrome/Edge) or Storage (Firefox).
  3. Open Cookies for the Training Hub origin.
  4. Copy only the CPL-coros-token value. CPL-coros-region maps as 1=en,
     2=cn, and 3=eu.
  5. Run coros-auth import-token --region <en|eu|cn>, paste the token at the
     hidden stdin prompt, and press Enter.`;

const HELP = `COROS browser-session bridge

Usage:
  coros-auth import-token [--region en|eu|cn] [--from-browser]
  coros-auth status
  coros-auth logout
  coros-auth --help

By default, import-token reads CPL-coros-token from stdin. The optional
--from-browser mode asks an installed ego-browser to read cookies from an
already signed-in Training Hub page. Never pass a token as a command-line
argument. The token is verified with COROS before an owner-only session file is
written. Region defaults to en; use --region cn for mainland China or --region
eu for Europe. A valid CPL-coros-region browser cookie takes precedence over
--region.

${MANUAL_IMPORT_GUIDE}

Environment:
  COROS_ACCESS_TOKEN  Highest-priority in-memory token (not persisted)
  COROS_TOKEN_FILE    Override the session file path
  COROS_REGION        Region for COROS_ACCESS_TOKEN or password login
`;

const BROWSER_RESULT_PREFIX = "COROS_AUTH_BROWSER_RESULT=";
const BROWSER_TIMEOUT_MS = 90_000;
const MAX_BROWSER_OUTPUT_BYTES = 2 * 1024 * 1024;

interface ImportArguments {
    region: ApiRegion;
    regionWasSpecified: boolean;
    fromBrowser: boolean;
}

interface BrowserCookieResult {
    token: string;
    region?: ApiRegion;
    url: string;
}

export interface CorosAuthCliOptions {
    argv: string[];
    env?: Record<string, string | undefined>;
    input?: Readable;
    output?: Writable;
    errorOutput?: Writable;
    readToken?: () => Promise<string>;
    validateToken?: (token: string, region: ApiRegion) => Promise<ResolvedSession>;
}

/** Run one CLI command. Exported to keep secret-redaction behavior testable. */
export async function runCorosAuthCli(options: CorosAuthCliOptions): Promise<number> {
    const env = options.env ?? process.env;
    const output = options.output ?? process.stdout;
    const errorOutput = options.errorOutput ?? process.stderr;
    const [command, ...args] = options.argv;
    const sensitiveValues: string[] = [];

    if (!command || command === "--help" || command === "-h") {
        output.write(HELP);
        return 0;
    }

    try {
        if (command === "import-token") {
            const importArguments = parseImportArgs(args);
            let region = importArguments.region;
            let token: string;

            if (importArguments.fromBrowser) {
                const browserResult = await readTokenFromBrowser(region, env);
                token = browserResult.token.trim();
                sensitiveValues.push(token);
                if (browserResult.region) {
                    if (importArguments.regionWasSpecified && browserResult.region !== region) {
                        errorOutput.write(
                            `warning=CPL-coros-region indicates ${browserResult.region}; overriding --region ${region}.\n`,
                        );
                    }
                    region = browserResult.region;
                }
            } else {
                token = (await (options.readToken
                    ? options.readToken()
                    : readTokenFromStdin(options.input ?? process.stdin, errorOutput))).trim();
                if (!token) throw new CliUsageError("No token was provided on stdin.");
                sensitiveValues.push(token);
            }

            if (Buffer.byteLength(token, "utf8") > 16 * 1024) {
                throw new CliUsageError("The imported token is too large.");
            }
            const validate = options.validateToken ?? validateSessionToken;
            const session = await validate(token, region);
            const path = selectedTokenFile(env);
            await writeTokenFile(path, {
                accessToken: token,
                region: session.region,
                userId: session.userId,
                savedAt: new Date().toISOString(),
            });
            output.write("authentication_status=valid\n");
            output.write(`region=${session.region}\n`);
            output.write(`userId=${terminalValue(session.userId, [token])}\n`);
            output.write(`session_file=${terminalValue(path)}\n`);
            output.write("permissions=0600\n");
            return 0;
        }

        if (command === "status") {
            rejectArguments(args, "status");
            await printStatus(env, output);
            return 0;
        }

        if (command === "logout") {
            rejectArguments(args, "logout");
            const path = selectedTokenFile(env);
            const removed = await deleteTokenFile(path);
            output.write(`session_removed=${removed ? "yes" : "no"}\n`);
            output.write(`session_file=${terminalValue(path)}\n`);
            if (env.COROS_ACCESS_TOKEN?.trim()) {
                output.write("note=COROS_ACCESS_TOKEN remains set in the environment\n");
            }
            return 0;
        }

        throw new CliUsageError("Unknown command. Use `coros-auth --help`.");
    } catch (error) {
        errorOutput.write(`${safeCliError(error, sensitiveValues)}\n`);
        return 1;
    }
}

async function printStatus(
    env: Record<string, string | undefined>,
    output: Writable,
): Promise<void> {
    const path = selectedTokenFile(env);
    const inspection = await inspectTokenFile(path);
    output.write(`session_file=${terminalValue(inspection.path)}\n`);
    output.write(`permissions=${inspection.mode ?? "missing"}\n`);

    let authentication;
    try {
        authentication = await resolveCorosAuthentication({}, env);
    } catch (error) {
        output.write("authSource=token-file\n");
        output.write("valid=no\n");
        output.write(`status=${terminalValue(safeCliError(error))}\n`);
        return;
    }
    output.write(`authSource=${authentication.source}\n`);
    if (authentication.region) output.write(`region=${authentication.region}\n`);
    if (authentication.userId) {
        output.write(`userId=${terminalValue(authentication.userId, [authentication.accessToken ?? ""])}\n`);
    }

    if (authentication.source !== "token-env" && authentication.source !== "token-file") {
        output.write("valid=no\n");
        return;
    }

    try {
        const session = await validateSessionToken(authentication.accessToken!, authentication.region!);
        output.write("valid=yes\n");
        output.write(`region=${session.region}\n`);
        output.write(`userId=${terminalValue(session.userId, [authentication.accessToken!])}\n`);
    } catch (error) {
        output.write(error instanceof HttpError && error.status === 0 ? "valid=unknown\n" : "valid=no\n");
        output.write(`status=${terminalValue(safeCliError(error, [authentication.accessToken!]))}\n`);
    }
}

async function validateSessionToken(token: string, region: ApiRegion): Promise<ResolvedSession> {
    const client = new CorosClient(undefined, { accessToken: token, region });
    return await client.resolveSession();
}

function parseImportArgs(args: string[]): ImportArguments {
    let region: ApiRegion = "en";
    let regionWasSpecified = false;
    let fromBrowser = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--from-browser" && !fromBrowser) {
            fromBrowser = true;
            continue;
        }
        if (argument === "--region" && !regionWasSpecified) {
            const value = args[index + 1];
            if (value !== "en" && value !== "eu" && value !== "cn") {
                throw new CliUsageError("Region must be en, eu, or cn.");
            }
            region = value;
            regionWasSpecified = true;
            index += 1;
            continue;
        }
        throw new CliUsageError(
            "Usage: coros-auth import-token [--region en|eu|cn] [--from-browser]",
        );
    }

    return { region, regionWasSpecified, fromBrowser };
}

async function readTokenFromBrowser(
    requestedRegion: ApiRegion,
    env: Record<string, string | undefined>,
): Promise<BrowserCookieResult> {
    const url = TRAINING_HUB_URL_BY_REGION[requestedRegion];
    const script = `const task = await taskSpace("COROS session import");
const page = task.page("p1");
await page.goto(${JSON.stringify(url)});
await page.waitForTimeout(5000);
const result = await page.evaluate(() => {
  const cookies = Object.create(null);
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return {
    token: cookies["CPL-coros-token"] ?? null,
    regionId: cookies["CPL-coros-region"] ?? null,
  };
});
console.log(${JSON.stringify(BROWSER_RESULT_PREFIX)} + JSON.stringify(result));`;

    const stdout = await runEgoBrowser(script, env);
    const markerLine = stdout
        .split(/\r?\n/u)
        .reverse()
        .find((line) => line.startsWith(BROWSER_RESULT_PREFIX));
    if (!markerLine) {
        throw new CliUsageError(
            "ego-browser did not return a readable cookie result. No token was saved.",
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(markerLine.slice(BROWSER_RESULT_PREFIX.length));
    } catch {
        throw new CliUsageError(
            "ego-browser returned an unreadable cookie result. No token was saved.",
        );
    }
    if (!isRecord(parsed) || typeof parsed.token !== "string" || parsed.token.trim() === "") {
        throw new CliUsageError(
            `No COROS session cookie was found. 请先在浏览器里登录 Training Hub 再重试。 Opened: ${url}`,
        );
    }

    return {
        token: parsed.token,
        region: browserRegion(parsed.regionId),
        url,
    };
}

async function runEgoBrowser(
    script: string,
    env: Record<string, string | undefined>,
): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const child = spawn("ego-browser", ["nodejs", "-e", script], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        // ego-browser relays script `console.log` output on stderr, not stdout,
        // so both streams are captured. Neither is ever echoed: the captured text
        // contains the session token.
        let stdout = "";
        let settled = false;
        let timedOut = false;
        let outputTooLarge = false;
        const finish = (operation: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            operation();
        };
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, BROWSER_TIMEOUT_MS);

        const collect = (chunk: Buffer | string): void => {
            if (outputTooLarge) return;
            stdout += chunk.toString();
            if (Buffer.byteLength(stdout, "utf8") > MAX_BROWSER_OUTPUT_BYTES) {
                outputTooLarge = true;
                stdout = "";
                child.kill("SIGKILL");
            }
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", (error: NodeJS.ErrnoException) => finish(() => {
            if (error.code === "ENOENT") {
                reject(new CliUsageError(
                    `ego-browser was not detected in PATH. 未检测到 ego-browser，请改用默认的手动粘贴方式。\n\n${MANUAL_IMPORT_GUIDE}`,
                ));
                return;
            }
            reject(new CliUsageError("ego-browser could not be started. No token was saved."));
        }));
        child.on("close", (code) => finish(() => {
            if (timedOut) {
                reject(new CliUsageError(
                    "ego-browser timed out after 90 seconds and was stopped. No token was saved.",
                ));
            } else if (outputTooLarge) {
                reject(new CliUsageError("ego-browser produced too much output. No token was saved."));
            } else if (code !== 0) {
                reject(new CliUsageError(
                    "ego-browser could not read the Training Hub session. No token was saved.",
                ));
            } else {
                resolve(stdout);
            }
        }));
    });
}

function browserRegion(value: unknown): ApiRegion | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === 1 || value === "1") return "en";
    if (value === 2 || value === "2") return "cn";
    if (value === 3 || value === "3") return "eu";
    throw new CliUsageError("The CPL-coros-region browser cookie is not recognized.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectArguments(args: string[], command: string): void {
    if (args.length > 0) throw new CliUsageError(`coros-auth ${command} does not accept arguments.`);
}

function selectedTokenFile(env: Record<string, string | undefined>): string {
    const configured = env.COROS_TOKEN_FILE?.trim();
    return configured ? resolveTokenFilePath(configured) : defaultTokenFilePath(env);
}

async function readTokenFromStdin(input: Readable, errorOutput: Writable): Promise<string> {
    const terminal = input as NodeJS.ReadStream;
    if (!terminal.isTTY || typeof terminal.setRawMode !== "function") {
        const chunks: Buffer[] = [];
        for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return Buffer.concat(chunks).toString("utf8").trim();
    }

    errorOutput.write("Paste CPL-coros-token (input hidden), then press Enter: ");
    terminal.setRawMode(true);
    terminal.resume();
    return await new Promise<string>((resolve, reject) => {
        let value = "";
        const cleanup = () => {
            terminal.off("data", onData);
            terminal.setRawMode?.(false);
            terminal.pause();
            errorOutput.write("\n");
        };
        const onData = (chunk: Buffer | string) => {
            const text = chunk.toString();
            for (const character of text) {
                if (character === "\u0003") {
                    cleanup();
                    reject(new CliUsageError("Token import cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    cleanup();
                    resolve(value);
                    return;
                }
                if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
                else value += character;
            }
        };
        terminal.on("data", onData);
    });
}

function safeCliError(error: unknown, secrets: readonly string[] = []): string {
    let message: string;
    if (error instanceof CliUsageError || error instanceof TokenStoreError || error instanceof AuthError) {
        message = error.message;
    } else if (error instanceof HttpError) {
        message = error.status === 0
            ? "Unable to reach COROS. Check your network connection and try again."
            : `COROS request failed (HTTP ${error.status}).`;
    } else {
        message = "COROS authentication failed without saving the token.";
    }
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
        message = message.split(secret).join("[redacted]");
    }
    return message;
}

function terminalValue(value: string, secrets: readonly string[] = []): string {
    const redacted = secrets.filter(Boolean).reduce(
        (result, secret) => result.split(secret).join("[redacted]"),
        value,
    );
    return JSON.stringify(redacted).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
        `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
    );
}

class CliUsageError extends Error {}

async function main(): Promise<void> {
    process.exitCode = await runCorosAuthCli({ argv: process.argv.slice(2) });
}

// npm's bin shim is a symlink on macOS/Linux, so argv[1] is the symlink path
// while import.meta.url is the real file. A plain string compare never matches,
// main() never runs, and the command exits 0 with no output. Compare real paths.
function invokedDirectly(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    if (import.meta.url === pathToFileURL(entry).href) return true;
    try {
        return import.meta.url === pathToFileURL(realpathSync(entry)).href;
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    void main();
}
