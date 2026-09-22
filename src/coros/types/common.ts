/**
 * Common API response shape for COROS Team API.
 * Success when result === '0000'; payload in data.
 */
export interface ApiResponseBase {
    result: string;
    message: string;
    apiCode?: string;
}

export interface ApiResponse<T> extends ApiResponseBase {
    result: "0000";
    data: T;
}

export interface ApiErrorPayload extends ApiResponseBase {
    result: string;
    tlogId?: string;
}

export const SUCCESS_RESULT = "0000" as const;

export function isSuccessResponse(
    body: ApiResponseBase & { data?: unknown },
): body is ApiResponse<unknown> {
    return body.result === SUCCESS_RESULT && "data" in body;
}
