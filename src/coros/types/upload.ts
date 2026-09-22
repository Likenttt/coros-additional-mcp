/** Normalized STS credentials used by both AWS S3 and Aliyun OSS. */
export interface BucketCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    securityToken: string;
    expiration?: string;
    tokenExpireTime?: number;
    region?: string;
    bucket: string;
    sessionName?: string;
}

/** Raw credential fields returned after decoding the salted STS payload. */
export interface RawBucketCredentials {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    SessionToken?: string;
    AccessKeySecret?: string;
    SecurityToken?: string;
    Expiration?: string;
    TokenExpireTime?: number;
    Region?: string;
    Bucket?: string;
    SessionName?: string;
}

/**
 * Single import job item from getImportSportList.
 */
export interface ImportJobItem {
    createTime: string;
    errorSize?: number;
    fileUrl: string;
    finishSize: number;
    id: string;
    idString: string;
    md5: string;
    originalFilename: string;
    size: number;
    source: number;
    status: number;
    taskImportPredicateSeconds?: number;
    taskImportRemainSeconds?: number;
    timezone: number;
    unzipPredicateSeconds?: number;
    updateTime: string;
    userId: string;
}

/**
 * Activity upload response data from activity/fit/import.
 */
export interface ActivityUploadData {
    createTime?: string;
    errorSize?: number;
    fileUrl?: string;
    finishSize?: number;
    id?: string;
    idString?: string;
    md5?: string;
    originalFilename?: string;
    size?: number;
    source?: number;
    status: number;
    taskImportPredicateSeconds?: number;
    taskImportRemainSeconds?: number;
    timezone?: number;
    unzipPredicateSeconds?: number;
    updateTime?: string;
    userId?: string;
}

/** Result of registering an uploaded archive with COROS. */
export interface UploadActivityResult {
    /** The import-list identifier, when returned by the private API. */
    importId?: string;
    /** Raw import status. Values other than 2 may represent an in-progress job. */
    status: number;
    /** Matches the legacy client's completed-success rule (`status === 2`). */
    success: boolean;
    /** Unmodified response data for forward compatibility. */
    data: ActivityUploadData;
}

export interface UploadActivityOptions {
    /** Quarter-hour units east of UTC. Defaults to the local machine offset. */
    timezone?: number;
    /** Override the basename sent to COROS when uploading from a file path. */
    originalFilename?: string;
}
