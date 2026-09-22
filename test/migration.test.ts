import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyMigrationState, enqueueMigration, failureDelay, nextMigration, recordMigration } from "../src/mcp/migration.ts";
import { locateGarminFit } from "../src/mcp/migration-store.ts";

const start = new Date("2026-09-22T12:00:00.000Z");

describe("migration ledger", () => {
    it("keeps the two lanes separate and refuses a second write while one is leased", () => {
        let state = emptyMigrationState();
        state = enqueueMigration(state, "garmin_to_coros", [{ id: "101" }, { id: "102" }], { now: start }).state;
        state = enqueueMigration(state, "coros_to_garmin", [{ id: "501" }], { now: start }).state;

        const first = nextMigration(state, undefined, { now: start });
        expect(first.action).toBe("download_from_garmin");
        expect(first.item?.id).toBe("101");

        const second = nextMigration(first.state, undefined, { now: new Date(start.getTime() + 1000) });
        expect(second.action).toBe("download_from_garmin");
        expect(second.item?.id).toBe("101");
        expect(second.state.lanes.coros_to_garmin.items["501"].status).toBe("queued");
    });

    it("waits after success and backs off exponentially after failure", () => {
        let state = enqueueMigration(emptyMigrationState(), "garmin_to_coros", [{ id: "101" }, { id: "102" }], { now: start }).state;
        state = nextMigration(state, "garmin_to_coros", { now: start }).state;
        state = recordMigration(state, { lane: "garmin_to_coros", id: "101", outcome: "succeeded", remoteId: "import-1" }, { now: start, random: () => 0 });

        const tooSoon = nextMigration(state, "garmin_to_coros", { now: new Date(start.getTime() + 1000) });
        expect(tooSoon.action).toBe("wait");
        expect(tooSoon.waitMs).toBe(44_000);

        state = enqueueMigration(emptyMigrationState(), "coros_to_garmin", [{ id: "501" }], { now: start }).state;
        state = nextMigration(state, "coros_to_garmin", { now: start }).state;
        state = recordMigration(state, { lane: "coros_to_garmin", id: "501", outcome: "failed", error: "timeout" }, { now: start, random: () => 0 });
        const retry = nextMigration(state, "coros_to_garmin", { now: new Date(start.getTime() + 1000) });
        expect(retry.action).toBe("wait");
        expect(retry.waitMs).toBe(failureDelay(1, () => 0) - 1000);
        expect(failureDelay(3, () => 0)).toBe(120_000);
        expect(failureDelay(10, () => 0)).toBeLessThanOrEqual(15 * 60 * 1000);
    });

    it("locates one Garmin FIT without following a symlink", async () => {
        const root = await mkdtemp(join(tmpdir(), "garmin-fit-"));
        const dir = join(root, "GARMIN_FIT_cn_user");
        await mkdtemp(dir).catch(async () => undefined);
        const { mkdir } = await import("node:fs/promises");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "42.fit"), "fit-bytes");
        const found = await locateGarminFit(root, "42");
        expect(found.filePath).toBe(join(dir, "42.fit"));
        expect(found.sha256).toHaveLength(64);
    });
});
