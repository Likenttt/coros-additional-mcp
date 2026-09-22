import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

const MAX_OUTPUT_BYTES = 64 * 1024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const ACL_ENTRY_PATTERN =
    /^\s+\d+:\s+.+\s+(?:inherited\s+)?(allow|deny)\s+[a-z][a-z0-9_-]*(?:,[a-z][a-z0-9_-]*)*\s*$/;

/** Reject macOS ACL entries that grant access beyond owner-only POSIX mode. */
export async function verifyNoGrantingDarwinAcl(path: string): Promise<void> {
    if (!isAbsolute(path) || CONTROL_CHARACTER_PATTERN.test(path)) {
        throw new Error("Session ACL could not be verified.");
    }

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile("/bin/ls", ["-lde", "--", path], {
            encoding: "utf8",
            env: { LANG: "C", LC_ALL: "C" },
            maxBuffer: MAX_OUTPUT_BYTES,
            shell: false,
            timeout: 5_000,
        }, (error, commandStdout, commandStderr) => {
            if (error) reject(new Error("Session ACL could not be verified."));
            else resolve({ stdout: commandStdout, stderr: commandStderr });
        });
    });

    if (stderr.length > 0 || !stdout.split(/\r?\n/)[0]?.trim()) {
        throw new Error("Session ACL could not be verified.");
    }
    for (const line of stdout.split(/\r?\n/).slice(1)) {
        if (!line) continue;
        const entry = ACL_ENTRY_PATTERN.exec(line);
        if (!entry || entry[1] !== "deny") {
            throw new Error("Session ACL grants access beyond the file owner.");
        }
    }
}
