#!/usr/bin/env node

import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { AuthError, HttpError } from "../coros/errors.ts";
import { CorosClient, type ResolvedSession } from "../coros/client.ts";
import type { ApiRegion } from "../coros/constants.ts";
import {
    defaultTokenFilePath,
    deleteTokenFile,
    inspectTokenFile,
    resolveCorosAuthentication,
    resolveTokenFilePath,
    TokenStoreError,
    writeTokenFile,
} from "./token-store.ts";

const HELP = `COROS browser-session bridge

Usage:
  coros-auth import-token [--region en|eu|cn]
  coros-auth status
  coros-auth logout
  coros-auth --help

import-token reads CPL-coros-token from stdin only. Never pass a token as a
command-line argument. The token is verified with COROS before an owner-only
session file is written. Region defaults to en; use --region cn for mainland
China or --region eu for Europe.

How to obtain the token:
  1. Sign in on the official Training Hub: https://training.coros.com, or
     https://trainingcn.coros.com for mainland China.
  2. Open browser DevTools, then Application (Chrome/Edge) or Storage (Firefox).
  3. Open Local Storage / Cookies for the Training Hub origin.
  4. Copy the value named CPL-coros-token. CPL-coros-region is 1=en, 2=cn,
     3=eu and can be translated to the matching --region value.
  5. Run coros-auth import-token --region <en|eu|cn>, paste the token at the
     hidden stdin prompt, and press Enter.

Environment:
  COROS_ACCESS_TOKEN  Highest-priority in-memory token (not persisted)
  COROS_TOKEN_FILE    Override the session file path
  COROS_REGION        Region for COROS_ACCESS_TOKEN or password login
`;

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
            const region = parseImportArgs(args);
            const token = (await (options.readToken
                ? options.readToken()
                : readTokenFromStdin(options.input ?? process.stdin, errorOutput))).trim();
            if (!token) throw new CliUsageError("No token was provided on stdin.");
            sensitiveValues.push(token);
            if (Buffer.byteLength(token, "utf8") > 16 * 1024) {
                throw new CliUsageError("The token read from stdin is too large.");
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

function parseImportArgs(args: string[]): ApiRegion {
    let region: ApiRegion = "en";
    if (args.length === 0) return region;
    if (args.length !== 2 || args[0] !== "--region") {
        throw new CliUsageError("Usage: coros-auth import-token [--region en|eu|cn]");
    }
    const value = args[1];
    if (value !== "en" && value !== "eu" && value !== "cn") {
        throw new CliUsageError("Region must be en, eu, or cn.");
    }
    region = value;
    return region;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main();
}
