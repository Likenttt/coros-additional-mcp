export const LANES = ["garmin_to_coros", "coros_to_garmin"] as const;
export type MigrationLane = (typeof LANES)[number];
export type MigrationStatus = "queued" | "leased" | "downloaded" | "succeeded" | "failed" | "skipped";

export interface MigrationItem {
    id: string;
    status: MigrationStatus;
    attempts: number;
    nextAttemptAt: string;
    leasedUntil?: string;
    remoteId?: string;
    sourceDate?: string;
    title?: string;
    fileName?: string;
    sha256?: string;
    localPath?: string;
    lastError?: string;
    updatedAt: string;
}

export interface MigrationLaneState {
    lastWriteAt?: string;
    items: Record<string, MigrationItem>;
}

export interface MigrationState {
    version: 1;
    nextActionAt?: string;
    lanes: Record<MigrationLane, MigrationLaneState>;
}

export interface MigrationClock {
    now?: Date;
    random?: () => number;
}

const LEASE_MS = 8 * 60 * 1000;
const SUCCESS_PAUSE_MS = 45_000;
const SUCCESS_JITTER_MS = 40_000;
const FAILURE_BASE_MS = 30_000;
const FAILURE_CAP_MS = 15 * 60 * 1000;
const MAX_ENQUEUE = 20;

export function emptyMigrationState(): MigrationState {
    return {
        version: 1,
        lanes: {
            garmin_to_coros: { items: {} },
            coros_to_garmin: { items: {} },
        },
    };
}

export function enqueueMigration(
    state: MigrationState,
    lane: MigrationLane,
    incoming: Array<{ id: string; sourceDate?: string; title?: string }>,
    clock: MigrationClock = {},
): { state: MigrationState; added: string[]; alreadyKnown: string[] } {
    const now = iso(clock.now);
    const next = clone(state);
    const added: string[] = [];
    const alreadyKnown: string[] = [];
    for (const item of incoming.slice(0, MAX_ENQUEUE)) {
        const id = item.id.trim();
        if (!id) continue;
        if (next.lanes[lane].items[id]) {
            alreadyKnown.push(id);
            continue;
        }
        next.lanes[lane].items[id] = {
            id,
            status: "queued",
            attempts: 0,
            nextAttemptAt: now,
            sourceDate: item.sourceDate,
            title: item.title,
            updatedAt: now,
        };
        added.push(id);
    }
    return { state: next, added, alreadyKnown };
}

export interface MigrationNext {
    action: "wait" | "download_from_garmin" | "upload_to_coros" | "download_from_coros" | "upload_to_garmin" | "done";
    waitMs: number;
    lane?: MigrationLane;
    item?: MigrationItem;
    state: MigrationState;
    instruction: string;
}

export function nextMigration(state: MigrationState, lane: MigrationLane | undefined, clock: MigrationClock = {}): MigrationNext {
    const now = clock.now ?? new Date();
    const next = releaseExpiredLeases(clone(state), now);
    const waitMs = Math.max(0, Date.parse(next.nextActionAt ?? iso(now)) - now.getTime());
    if (waitMs > 0) {
        return {
            action: "wait",
            waitMs,
            state: next,
            instruction: `Stop. Wait ${Math.ceil(waitMs / 1000)} seconds before the next transfer. Do not start another download or upload.`,
        };
    }

    const active = findActive(next, lane);
    if (active) return actionFor(next, active.lane, active.item, 0);

    const due = findDue(next, lane, now);
    if (!due) {
        return {
            action: "done",
            waitMs: 0,
            lane,
            state: next,
            instruction: "Nothing is due on the requested lane. Do not scan or upload more activities in this turn.",
        };
    }
    const item = next.lanes[due.lane].items[due.item.id];
    item.status = "leased";
    item.leasedUntil = iso(new Date(now.getTime() + LEASE_MS));
    item.updatedAt = iso(now);
    return actionFor(next, due.lane, item, 0);
}

export function recordMigration(
    state: MigrationState,
    input: {
        lane: MigrationLane;
        id: string;
        outcome: "downloaded" | "succeeded" | "failed" | "skipped";
        remoteId?: string;
        fileName?: string;
        sha256?: string;
        localPath?: string;
        error?: string;
    },
    clock: MigrationClock = {},
): MigrationState {
    const now = clock.now ?? new Date();
    const random = clock.random ?? Math.random;
    const next = clone(state);
    const item = next.lanes[input.lane].items[input.id];
    if (!item) throw new Error(`Migration item ${input.id} is not queued on ${input.lane}.`);
    item.updatedAt = iso(now);
    item.leasedUntil = undefined;
    if (input.remoteId) item.remoteId = input.remoteId;
    if (input.fileName) item.fileName = input.fileName;
    if (input.sha256) item.sha256 = input.sha256;
    if (input.localPath) item.localPath = input.localPath;

    if (input.outcome === "downloaded") {
        item.status = "downloaded";
        const pause = humanPause(random);
        item.nextAttemptAt = iso(new Date(now.getTime() + pause));
        next.nextActionAt = item.nextAttemptAt;
        return next;
    }
    if (input.outcome === "skipped") {
        item.status = "skipped";
        item.lastError = input.error;
        return next;
    }
    if (input.outcome === "succeeded") {
        item.status = "succeeded";
        item.lastError = undefined;
        next.lanes[input.lane].lastWriteAt = iso(now);
        const pause = humanPause(random);
        item.nextAttemptAt = iso(new Date(now.getTime() + pause));
        next.nextActionAt = item.nextAttemptAt;
        return next;
    }

    item.attempts += 1;
    item.status = "failed";
    item.lastError = input.error?.slice(0, 300);
    const delay = failureDelay(item.attempts, random);
    item.nextAttemptAt = iso(new Date(now.getTime() + delay));
    next.nextActionAt = item.nextAttemptAt;
    return next;
}

export function migrationSummary(state: MigrationState, now = new Date()) {
    return {
        nextActionAt: state.nextActionAt ?? null,
        waitMs: Math.max(0, Date.parse(state.nextActionAt ?? iso(now)) - now.getTime()),
        lanes: Object.fromEntries(LANES.map((lane) => {
            const counts: Record<string, number> = {};
            for (const item of Object.values(state.lanes[lane].items)) {
                counts[item.status] = (counts[item.status] ?? 0) + 1;
            }
            return [lane, { lastWriteAt: state.lanes[lane].lastWriteAt ?? null, counts, total: Object.keys(state.lanes[lane].items).length }];
        })),
    };
}

export function humanPause(random: () => number): number {
    return SUCCESS_PAUSE_MS + Math.floor(random() * SUCCESS_JITTER_MS);
}

export function failureDelay(attempts: number, random: () => number): number {
    const exponential = FAILURE_BASE_MS * 2 ** Math.min(Math.max(attempts, 1) - 1, 8);
    const capped = Math.min(FAILURE_CAP_MS, exponential);
    return capped + Math.floor(random() * Math.min(15_000, capped * 0.25));
}

function actionFor(state: MigrationState, lane: MigrationLane, item: MigrationItem, waitMs: number): MigrationNext {
    if (lane === "garmin_to_coros" && item.status !== "downloaded") {
        return {
            action: "download_from_garmin",
            waitMs,
            lane,
            item,
            state,
            instruction: "Call dsh-plugin-garmin-connect download_garmin_activity_fit for this one activityId. Then migration_record outcome=downloaded with its fileName and sha256. Do not upload yet.",
        };
    }
    if (lane === "garmin_to_coros") {
        return {
            action: "upload_to_coros",
            waitMs,
            lane,
            item,
            state,
            instruction: "Upload only localPath with upload_activity. Then migration_record outcome=succeeded or failed. Do not enqueue or upload another file.",
        };
    }
    if (item.status !== "downloaded") {
        return {
            action: "download_from_coros",
            waitMs,
            lane,
            item,
            state,
            instruction: "Call download_activity for this one labelId. Then migration_record outcome=downloaded with localPath. Do not upload it to Garmin yet.",
        };
    }
    return {
        action: "upload_to_garmin",
        waitMs,
        lane,
        item,
        state,
        instruction: "Upload only localPath through dsh-plugin-garmin-connect. The current plugin can download FIT files but has no FIT import tool; if that tool is absent, stop and tell the user instead of inventing an upload. Then migration_record the result. Do not start another file.",
    };
}

function findActive(state: MigrationState, lane: MigrationLane | undefined): { lane: MigrationLane; item: MigrationItem } | undefined {
    for (const candidate of lanesToScan(lane)) {
        const item = Object.values(state.lanes[candidate].items).find((entry) => entry.status === "leased" || entry.status === "downloaded");
        if (item) return { lane: candidate, item };
    }
    return undefined;
}

function findDue(state: MigrationState, lane: MigrationLane | undefined, now: Date): { lane: MigrationLane; item: MigrationItem } | undefined {
    const due = lanesToScan(lane).flatMap((candidate) => Object.values(state.lanes[candidate].items)
        .filter((item) => (item.status === "queued" || item.status === "failed") && Date.parse(item.nextAttemptAt) <= now.getTime())
        .map((item) => ({ lane: candidate, item })));
    due.sort((left, right) => Date.parse(state.lanes[left.lane].lastWriteAt ?? "1970-01-01") - Date.parse(state.lanes[right.lane].lastWriteAt ?? "1970-01-01")
        || left.item.nextAttemptAt.localeCompare(right.item.nextAttemptAt));
    return due[0];
}

function releaseExpiredLeases(state: MigrationState, now: Date): MigrationState {
    for (const lane of LANES) {
        for (const item of Object.values(state.lanes[lane].items)) {
            if (item.status === "leased" && item.leasedUntil && Date.parse(item.leasedUntil) <= now.getTime()) {
                item.status = item.attempts > 0 ? "failed" : "queued";
                item.leasedUntil = undefined;
                item.updatedAt = iso(now);
            }
        }
    }
    return state;
}

function lanesToScan(lane: MigrationLane | undefined): MigrationLane[] {
    return lane ? [lane] : [...LANES];
}

function clone(state: MigrationState): MigrationState {
    return structuredClone(state);
}

function iso(date: Date | undefined): string {
    return (date ?? new Date()).toISOString();
}
