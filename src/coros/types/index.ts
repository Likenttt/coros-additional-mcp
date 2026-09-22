export type { ApiErrorPayload, ApiResponse, ApiResponseBase } from "./common.ts";
export { isSuccessResponse, SUCCESS_RESULT } from "./common.ts";
export type { AccountResponse, Credentials, LoginData, LoginResponse, User } from "./auth.ts";
export type {
    ActivityDetailData,
    ActivityDetailSummary,
    ActivityDownloadData,
    ActivityFrequencyPoint,
    ActivityLapGroup,
    ActivityLapItem,
    ActivityListData,
    ActivityListItem,
    ActivitySportFeelInfo,
} from "./activity.ts";
export type { TrainingProgram, TrainingScheduleData, TrainingWeekStage, TrainSum } from "./training.ts";
export type {
    AnalyseData,
    AnalyseDay,
    AnalyseRecord,
    AnalyseSummaryInfo,
    AnalyseWeek,
    DistributionBucket,
    PrivateProfileData,
    RecordPeriod,
    RecordSeries,
    ZoneBand,
} from "./analyse.ts";
export type {
    ActivityUploadData,
    BucketCredentials,
    ImportJobItem,
    RawBucketCredentials,
    UploadActivityOptions,
    UploadActivityResult,
} from "./upload.ts";
