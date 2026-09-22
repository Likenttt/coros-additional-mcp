/** COROS Team API region. */
export type ApiRegion = "en" | "eu" | "cn";

export const BASE_URL_BY_REGION: Record<ApiRegion, string> = {
    en: "https://teamapi.coros.com",
    eu: "https://teameuapi.coros.com",
    cn: "https://teamcnapi.coros.com",
};

export const DEFAULT_BASE_URL = BASE_URL_BY_REGION.en;

/** Issues the temporary S3 credentials used for upload. */
export const FAQ_API_URL = "https://faq.coros.com";

/** Stripped from the base64 STS credentials before decoding. */
export const STS_SALT = "9y78gpoERW4lBNYL";

export const STS_APP_ID = "1660188068672619112";
/**
 * STS signatures. Each is bound to one bucket; sending it with a different
 * `bucket` answers `401 signature error`.
 *
 * Opaque values belonging to COROS. They cannot be derived, so if COROS rotates
 * them upload breaks until they are recaptured.
 */
export const STS_SIGN_EN = "E34EF0E34A498A54A9C3EAEFC12B7CAF";
export const STS_SIGN_EU = "877571111A1EE5316E4B590103D4B5B3";
export const STS_SIGN_CN = "9AD4AA35AAFEE6BB1E847A76848D58DF";

export interface STSConfig {
    env: string;
    bucket: string;
    service: "aws" | "aliyun";
    sign: string;
}

export const STS_CONFIG_BY_REGION: Record<ApiRegion, STSConfig> = {
    en: { env: "en.prod", bucket: "coros-s3", service: "aws", sign: STS_SIGN_EN },
    eu: { env: "eu.prod", bucket: "eu-coros", service: "aws", sign: STS_SIGN_EU },
    cn: { env: "cn.prod", bucket: "coros-oss", service: "aliyun", sign: STS_SIGN_CN },
};

export interface ObjectStorageConfig {
    bucket: string;
    service: "aws" | "aliyun";
    /** AWS signing region; absent for Aliyun OSS. */
    region?: string;
    endpoint: string;
}

/** Object storage selected by the account region. */
export const OBJECT_STORAGE_CONFIG_BY_REGION: Record<ApiRegion, ObjectStorageConfig> = {
    en: {
        bucket: "coros-s3",
        service: "aws",
        region: "us-west-1",
        endpoint: "https://s3.us-west-1.amazonaws.com",
    },
    eu: {
        bucket: "eu-coros",
        service: "aws",
        region: "eu-central-1",
        endpoint: "https://s3.eu-central-1.amazonaws.com",
    },
    cn: {
        bucket: "coros-oss",
        service: "aliyun",
        endpoint: "https://oss-cn-beijing.aliyuncs.com",
    },
};

const REGION_BY_ID: Record<number, ApiRegion> = { 1: "en", 2: "cn", 3: "eu" };

/** Map the region id returned by account/login to this library's region key. */
export function regionFromId(regionId: number | string): ApiRegion {
    const numericId = typeof regionId === "string" ? Number(regionId) : regionId;
    const region = REGION_BY_ID[numericId];
    if (!region) throw new RangeError(`Unsupported COROS regionId: ${regionId}`);
    return region;
}

/** Used when neither `uploadRegion` nor `region` is given. */
export const DEFAULT_UPLOAD_REGION: ApiRegion = "en";

/** Export formats for activity detail/download. */
export type FileTypeKey = "fit" | "tcx" | "gpx" | "kml" | "csv";

export const FILE_TYPE_API_VALUES: Record<FileTypeKey, string> = {
    fit: "4",
    tcx: "3",
    gpx: "1",
    kml: "2",
    csv: "0",
};

/** Sports, for `activity/query` `modeList` and the detail `sportType`. */
export type SportTypeKey =
    | "all"
    | "run"
    | "indoorRun"
    | "trailRun"
    | "trackRun"
    | "hike"
    | "mtnClimb"
    | "bike"
    | "indoorBike"
    | "roadEbike"
    | "gravelRoadBike"
    | "mountainRiding"
    | "mountainEbike"
    | "helmetBike"
    | "poolSwim"
    | "openWater"
    | "triathlon"
    | "strength"
    | "gymCardio"
    | "gpsCardio"
    | "ski"
    | "snowboard"
    | "xcSki"
    | "skiTouring"
    | "skiTouringOld"
    | "multiSport"
    | "speedsurfing"
    | "windsurfing"
    | "row"
    | "indoorRow"
    | "whitewater"
    | "flatwater"
    | "boatFishing"
    | "shoreFishing"
    | "kayakFishing"
    | "inshoreFishing"
    | "offshoreFishing"
    | "boatFlyFishing"
    | "shoreFlyFishing"
    | "multiPitch"
    | "climb"
    | "indoorClimb"
    | "bouldering"
    | "outdoorClimb"
    | "walk"
    | "jumpRope"
    | "climbStairs"
    | "elliptical"
    | "yoga"
    | "pilates"
    | "boxing"
    | "badminton"
    | "tableTennis"
    | "basketball"
    | "soccer"
    | "pickleball"
    | "tennis"
    | "padel"
    | "frisbee"
    | "skateboard"
    | "hybridFitness"
    | "customSport";

export const SPORT_TYPE_API_VALUES: Record<SportTypeKey, string> = {
    all: "0",
    run: "100",
    indoorRun: "101",
    trailRun: "102",
    trackRun: "103",
    hike: "104",
    mtnClimb: "105",
    bike: "200",
    indoorBike: "201",
    roadEbike: "202",
    gravelRoadBike: "203",
    mountainRiding: "204",
    mountainEbike: "205",
    helmetBike: "299",
    poolSwim: "300",
    openWater: "301",
    triathlon: "10000",
    strength: "402",
    gymCardio: "400",
    gpsCardio: "401",
    ski: "500",
    snowboard: "501",
    xcSki: "502",
    skiTouring: "503",
    skiTouringOld: "10002",
    multiSport: "10001",
    speedsurfing: "706",
    windsurfing: "705",
    row: "700",
    indoorRow: "701",
    whitewater: "702",
    flatwater: "704",
    // Fishing modes. 709 is unused by the web app.
    boatFishing: "707",
    shoreFishing: "708",
    kayakFishing: "710",
    inshoreFishing: "711",
    offshoreFishing: "712",
    boatFlyFishing: "713",
    shoreFlyFishing: "714",
    multiPitch: "10003",
    climb: "106",
    indoorClimb: "800",
    bouldering: "801",
    /** Shares the "Outdoor Climb" label with {@link multiPitch} (10003). */
    outdoorClimb: "802",
    walk: "900",
    jumpRope: "901",
    climbStairs: "902",
    elliptical: "903",
    yoga: "904",
    pilates: "905",
    boxing: "906",
    badminton: "1000",
    tableTennis: "1001",
    basketball: "1002",
    soccer: "1003",
    pickleball: "1004",
    tennis: "1005",
    padel: "1006",
    frisbee: "1100",
    skateboard: "1101",
    hybridFitness: "1200",
    customSport: "98",
};

/** Reverse lookup; activity list items carry the numeric value. */
export const SPORT_TYPE_BY_VALUE: Record<string, SportTypeKey> = Object.fromEntries(
    Object.entries(SPORT_TYPE_API_VALUES).map(([key, value]) => [value, key as SportTypeKey]),
) as Record<string, SportTypeKey>;

/** Returns `undefined` for values not in the map; COROS adds sports over time. */
export function sportTypeName(value: number | string): SportTypeKey | undefined {
    return SPORT_TYPE_BY_VALUE[String(value)];
}

/** The five-point scale stored as `sportFeelInfo.feelType`. */
export type PerceivedExertionKey = "veryLight" | "light" | "moderate" | "hard" | "maxEffort";

/** 1-based, so `0` means unrated rather than the lowest rating. */
export const PERCEIVED_EXERTION_BY_VALUE: Record<number, PerceivedExertionKey> = {
    1: "veryLight",
    2: "light",
    3: "moderate",
    4: "hard",
    5: "maxEffort",
};

/** Labels as the app words them. */
export const PERCEIVED_EXERTION_LABELS: Record<PerceivedExertionKey, string> = {
    veryLight: "Very Light",
    light: "Light",
    moderate: "Moderate",
    hard: "Hard",
    maxEffort: "Max Effort",
};

/** Returns `undefined` for `0` (unrated) and anything off the scale. */
export function perceivedExertionName(feelType: number): PerceivedExertionKey | undefined {
    return PERCEIVED_EXERTION_BY_VALUE[feelType];
}

/** Default sport type for detail/download when not specified (running). */
export const DEFAULT_SPORT_TYPE_VALUE = "100";

/** Maximum activities per page the API accepts; larger values error out. */
export const MAX_PAGE_SIZE = 200;
