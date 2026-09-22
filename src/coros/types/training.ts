/**
 * Training schedule (`training/schedule/query`).
 *
 * An account with no plan gets the same envelope with `programs` and
 * `daySummaries` empty, so almost everything is optional.
 */

/** Planned vs actual totals for a week. */
export interface TrainSum {
    actualCount?: number;
    /** Sent as a string by the API. */
    actualDistance?: string;
    actualDuration?: number;
    actualElevGain?: number;
    actualPitch?: number;
    actualTrainingLoad?: number;
    planCount?: number;
    /** Sent as a string by the API. */
    planDistance?: string;
    planDuration?: number;
    planElevGain?: number;
    planHybridTotalSets?: number;
    planPitch?: number;
    planSets?: number;
    planTrainingLoad?: number;
    [key: string]: unknown;
}

/** One week of a training plan. */
export interface TrainingWeekStage {
    /** YYYYMMDD. */
    firstDayInWeek: number;
    planId?: string;
    stage?: number;
    sumByType?: unknown[];
    trainSum?: TrainSum;
    [key: string]: unknown;
}

/**
 * A single planned workout. `essence`, `originEssence`, `simple` and `overview`
 * hold the structured definition, untyped: the shape varies by sport.
 */
export interface TrainingProgram {
    id: string;
    name?: string;
    planId?: string;
    idInPlan?: string;
    planIdIndex?: number;
    sportType?: number;
    subType?: number;
    type?: number;
    /** Epoch seconds. */
    createTimestamp?: number;
    /** Seconds. */
    duration?: number;
    estimatedTime?: number;
    /** Scaling unconfirmed. */
    distance?: number;
    estimatedDistance?: number;
    distanceDisplayUnit?: number;
    estimatedType?: number;
    estimatedValue?: number;
    exerciseNum?: number;
    poolLength?: number;
    targetType?: number;
    targetValue?: number;
    totalSets?: number;
    trainingLoad?: number;
    star?: number;
    status?: number;
    access?: number;
    sex?: number;
    unit?: number;
    version?: number;
    pbVersion?: number;
    /** Structured workout definition; shape varies by sport. */
    essence?: unknown;
    originEssence?: unknown;
    simple?: unknown;
    overview?: unknown;
    [key: string]: unknown;
}

/** Training calendar for a date range: the active plan plus per-week rollups. */
export interface TrainingScheduleData {
    id?: string;
    name?: string;
    userId?: string;
    authorId?: string;
    /** YYYYMMDD. */
    startDay?: number;
    /** YYYYMMDD. */
    endDay?: number;
    totalDay?: number;
    status?: number;
    executeStatus?: number;
    inSchedule?: boolean;
    category?: number;
    type?: number;
    unit?: number;
    version?: number;
    pbVersion?: number;
    /** Epoch seconds. */
    starTimestamp?: number;
    createTime?: string;
    updateTime?: string;
    updateTimestamp?: number;
    programs?: TrainingProgram[];
    weekStages?: TrainingWeekStage[];
    daySummaries?: unknown[];
    subPlans?: unknown[];
    sportDatasInPlan?: unknown[];
    sportDatasNotInPlan?: unknown[];
    userInfos?: unknown;
    /** Present on some responses as a keyed map of plan entities. */
    entities?: Record<string, unknown>;
    [key: string]: unknown;
}
