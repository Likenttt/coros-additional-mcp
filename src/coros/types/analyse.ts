/**
 * EvoLab analytics (`analyse/query`).
 *
 * Values are **not** centi-scaled — metres and seconds, like `activity/query`.
 * Field names follow the API exactly, including its `recomend*` spelling.
 */

/** A min/max band with a zone index, used for fatigue and load-ratio zones. */
export interface ZoneBand {
    /** Absent on the topmost band. */
    max?: number;
    /** Absent on the bottommost band. */
    min?: number;
    /** 1-based zone index. */
    type: number;
}

/**
 * One day of EvoLab metrics. Days with no wearable data carry only the required
 * fields; the optional ones are genuinely absent rather than zero.
 */
export interface AnalyseDay {
    /** YYYYMMDD. */
    happenDay: number;
    /** Epoch seconds (not centi-scaled). */
    timestamp: number;
    /** Metres. */
    distance: number;
    distanceTarget: number;
    /** Seconds. */
    duration: number;
    durationTarget: number;
    /** Resting heart rate, bpm. */
    rhr: number;
    /** 28-day training load — EvoLab "Base Fitness". */
    t28d: number;
    trainingLoadTarget: number;
    /** Training intensity balance. */
    tib: number;

    /** 7-day training load — EvoLab "Load Impact". */
    t7d?: number;
    /** Acute training impulse. */
    ati?: number;
    /** Chronic training impulse. */
    cti?: number;
    ct7dMin?: number;
    ct7dMaxFixed?: number;
    trainingLoad?: number;
    trainingLoadRatio?: number;
    trainingLoadRatioState?: number;
    trainingLoadRatioZoneList?: ZoneBand[];
    /** -1 when no performance estimate is available. */
    performance?: number;
    recomendTlMin?: number;
    recomendTlMax?: number;
    /** Overnight HRV, milliseconds. */
    avgSleepHrv?: number;
    sleepHrvBase?: number;
    sleepHrvIntervalList?: number[];
    testRhr?: number;
    tiredRate?: number;
    tiredRateNew?: number;
    tiredRateStateNew?: number;
    tiredRateNewZoneList?: ZoneBand[];
    [key: string]: unknown;
}

/** One bucket of a weekly record series. */
export interface RecordPeriod {
    count: number;
    /** YYYYMMDD. */
    firstDayOfWeek: number;
    /** Epoch seconds. */
    firstDayOfWeekTimestamp: number;
    /** YYYYMMDD. Note the API's inconsistent `InWeek` / `OfWeek` naming. */
    lastDayInWeek: number;
    lastDayOfWeekTimestamp: number;
    periodHighPct: number;
    periodHighValue: number;
    periodLowPct: number;
    periodLowValue: number;
    periodMediumPct: number;
    periodMediumValue: number;
    target: number;
    value: number;
}

/**
 * A weekly series with totals. The same shape backs distance, duration,
 * training-load records and the training-load intensity breakdown.
 */
export interface RecordSeries {
    count: number;
    detailList: RecordPeriod[];
    percentage: number;
    totalTarget: number;
    totalValue: number;
    type: number;
}

/** A single bucket of a distribution (heart-rate zones, distance bands). */
export interface DistributionBucket {
    index: number;
    /** Percentage of the total. */
    ratio: number;
    value: number;
}

/** Distribution summaries across the queried range. */
export interface AnalyseSummaryInfo {
    distanceCountAreaList?: DistributionBucket[];
    distanceTimeAreaList?: DistributionBucket[];
    distanceTlAreaList?: DistributionBucket[];
    hrDisAreaList?: DistributionBucket[];
    hrTimeAreaList?: DistributionBucket[];
    hrTlAreaList?: DistributionBucket[];
    recomendTlInDays?: number;
    [key: string]: unknown;
}

/** One week of training-load targets. */
export interface AnalyseWeek {
    /** YYYYMMDD. */
    firstDayOfWeek: number;
    trainingLoad: number;
    recomendTlMin?: number;
    recomendTlMax?: number;
    [key: string]: unknown;
}

/** Distance, duration and training-load weekly records. */
export interface AnalyseRecord {
    distanceRecord?: RecordSeries;
    durationRecord?: RecordSeries;
    tlRecord?: RecordSeries;
    [key: string]: unknown;
}

/** EvoLab analytics for a date range (`analyse/query`). */
export interface AnalyseData {
    /** One entry per day in the requested range. */
    dayList?: AnalyseDay[];
    /** Rolling 7-day view over the same range. */
    t7dayList?: AnalyseDay[];
    weekList?: AnalyseWeek[];
    record?: AnalyseRecord;
    summaryInfo?: AnalyseSummaryInfo;
    tlIntensity?: RecordSeries;
    trainingWeekStageList?: unknown[];
    /**
     * `modelValidState` is false until the account has enough activity for
     * EvoLab's model to produce meaningful numbers.
     */
    sportDataSummary?: { count: number; modelValidState: boolean; [key: string]: unknown };
    [key: string]: unknown;
}

/**
 * Private profile / dashboard layout (`profile/private/query`).
 * Presentation configuration for the Training Hub UI, not training data.
 */
export interface PrivateProfileData {
    activityDetailLapList?: unknown[];
    activityProfileList?: unknown[];
    analyseProfileList?: unknown[];
    dashboardProfileList?: unknown[];
    teamUserViewProfile?: Record<string, unknown>;
    [key: string]: unknown;
}
