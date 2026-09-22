/**
 * Node.js port of @pinta365/coros, an unofficial COROS Training Hub API client.
 */

export { CorosClient } from "./client.ts";
export type { ActivityQueryOptions, ClientOptions, ResolvedSession } from "./client.ts";
export { ApiError, AuthError, HttpError } from "./errors.ts";
export { buildUrl } from "./http.ts";
export { formatYYYYMMDD } from "./date.ts";
export {
    dateFromDetailTimestamp,
    dateFromTimestamp,
    dateFromYYYYMMDD,
    DETAIL_SCALE,
    fromDetailScale,
    GPS_SCALE,
    gpsCoordinate,
    paceSecondsPerKm,
    timezoneOffsetMinutes,
    toApiTimezone,
    toKilocalories,
} from "./units.ts";
export {
    BASE_URL_BY_REGION,
    DEFAULT_BASE_URL,
    DEFAULT_UPLOAD_REGION,
    FAQ_API_URL,
    FILE_TYPE_API_VALUES,
    MAX_PAGE_SIZE,
    OBJECT_STORAGE_CONFIG_BY_REGION,
    PERCEIVED_EXERTION_BY_VALUE,
    PERCEIVED_EXERTION_LABELS,
    perceivedExertionName,
    regionFromId,
    SPORT_TYPE_API_VALUES,
    SPORT_TYPE_BY_VALUE,
    sportTypeName,
    STS_APP_ID,
    STS_CONFIG_BY_REGION,
    STS_SALT,
    STS_SIGN_CN,
    STS_SIGN_EN,
    STS_SIGN_EU,
} from "./constants.ts";
export type {
    ApiRegion,
    FileTypeKey,
    ObjectStorageConfig,
    PerceivedExertionKey,
    SportTypeKey,
    STSConfig,
} from "./constants.ts";
export type {
    AccountResponse,
    ActivityDetailData,
    ActivityDetailSummary,
    ActivityDownloadData,
    ActivityFrequencyPoint,
    ActivityLapGroup,
    ActivityLapItem,
    ActivityListData,
    ActivityListItem,
    ActivitySportFeelInfo,
    ActivityUploadData,
    AnalyseData,
    AnalyseDay,
    AnalyseRecord,
    AnalyseSummaryInfo,
    AnalyseWeek,
    ApiResponse,
    ApiResponseBase,
    BucketCredentials,
    Credentials,
    DistributionBucket,
    ImportJobItem,
    LoginData,
    LoginResponse,
    PrivateProfileData,
    RawBucketCredentials,
    RecordPeriod,
    RecordSeries,
    TrainingProgram,
    TrainingScheduleData,
    TrainingWeekStage,
    TrainSum,
    UploadActivityOptions,
    UploadActivityResult,
    User,
    ZoneBand,
} from "./types/index.ts";
export { isSuccessResponse, SUCCESS_RESULT } from "./types/index.ts";
export { getStsCredentials, normalizeStsCredentials } from "./api/upload.ts";
export type { AliyunOssStringToSignOptions } from "./api/oss-aliyun.ts";
export {
    aliyunOssPut,
    buildAliyunOssStringToSign,
    contentMd5Base64,
    OSS_CONTENT_TYPE,
    signAliyunOssV1,
} from "./api/oss-aliyun.ts";
export { createZipBuffer, crc32 } from "./zip.ts";
export { md5Base64, md5Bytes, md5Hex } from "./md5.ts";
