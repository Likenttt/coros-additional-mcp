/**
 * Activity list item from `activity/query`.
 *
 * Values are **unscaled**: metres, seconds, epoch seconds. The detail
 * `summary` reports the same fields centi-scaled — see `src/units.ts`.
 *
 * The same field set comes back for every sport, zero-filled where irrelevant,
 * so a walk still carries `swolf` and `totalFishingTime`. A zero means "not
 * applicable" as often as it means zero.
 */
export interface ActivityListItem {
    /** YYYYMMDD. */
    date: number;
    labelId: string;
    name?: string | null;
    sportType: number;
    /** Device model, e.g. "COROS NOMAD". */
    device?: string;
    deviceId?: string;
    deviceSportMode?: number;
    mode?: number;
    subMode?: number;

    /** Metres. */
    distance?: number;
    /** Metres; mirrors `distance` on the activities observed. */
    total?: number;
    /** Seconds, wall clock including pauses. */
    totalTime?: number;
    /** Seconds, moving time. */
    workoutTime?: number;
    /** Epoch seconds. */
    startTime?: number;
    /** Epoch seconds. */
    endTime?: number;
    /** Quarter-hours east of UTC: 8 means UTC+2. */
    startTimezone?: number;
    endTimezone?: number;

    /** Calories (not kilocalories) — divide by 1000. */
    calorie?: number;
    /** Despite the name, seconds per kilometre. */
    avgSpeed?: number;
    maxSpeed?: number;
    adjustedPace?: number;
    avgHr?: number;
    avgCadence?: number;
    cadence?: number;
    avgPower?: number;
    np?: number;
    step?: number;
    ascent?: number;
    descent?: number;
    totalDescent?: number;
    trainingLoad?: number;

    imageUrl?: string;
    imageUrlType?: number;
    unitType?: number;
    hasMessage?: number;
    [key: string]: unknown;
}

/** One page of `activity/query`. */
export interface ActivityListData {
    count: number;
    totalPage?: number;
    pageNumber?: number;
    dataList?: ActivityListItem[];
}

/**
 * Activity detail summary.
 *
 * Numeric values are **centi-scaled**: `distance: 235759` is 2357.59 m.
 * Reading them as base units gives a 100x error — use `src/units.ts`.
 * `calories` is the exception and is not scaled.
 *
 * ~150 fields come back regardless of sport; the useful ones are named, the
 * rest reachable through the index signature.
 */
export interface ActivityDetailSummary {
    name?: string;
    sportType?: number;
    sportMode?: number;
    deviceSportMode?: number;
    userId?: string;
    /** Centi-scaled metres. */
    distance?: number;
    /** Centi-scaled seconds. */
    totalTime?: number;
    /** Centi-scaled seconds. */
    workoutTime?: number;
    /** Centi-scaled epoch seconds. */
    startTimestamp?: number;
    /** Centi-scaled epoch seconds. */
    endTimestamp?: number;
    /** Quarter-hours east of UTC. */
    timezone?: number;
    /** Calories, not centi-scaled. Divide by 1000 for kcal. */
    calories?: number;
    avgHr?: number;
    maxHr?: number;
    avgCadence?: number;
    maxCadence?: number;
    avgPace?: number;
    avgSpeed?: number;
    maxSpeed?: number;
    avgPower?: number;
    maxPower?: number;
    trainingLoad?: number;
    aerobicEffect?: number;
    anaerobicEffect?: number;
    currentVo2Max?: number;
    elevGain?: number;
    minElev?: number;
    maxElev?: number;
    [key: string]: unknown;
}

/**
 * A single lap, centi-scaled like the rest of the detail response. ~120 fields
 * come back; the useful ones are named.
 */
export interface ActivityLapItem {
    lapIndex?: number;
    lapType?: number;
    rowIndex?: number;
    setIndex?: number;
    /** Centi-scaled metres. */
    distance?: number;
    totalDistance?: number;
    /** Centi-scaled seconds. */
    time?: number;
    /** Centi-scaled epoch seconds. */
    startTimestamp?: number;
    /** Centi-scaled epoch seconds. */
    endTimestamp?: number;
    pauseTime?: number;
    avgHr?: number;
    maxHr?: number;
    minHr?: number;
    avgPace?: number;
    avgMoveSpeed?: number;
    avgSpeedV2?: number;
    maxSpeed?: number;
    minSpeed?: number;
    avgCadence?: number;
    maxCadence?: number;
    minCadence?: number;
    totalCadence?: number;
    avgPower?: number;
    maxPower?: number;
    minPower?: number;
    avgStrideLength?: number;
    calories?: number;
    elevGain?: number;
    avgElev?: number;
    maxElev?: number;
    minElev?: number;
    totalDescent?: number;
    /** Degrees scaled by 1e7 — see `gpsCoordinate()` in `src/units.ts`. */
    startGpsLat?: number;
    startGpsLon?: number;
    endGpsLat?: number;
    endGpsLon?: number;
    lat?: number;
    lng?: number;
    sportType?: number;
    [key: string]: unknown;
}

/**
 * A lap grouping. The API returns several groupings per activity (by distance,
 * by manual lap, ...) distinguished by `type`, each holding its own laps.
 */
export interface ActivityLapGroup {
    /** Grouping kind, e.g. auto-lap by distance vs manual laps. */
    type?: number;
    /** Lap interval in metres for distance-based groupings. */
    lapDistance?: number;
    fastLapIndexList?: number[];
    lapItemList?: ActivityLapItem[];
    [key: string]: unknown;
}

/**
 * One sample of the recorded track. A ~2 hour activity yields several thousand.
 *
 * `timestamp` is centi-scaled epoch seconds and the GPS fields are degrees
 * scaled by 1e7 — use `dateFromDetailTimestamp()` and `gpsCoordinate()`.
 */
export interface ActivityFrequencyPoint {
    /** Centi-scaled epoch seconds. */
    timestamp?: number;
    /** Degrees scaled by 1e7: 577528390 is 57.752839. */
    gpsLat?: number;
    /** Degrees scaled by 1e7. */
    gpsLon?: number;
    distance?: number;
    level?: number;
    [key: string]: unknown;
}

/** Note and rating from the watch or app. Detail response only. */
export interface ActivitySportFeelInfo {
    /**
     * Perceived exertion, 1..5 from "Very Light" to "Max Effort", `0` when
     * unrated. Resolve with `perceivedExertionName()`.
     */
    feelType?: number;
    /** Free-text note. `""` when unset, never absent — test for a non-empty string. */
    sportNote?: string;
    /** Voice note, when one was recorded. Zero/empty otherwise. */
    voiceNoteFileUuid?: number;
    voiceNoteStatus?: number;
    voiceNoteWavUrl?: string;
    [key: string]: unknown;
}

/** Activity detail: summary, laps and the recorded track. */
export interface ActivityDetailData {
    summary?: ActivityDetailSummary;
    /** Activity note and feel rating; see {@link ActivitySportFeelInfo}. */
    sportFeelInfo?: ActivitySportFeelInfo;
    /** Lap groupings; each holds its own `lapItemList`. */
    lapList?: ActivityLapGroup[];
    lapGraphList?: unknown[];
    deviceList?: unknown[];
    /** The recorded track: one sample per second or so. */
    frequencyList?: ActivityFrequencyPoint[];
    graphList?: unknown[];
    pauseList?: unknown[];
    zoneList?: unknown[];
    userInfo?: Record<string, unknown>;
    userProfile?: Record<string, unknown>;
    weather?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Signed storage URL for a FIT/TCX/GPX export. */
export interface ActivityDownloadData {
    fileUrl: string;
}
