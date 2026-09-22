import { chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCorosAuthCli } from "../src/auth/cli.ts";
import {
    defaultTokenFilePath,
    readTokenFile,
    resolveCorosAuthentication,
    writeTokenFile,
} from "../src/auth/token-store.ts";
import { CorosClient } from "../src/coros/client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

function session(accessToken: string, region: "en" | "eu" | "cn" = "en") {
    return {
        accessToken,
        region,
        userId: "user-123",
        savedAt: "2026-01-01T00:00:00.000Z",
    };
}

function capture() {
    let value = "";
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            value += chunk.toString();
            callback();
        },
    });
    return { stream, text: () => value };
}

describe("owner-only COROS token store", () => {
    it("writes a 0700 directory and 0600 file", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-token-store-"));
        const path = defaultTokenFilePath({ HOME: home });
        await writeTokenFile(path, session("stored-secret"));

        expect((await stat(join(home, ".coros-additional-mcp"))).mode & 0o777).toBe(0o700);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readTokenFile(path)).toEqual(session("stored-secret"));
    });

    it.runIf(process.platform !== "win32")("rejects a session file whose permissions are too broad", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-token-mode-"));
        const path = defaultTokenFilePath({ HOME: home });
        await writeTokenFile(path, session("stored-secret"));
        await chmod(path, 0o644);

        await expect(readTokenFile(path)).rejects.toThrow(/chmod 600/);
    });
});

describe("authentication source priority", () => {
    it("prefers direct token, explicit file, default file, then password", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-auth-priority-"));
        const explicitDir = join(home, "explicit");
        const explicitPath = join(explicitDir, "session.json");
        const defaultPath = defaultTokenFilePath({ HOME: home });
        await writeTokenFile(explicitPath, session("explicit-secret", "eu"));
        await writeTokenFile(defaultPath, session("default-secret", "cn"));

        const allConfigured = {
            HOME: home,
            COROS_ACCESS_TOKEN: "environment-secret",
            COROS_TOKEN_FILE: explicitPath,
            COROS_EMAIL: "person@example.com",
            COROS_PASSWORD: "password",
            COROS_REGION: "en",
        };
        expect((await resolveCorosAuthentication({}, allConfigured)).source).toBe("token-env");

        const { COROS_ACCESS_TOKEN: _direct, ...withoutDirect } = allConfigured;
        const explicit = await resolveCorosAuthentication({}, withoutDirect);
        expect(explicit).toMatchObject({ source: "token-file", region: "eu", tokenFile: explicitPath });

        const { COROS_TOKEN_FILE: _file, ...withoutExplicit } = withoutDirect;
        const storedDefault = await resolveCorosAuthentication({}, withoutExplicit);
        expect(storedDefault).toMatchObject({ source: "token-file", region: "cn", tokenFile: defaultPath });

        const emptyHome = await mkdtemp(join(tmpdir(), "coros-auth-password-"));
        const password = await resolveCorosAuthentication({}, {
            HOME: emptyHome,
            COROS_EMAIL: "person@example.com",
            COROS_PASSWORD: "password",
        });
        expect(password.source).toBe("password");
    }, 15_000);
});

describe("token-only session validation", () => {
    it("maps account regionId and returns userId without credentials", async () => {
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
            result: "0000",
            message: "OK",
            data: { userId: "user-42", regionId: 3 },
        }), { headers: { "content-type": "application/json" } })) as typeof fetch;

        const client = new CorosClient(undefined, { accessToken: "browser-secret", region: "en" });
        await expect(client.resolveSession()).resolves.toEqual({ userId: "user-42", regionId: 3, region: "eu" });
        expect(client.getRegion()).toBe("eu");
    });

    it("never includes the token in validation errors or CLI output", async () => {
        const token = "uniquely-secret-session-token";
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
            result: "1001",
            message: `rejected ${token}`,
        }), { headers: { "content-type": "application/json" } })) as typeof fetch;
        const client = new CorosClient(undefined, { accessToken: token, region: "en" });
        const validationMessage = await client.resolveSession().then(
            () => "",
            (error: unknown) => error instanceof Error ? error.message : String(error),
        );
        expect(validationMessage).not.toContain(token);
        expect(validationMessage).toContain("coros-auth import-token");

        const output = capture();
        const errors = capture();
        const home = await mkdtemp(join(tmpdir(), "coros-auth-redaction-"));
        const exitCode = await runCorosAuthCli({
            argv: ["import-token"],
            env: { HOME: home },
            output: output.stream,
            errorOutput: errors.stream,
            readToken: async () => token,
            validateToken: async () => { throw new Error(`upstream echoed ${token}`); },
        });
        expect(exitCode).toBe(1);
        expect(output.text() + errors.text()).not.toContain(token);

        const successOutput = capture();
        const successErrors = capture();
        const successCode = await runCorosAuthCli({
            argv: ["import-token", "--region", "en"],
            env: { HOME: home },
            output: successOutput.stream,
            errorOutput: successErrors.stream,
            readToken: async () => token,
            validateToken: async () => ({
                userId: `user-${token}`,
                regionId: 1,
                region: "en",
            }),
        });
        expect(successCode).toBe(0);
        expect(successOutput.text() + successErrors.text()).not.toContain(token);
    }, 10_000);
});

describe("coros-auth status", () => {
    it("reports an absent session without throwing", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-auth-status-"));
        const output = capture();
        const errors = capture();
        await expect(runCorosAuthCli({
            argv: ["status"],
            env: { HOME: home },
            output: output.stream,
            errorOutput: errors.stream,
        })).resolves.toBe(0);
        expect(output.text()).toContain("authSource=none");
        expect(output.text()).toContain("valid=no");
        expect(errors.text()).toBe("");
    });
});
