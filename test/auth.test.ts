import { execFile } from "node:child_process";
import { access, symlink, unlink } from "node:fs/promises";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

describe("cli entry guard", () => {
    it("runs when invoked through a symlink, as npm's bin shim does", async () => {
        // npm's bin shim is a symlink on macOS/Linux. Comparing import.meta.url to
        // argv[1] directly never matches, so main() never ran and the command exited
        // 0 with no output. The guard must resolve the real path.
        const cli = join(process.cwd(), "dist/auth/cli.js");
        try {
            await access(cli);
        } catch {
            await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
        }
        const dir = await mkdtemp(join(tmpdir(), "coros-auth-symlink-"));
        const link = join(dir, "coros-auth");
        await symlink(cli, link);
        try {
            const { stdout } = await execFileAsync(process.execPath, [link, "status"], {
                env: { ...process.env, HOME: dir },
            });
            expect(stdout).toContain("authSource=none");
            expect(stdout).toContain("valid=no");
        } finally {
            await unlink(link);
        }
    });
});

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

async function fakeEgoBrowserEnvironment(home: string, stdout: string, stream: "stdout" | "stderr" = "stdout") {
    const bin = await mkdtemp(join(tmpdir(), "fake-ego-browser-"));
    const executable = join(bin, "ego-browser");
    await writeFile(executable, `#!/usr/bin/env node
process[process.env.FAKE_EGO_STREAM || "stdout"].write(process.env.FAKE_EGO_STDOUT || "");
process.exit(Number(process.env.FAKE_EGO_EXIT_CODE || "0"));
`, { mode: 0o755 });
    await chmod(executable, 0o755);
    return {
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_EGO_STDOUT: stdout,
        FAKE_EGO_STREAM: stream,
    };
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

describe("coros-auth import-token --from-browser", () => {
    it("prints the complete manual fallback when ego-browser is unavailable", async () => {
        const home = await mkdtemp(join(tmpdir(), "coros-browser-missing-home-"));
        const emptyPath = await mkdtemp(join(tmpdir(), "coros-browser-missing-path-"));
        const output = capture();
        const errors = capture();

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--from-browser"],
            env: { HOME: home, PATH: emptyPath },
            output: output.stream,
            errorOutput: errors.stream,
        });

        expect(exitCode).toBe(1);
        expect(errors.text()).toContain("未检测到 ego-browser，请改用默认的手动粘贴方式");
        expect(errors.text()).toContain("Manual token import:");
        expect(errors.text()).toContain("coros-auth import-token --region <en|eu|cn>");
        expect(output.text()).toBe("");
    });

    it("parses a prefixed JSON result among ego-browser noise", async () => {
        const token = "browser-noise-secret";
        const home = await mkdtemp(join(tmpdir(), "coros-browser-noise-"));
        const env = await fakeEgoBrowserEnvironment(home, [
            "[ego-browser:notice] harmless diagnostic",
            `COROS_AUTH_BROWSER_RESULT=${JSON.stringify({ token, regionId: "2" })}`,
            "another noise line",
        ].join("\n"));
        const output = capture();
        const errors = capture();
        let validatedRegion: string | undefined;

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--from-browser", "--region", "cn"],
            env,
            output: output.stream,
            errorOutput: errors.stream,
            validateToken: async (receivedToken, region) => {
                expect(receivedToken).toBe(token);
                validatedRegion = region;
                return { userId: "browser-user", regionId: 2, region: "cn" };
            },
        });

        expect(exitCode).toBe(0);
        expect(validatedRegion).toBe("cn");
        expect((await readTokenFile(defaultTokenFilePath(env)))?.accessToken).toBe(token);
        expect(output.text() + errors.text()).not.toContain(token);
        expect(output.text()).not.toContain("ego-browser:notice");
    });

    it("reads the result when ego-browser relays script output on stderr", async () => {
        // ego-browser prints script `console.log` output on stderr, so a
        // stdout-only reader silently finds no result. Verified against the real
        // binary on 2026-09.
        const token = "stderr-relayed-secret";
        const home = await mkdtemp(join(tmpdir(), "coros-browser-stderr-"));
        const env = await fakeEgoBrowserEnvironment(
            home,
            `COROS_AUTH_BROWSER_RESULT=${JSON.stringify({ token, regionId: "2" })}\n`,
            "stderr",
        );
        const output = capture();
        const errors = capture();

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--from-browser", "--region", "cn"],
            env,
            output: output.stream,
            errorOutput: errors.stream,
            validateToken: async () => ({ userId: "browser-user", regionId: 2, region: "cn" }),
        });

        expect(exitCode).toBe(0);
        expect((await readTokenFile(defaultTokenFilePath(env)))?.accessToken).toBe(token);
        expect(output.text() + errors.text()).not.toContain(token);
    });

    it("explains how to recover when the browser cookie is missing", async () => {
        const tokenThatMustNotLeak = "diagnostic-secret";
        const home = await mkdtemp(join(tmpdir(), "coros-browser-cookie-missing-"));
        const env = await fakeEgoBrowserEnvironment(home, [
            `[ego-browser:notice] ${tokenThatMustNotLeak}`,
            `COROS_AUTH_BROWSER_RESULT=${JSON.stringify({ token: null, regionId: null })}`,
        ].join("\n"));
        const output = capture();
        const errors = capture();

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--from-browser"],
            env,
            output: output.stream,
            errorOutput: errors.stream,
        });

        expect(exitCode).toBe(1);
        expect(errors.text()).toContain("请先在浏览器里登录 Training Hub 再重试");
        expect(errors.text()).toContain("https://training.coros.com");
        expect(output.text() + errors.text()).not.toContain(tokenThatMustNotLeak);
    });

    it("warns and gives the browser cookie region precedence", async () => {
        const token = "browser-region-secret";
        const home = await mkdtemp(join(tmpdir(), "coros-browser-region-"));
        const env = await fakeEgoBrowserEnvironment(
            home,
            `COROS_AUTH_BROWSER_RESULT=${JSON.stringify({ token, regionId: "2" })}\n`,
        );
        const output = capture();
        const errors = capture();
        let validatedRegion: string | undefined;

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--region", "en", "--from-browser"],
            env,
            output: output.stream,
            errorOutput: errors.stream,
            validateToken: async (_receivedToken, region) => {
                validatedRegion = region;
                return { userId: "browser-user", regionId: 2, region: "cn" };
            },
        });

        expect(exitCode).toBe(0);
        expect(validatedRegion).toBe("cn");
        expect(errors.text()).toContain("warning=CPL-coros-region indicates cn; overriding --region en");
        expect(output.text() + errors.text()).not.toContain(token);
    });

    it("does not print a browser token when validation fails", async () => {
        const token = "browser-validation-secret";
        const home = await mkdtemp(join(tmpdir(), "coros-browser-redaction-"));
        const env = await fakeEgoBrowserEnvironment(
            home,
            `COROS_AUTH_BROWSER_RESULT=${JSON.stringify({ token, regionId: "1" })}\n`,
        );
        const output = capture();
        const errors = capture();

        const exitCode = await runCorosAuthCli({
            argv: ["import-token", "--from-browser"],
            env,
            output: output.stream,
            errorOutput: errors.stream,
            validateToken: async () => {
                throw new Error(`validation echoed ${token}`);
            },
        });

        expect(exitCode).toBe(1);
        expect(output.text() + errors.text()).not.toContain(token);
    });
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
