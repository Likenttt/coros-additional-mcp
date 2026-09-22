/** The API answered with a `result` other than `0000`. */
export class ApiError extends Error {
    readonly result: string;
    readonly apiCode?: string;
    readonly tlogId?: string;

    constructor(
        message: string,
        options: {
            result: string;
            apiCode?: string;
            tlogId?: string;
            cause?: unknown;
        },
    ) {
        super(message, { cause: options.cause });
        this.name = "ApiError";
        this.result = options.result;
        this.apiCode = options.apiCode;
        this.tlogId = options.tlogId;
    }
}

/** No token is set and the operation requires one. */
export class AuthError extends Error {
    constructor(message = "Not authenticated. Call login() first.") {
        super(message);
        this.name = "AuthError";
    }
}

/**
 * Transport-level failures: non-2xx responses carrying no API envelope,
 * non-JSON bodies (rate-limit or gateway HTML), and timeouts.
 *
 * Distinct from {@link ApiError}, where the API answered with a non-`0000`
 * result.
 */
export class HttpError extends Error {
    /** HTTP status code, or 0 for a timeout / network failure. */
    readonly status: number;
    readonly url: string;
    /** First 500 characters of the response body, when there was one. */
    readonly bodyText?: string;

    constructor(
        message: string,
        options: {
            status: number;
            url: string;
            bodyText?: string;
            cause?: unknown;
        },
    ) {
        super(message, { cause: options.cause });
        this.name = "HttpError";
        this.status = options.status;
        this.url = options.url;
        this.bodyText = options.bodyText;
    }

    /** True when the API is rate-limiting; back off and reuse a cached token. */
    get isRateLimited(): boolean {
        return this.status === 429;
    }
}
