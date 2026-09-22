import { ApiError, HttpError } from "./errors.ts";
import { type ApiResponseBase, SUCCESS_RESULT } from "./types/common.ts";

export interface RequestOptions {
    baseUrl: string;
    accessToken?: string;
    timeoutMs?: number;
}

/**
 * Build URL with optional query params.
 *
 * `path` is resolved against the origin of `baseUrl`, so a leading slash is
 * optional and any path component on `baseUrl` is ignored.
 */
export function buildUrl(
    baseUrl: string,
    path: string,
    params?: Record<string, string | number | undefined>,
): string {
    const url = new URL(path.replace(/^\/+/, ""), new URL(baseUrl).origin + "/");
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== "") {
                url.searchParams.set(k, String(v));
            }
        }
    }
    return url.toString();
}

/** How the caller expects the API envelope's `data` field to be treated. */
type DataExpectation = "required" | "none";

interface CoreRequest {
    method: "GET" | "POST";
    /** Header name for the token. Most endpoints use `accessToken`; upload uses `AccessToken`. */
    tokenHeader?: string;
    body?: BodyInit;
    contentType?: string;
}

/**
 * Perform a request, unwrap the COROS API envelope, and surface failures as
 * typed errors.
 *
 * The body is read as text before parsing, so a non-JSON response (a 429 or a
 * gateway HTML page) becomes an {@link HttpError} rather than a `SyntaxError`.
 */
async function request<T>(
    url: string,
    options: RequestOptions,
    core: CoreRequest,
    expectation: DataExpectation,
): Promise<T> {
    const headers: Record<string, string> = {};
    if (core.contentType) headers["Content-Type"] = core.contentType;
    if (options.accessToken) headers[core.tokenHeader ?? "accessToken"] = options.accessToken;

    const controller = new AbortController();
    const timeoutId = options.timeoutMs !== undefined ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;

    let res: Response;
    let text: string;
    try {
        res = await fetch(url, {
            method: core.method,
            headers,
            body: core.body,
            signal: controller.signal,
        });
        text = await res.text();
    } catch (cause) {
        if (controller.signal.aborted) {
            throw new HttpError(`Request timed out after ${options.timeoutMs}ms`, { status: 0, url, cause });
        }
        throw new HttpError(`Network request failed: ${cause instanceof Error ? cause.message : String(cause)}`, { status: 0, url, cause });
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    let body: ApiResponseBase & { data?: T };
    try {
        body = JSON.parse(text) as ApiResponseBase & { data?: T };
    } catch (cause) {
        const contentType = res.headers.get("content-type") ?? "unknown";
        throw new HttpError(
            `Expected a JSON response but got ${contentType} (HTTP ${res.status})`,
            { status: res.status, url, bodyText: text.slice(0, 500), cause },
        );
    }

    if (typeof body?.result !== "string") {
        throw new HttpError(`Response is not a COROS API envelope (HTTP ${res.status})`, {
            status: res.status,
            url,
            bodyText: text.slice(0, 500),
        });
    }

    if (body.result !== SUCCESS_RESULT) {
        throw new ApiError(body.message ?? "Request failed", {
            result: body.result,
            apiCode: body.apiCode,
            tlogId: "tlogId" in body ? (body as { tlogId?: string }).tlogId : undefined,
        });
    }

    if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} with a success result code`, {
            status: res.status,
            url,
            bodyText: text.slice(0, 500),
        });
    }

    if (expectation === "none") return undefined as T;

    if (!("data" in body)) {
        throw new ApiError("Response missing data", { result: body.result });
    }
    return body.data as T;
}

/** GET, returning the envelope's `data`. */
export function getJson<T>(url: string, options: RequestOptions): Promise<T> {
    return request<T>(url, options, { method: "GET", contentType: "application/json" }, "required");
}

/**
 * GET for endpoints that answer with a bare `{result, message, apiCode}` and no
 * `data` field (for example `activity/delete`).
 */
export function getVoid(url: string, options: RequestOptions): Promise<void> {
    return request<void>(url, options, { method: "GET", contentType: "application/json" }, "none");
}

/** POST a JSON body, returning the envelope's `data`. */
export function postJson<T>(url: string, body: unknown, options: RequestOptions): Promise<T> {
    return request<T>(
        url,
        options,
        { method: "POST", contentType: "application/json", body: JSON.stringify(body) },
        "required",
    );
}

/**
 * POST a JSON body to an endpoint that answers with no `data` field (for
 * example `activity/fit/deleteSportImport`).
 */
export function postJsonVoid(url: string, body: unknown, options: RequestOptions): Promise<void> {
    return request<void>(
        url,
        options,
        { method: "POST", contentType: "application/json", body: JSON.stringify(body) },
        "none",
    );
}

/**
 * POST FormData (upload). Content-Type is left unset so the runtime supplies
 * the multipart boundary. This endpoint expects the token in `AccessToken`.
 */
export function postForm<T>(url: string, formData: FormData, options: RequestOptions): Promise<T> {
    return request<T>(url, options, { method: "POST", tokenHeader: "AccessToken", body: formData }, "required");
}

/**
 * Fetch raw bytes from an arbitrary URL (activity file downloads, which are
 * served from signed storage URLs rather than the API).
 */
export async function fetchBytes(url: string, timeoutMs?: number): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeoutId = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new HttpError(`Download failed: HTTP ${res.status}`, { status: res.status, url });
        }
        return new Uint8Array(await res.arrayBuffer());
    } catch (cause) {
        if (cause instanceof HttpError) throw cause;
        if (controller.signal.aborted) {
            throw new HttpError(`Download timed out after ${timeoutMs}ms`, { status: 0, url, cause });
        }
        throw new HttpError(`Download failed: ${cause instanceof Error ? cause.message : String(cause)}`, { status: 0, url, cause });
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
}
