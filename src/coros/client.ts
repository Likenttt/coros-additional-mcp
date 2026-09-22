import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ApiError, AuthError, HttpError } from "./errors.ts";
import { buildUrl, fetchBytes, getJson, getVoid, postJson } from "./http.ts";
import { login as doLogin } from "./auth.ts";
import { getAccount } from "./api/account.ts";
import { getTrainingSchedule as getTrainingScheduleApi } from "./api/training.ts";
import { getAnalyse as getAnalyseApi, getPrivateProfile as getPrivateProfileApi } from "./api/analyse.ts";
import {
    deleteSportImport as deleteSportImportApi,
    getImportList as getImportListApi,
    getStsCredentials,
    postActivityImport,
    s3Put,
} from "./api/upload.ts";
import { aliyunOssPut } from "./api/oss-aliyun.ts";
import { createZipBuffer } from "./zip.ts";
import { md5Hex } from "./md5.ts";
import { formatYYYYMMDD } from "./date.ts";
import { toApiTimezone } from "./units.ts";
import { loadTokenFromFile as loadTokenFromFileFs, saveTokenToFile as saveTokenToFileFs } from "./token-storage.ts";
import {
    type ApiRegion,
    BASE_URL_BY_REGION,
    DEFAULT_BASE_URL,
    DEFAULT_SPORT_TYPE_VALUE,
    DEFAULT_UPLOAD_REGION,
    FILE_TYPE_API_VALUES,
    type FileTypeKey,
    MAX_PAGE_SIZE,
    OBJECT_STORAGE_CONFIG_BY_REGION,
    regionFromId,
    SPORT_TYPE_API_VALUES,
    type SportTypeKey,
} from "./constants.ts";
import type { Credentials, User } from "./types/auth.ts";
import type { ActivityDetailData, ActivityDownloadData, ActivityListData, ActivityListItem } from "./types/activity.ts";
import type { ImportJobItem, UploadActivityOptions, UploadActivityResult } from "./types/upload.ts";
import type { AnalyseData, PrivateProfileData } from "./types/analyse.ts";
import type { TrainingScheduleData } from "./types/training.ts";

/** Filter and pagination options for the activity list. */
export interface ActivityQueryOptions {
    /** 1-based page number. */
    page?: number;
    /** Activities per page, 1..200. */
    size?: number;
    /** Inclusive start of the date range (local date). */
    from?: Date;
    /** Inclusive end of the date range (local date). */
    to?: Date;
    /**
     * Restrict to these sports. Accepts sport keys, or a raw comma-separated
     * string of API values if you need a sport this library does not name yet.
     */
    modeList?: SportTypeKey[] | string;
}

/** Turn sport keys into the comma-separated API values `modeList` expects. */
function resolveModeList(modeList: SportTypeKey[] | string | undefined): string | undefined {
    if (modeList === undefined) return undefined;
    if (typeof modeList === "string") return modeList;
    if (modeList.length === 0) return undefined;
    return modeList.map((key) => SPORT_TYPE_API_VALUES[key]).join(",");
}

export interface ClientOptions {
    /** Explicit API base URL used until login discovers the account region. */
    baseUrl?: string;
    /** Region to derive baseUrl from (ignored if baseUrl is set). */
    region?: ApiRegion;
    /**
     * Region for upload/STS. Defaults to `region`; the backend only imports
     * objects from its own region's bucket.
     */
    uploadRegion?: ApiRegion;
    /** Pre-set access token (skip login if valid). */
    accessToken?: string;
    /** Request timeout in ms. */
    requestTimeoutMs?: number;
}

/**
 * CorosClient — unofficial Node.js client for the COROS Training Hub API.
 */
export interface ResolvedSession {
    userId: string;
    regionId: number;
    region: ApiRegion;
}

export class CorosClient {
    private readonly credentials: Credentials | undefined;
    private baseUrl: string;
    private uploadRegion: ApiRegion;
    private readonly configuredRegion: ApiRegion | undefined;
    private readonly configuredUploadRegion: ApiRegion | undefined;
    private readonly useDiscoveryLoginHost: boolean;
    private readonly requestTimeoutMs: number | undefined;
    private _accessToken: string | undefined;

    constructor(credentials?: Credentials, options: ClientOptions = {}) {
        this.credentials = credentials;
        this.configuredRegion = options.region;
        this.configuredUploadRegion = options.uploadRegion;
        this.useDiscoveryLoginHost = options.baseUrl === undefined && options.region === undefined;
        this.baseUrl = options.baseUrl ??
            (options.region ? BASE_URL_BY_REGION[options.region] : DEFAULT_BASE_URL);
        this.uploadRegion = options.uploadRegion ?? options.region ?? DEFAULT_UPLOAD_REGION;
        this._accessToken = options.accessToken;
        this.requestTimeoutMs = options.requestTimeoutMs;
    }

    private get requestOptions() {
        return {
            baseUrl: this.baseUrl,
            accessToken: this._accessToken,
            timeoutMs: this.requestTimeoutMs,
        };
    }

    /** Get current access token (may be undefined until login). */
    getAccessToken(): string | undefined {
        return this._accessToken;
    }

    /** Set access token (e.g. after loading from file or storage). */
    setAccessToken(token: string | undefined): void {
        this._accessToken = token;
    }

    /**
     * Log in and store the token on the client for subsequent requests.
     */
    async login(): Promise<User & { accessToken: string }> {
        if (!this.credentials) {
            throw new AuthError(
                "Password login is not configured. Run `coros-auth import-token` to save a browser session.",
            );
        }
        // With no configured region, use the fixed CN host as a reverse-engineered
        // discovery endpoint. regionId in the response remains authoritative.
        const loginOptions = this.useDiscoveryLoginHost
            ? { ...this.requestOptions, baseUrl: BASE_URL_BY_REGION.cn }
            : this.requestOptions;
        const data = await doLogin(this.credentials, loginOptions);
        this._accessToken = data.accessToken;

        if (data.regionId !== undefined) {
            const serverRegion = regionFromId(data.regionId as number | string);
            const conflicts = [this.configuredRegion, this.configuredUploadRegion]
                .filter((region): region is ApiRegion => region !== undefined && region !== serverRegion);
            if (conflicts.length > 0) {
                console.warn(
                    `COROS login reported region "${serverRegion}"; overriding configured region "${conflicts[0]}".`,
                );
            }
            this.baseUrl = BASE_URL_BY_REGION[serverRegion];
            this.uploadRegion = serverRegion;
        }

        const { accessToken, ...user } = data;
        return { ...user, accessToken } as User & { accessToken: string };
    }

    /**
     * Validate a pre-set browser session token and adopt the account's region.
     * This never falls back to password login when the token is rejected.
     */
    async resolveSession(): Promise<ResolvedSession> {
        if (!this._accessToken) {
            throw new AuthError(
                "No COROS session token is configured. Run `coros-auth import-token`.",
            );
        }

        let account: User;
        try {
            account = await getAccount(this.requestOptions);
        } catch (error) {
            if (error instanceof AuthError || error instanceof ApiError) throw invalidSessionError();
            if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
                throw invalidSessionError();
            }
            throw error;
        }

        const rawRegionId = account.regionId;
        if ((typeof rawRegionId !== "number" && typeof rawRegionId !== "string") || !account.userId) {
            throw invalidSessionError();
        }
        let region: ApiRegion;
        try {
            region = regionFromId(rawRegionId);
        } catch {
            throw invalidSessionError();
        }
        this.baseUrl = BASE_URL_BY_REGION[region];
        this.uploadRegion = region;
        return { userId: String(account.userId), regionId: Number(rawRegionId), region };
    }

    /** Current API/storage region, updated from login or session validation. */
    getRegion(): ApiRegion {
        return this.uploadRegion;
    }

    /**
     * Get account/profile. Requires prior login (or setAccessToken).
     */
    async getAccount(): Promise<User> {
        if (!this._accessToken) throw new AuthError();
        return await getAccount(this.requestOptions);
    }

    /**
     * List one page of activities, with optional date range and sport filter.
     * `endDay` is derived from `to`, not `from`.
     */
    async getActivities(options: ActivityQueryOptions = {}): Promise<ActivityListData> {
        if (!this._accessToken) throw new AuthError();
        const { page = 1, size = 20, from, to, modeList } = options;
        if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
            throw new RangeError(`size must be an integer between 1 and ${MAX_PAGE_SIZE}, got ${size}`);
        }
        if (!Number.isInteger(page) || page < 1) {
            throw new RangeError(`page must be an integer >= 1, got ${page}`);
        }
        const params: Record<string, string | number> = {
            pageNumber: page,
            size,
        };
        if (from) params.startDay = formatYYYYMMDD(from);
        if (to) params.endDay = formatYYYYMMDD(to);
        const modes = resolveModeList(modeList);
        if (modes !== undefined) params.modeList = modes;
        const url = buildUrl(this.baseUrl, "activity/query", params);
        return await getJson<ActivityListData>(url, this.requestOptions);
    }

    /**
     * Every activity matching the filter, following pagination to the last
     * page. Defaults to the maximum page size; the API rate-limits.
     */
    async getAllActivities(options: Omit<ActivityQueryOptions, "page"> = {}): Promise<ActivityListItem[]> {
        const size = options.size ?? MAX_PAGE_SIZE;
        const activities: ActivityListItem[] = [];
        let page = 1;
        // Stop on a short or empty page, so a wrong totalPage cannot spin forever.
        for (;;) {
            const data = await this.getActivities({ ...options, page, size });
            const batch = data.dataList ?? [];
            activities.push(...batch);
            const totalPage = data.totalPage ?? 0;
            if (batch.length === 0 || page >= totalPage) break;
            page += 1;
        }
        return activities;
    }

    /**
     * Get activity detail by labelId. sportType defaults to 100 (running).
     */
    async getActivityDetail(
        labelId: string,
        sportType: number | string = DEFAULT_SPORT_TYPE_VALUE,
    ): Promise<ActivityDetailData> {
        if (!this._accessToken) throw new AuthError();
        const url = buildUrl(this.baseUrl, "activity/detail/query", {
            labelId,
            sportType: String(sportType),
        });
        return await postJson<ActivityDetailData>(url, {}, this.requestOptions);
    }

    /**
     * Get download URL for activity file (FIT, TCX, GPX, etc.).
     */
    async getActivityDownloadUrl(
        labelId: string,
        fileType: FileTypeKey,
        sportType: number | string = DEFAULT_SPORT_TYPE_VALUE,
    ): Promise<string> {
        if (!this._accessToken) throw new AuthError();
        const fileTypeValue = FILE_TYPE_API_VALUES[fileType];
        const url = buildUrl(this.baseUrl, "activity/detail/download", {
            labelId,
            sportType: String(sportType),
            fileType: fileTypeValue,
        });
        const data = await postJson<ActivityDownloadData>(url, {}, this.requestOptions);
        return data.fileUrl;
    }

    /**
     * Resolve the signed storage URL and fetch the bytes.
     *
     * `sportType` comes from the activity list item; the default suits runs only.
     */
    async downloadActivityFile(
        labelId: string,
        fileType: FileTypeKey,
        sportType: number | string = DEFAULT_SPORT_TYPE_VALUE,
    ): Promise<Uint8Array> {
        const fileUrl = await this.getActivityDownloadUrl(labelId, fileType, sportType);
        return await fetchBytes(fileUrl, this.requestTimeoutMs);
    }

    /**
     * Delete an activity. Succeeds whether or not the `labelId` existed.
     */
    async deleteActivity(labelId: string): Promise<void> {
        if (!this._accessToken) throw new AuthError();
        const url = buildUrl(this.baseUrl, "activity/delete", { labelId });
        await getVoid(url, this.requestOptions);
    }

    /**
     * Get training schedule for date range.
     */
    async getTrainingSchedule(options: {
        startDate: Date;
        endDate: Date;
        supportRestExercise?: number;
    }): Promise<TrainingScheduleData> {
        if (!this._accessToken) throw new AuthError();
        return await getTrainingScheduleApi(this.requestOptions, options);
    }

    /**
     * EvoLab analytics for a date range: daily training load, Base Fitness
     * (`t28d`), resting HR, HRV, fatigue and load-ratio zones, weekly records.
     *
     * `sportDataSummary.modelValidState` is false until the account has enough
     * activity for the model to produce meaningful numbers.
     */
    async getAnalyse(options: { startDate: Date; endDate: Date }): Promise<AnalyseData> {
        if (!this._accessToken) throw new AuthError();
        return await getAnalyseApi(this.requestOptions, options);
    }

    /**
     * Dashboard layout preferences — presentation, not training data.
     */
    async getPrivateProfile(): Promise<PrivateProfileData> {
        if (!this._accessToken) throw new AuthError();
        return await getPrivateProfileApi(this.requestOptions);
    }

    /** Upload FIT/TCX bytes. `userId` comes from login or `getAccount()`. */
    async uploadActivity(
        fileContent: Uint8Array,
        originalFilename: string,
        userId: string,
        options?: UploadActivityOptions,
    ): Promise<UploadActivityResult>;
    /** Read and upload a FIT/TCX file from disk. */
    async uploadActivity(
        filePath: string,
        userId: string,
        options?: UploadActivityOptions,
    ): Promise<UploadActivityResult>;
    async uploadActivity(
        input: Uint8Array | string,
        originalFilenameOrUserId: string,
        userIdOrOptions?: string | UploadActivityOptions,
        byteOptions: UploadActivityOptions = {},
    ): Promise<UploadActivityResult> {
        if (!this._accessToken) throw new AuthError();
        const fromFilePath = typeof input === "string";
        const options = fromFilePath
            ? (typeof userIdOrOptions === "object" ? userIdOrOptions : {})
            : byteOptions;
        const fileContent = fromFilePath ? new Uint8Array(await readFile(input)) : input;
        const originalFilename = fromFilePath
            ? options.originalFilename ?? basename(input)
            : originalFilenameOrUserId;
        const userId = fromFilePath
            ? originalFilenameOrUserId
            : typeof userIdOrOptions === "string"
            ? userIdOrOptions
            : undefined;
        if (!userId) throw new TypeError("userId is required for activity upload");
        const ext = originalFilename.split(".").pop()?.toLowerCase();
        if (ext !== "fit" && ext !== "tcx") {
            throw new Error("Only .fit or .tcx files are supported for upload");
        }
        const md5 = md5Hex(fileContent);
        const entryName = `${md5}/${originalFilename}`;
        const zipBuffer = createZipBuffer(fileContent, entryName);
        const credentials = await getStsCredentials(this.uploadRegion, this.requestTimeoutMs);
        const storage = OBJECT_STORAGE_CONFIG_BY_REGION[this.uploadRegion];
        const remoteKey = `fit_zip/${userId}/${md5}.zip`;
        if (storage.service === "aliyun") {
            await aliyunOssPut(credentials, storage.endpoint, remoteKey, zipBuffer, this.requestTimeoutMs);
        } else {
            await s3Put(credentials, remoteKey, zipBuffer);
        }
        const timezone = toApiTimezone(options.timezone);
        const data = await postActivityImport(this.requestOptions, {
            source: 1,
            timezone,
            bucket: storage.bucket,
            md5,
            size: zipBuffer.byteLength,
            object: remoteKey,
            serviceName: storage.service,
            oriFileName: originalFilename,
        });
        return {
            importId: data.idString ?? data.id,
            status: data.status,
            success: data.status === 2,
            data,
        };
    }

    /**
     * List import jobs (upload status).
     */
    async getImportList(size = 10): Promise<ImportJobItem[]> {
        if (!this._accessToken) throw new AuthError();
        return await getImportListApi(this.requestOptions, size);
    }

    /**
     * Remove item from import list by importId.
     */
    async removeFromImportList(importId: string): Promise<void> {
        if (!this._accessToken) throw new AuthError();
        await deleteSportImportApi(this.requestOptions, importId);
    }

    /**
     * Persist the access token for reuse. Server runtimes only.
     */
    async saveTokenToFile(filePath: string): Promise<void> {
        if (!this._accessToken) throw new AuthError();
        await saveTokenToFileFs(filePath, this._accessToken);
    }

    /**
     * Load a persisted token onto the client, instead of calling `login()`.
     * Server runtimes only.
     */
    async loadTokenFromFile(filePath: string): Promise<void> {
        const token = await loadTokenFromFileFs(filePath);
        this._accessToken = token;
    }
}

function invalidSessionError(): AuthError {
    return new AuthError(
        "COROS session token is invalid or expired. Run `coros-auth import-token` to bridge a new browser session.",
    );
}
