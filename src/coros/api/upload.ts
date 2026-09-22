import { AuthError, HttpError } from "../errors.ts";
import { buildUrl, postForm, postJson, postJsonVoid } from "../http.ts";
import {
    FAQ_API_URL,
    OBJECT_STORAGE_CONFIG_BY_REGION,
    STS_APP_ID,
    STS_CONFIG_BY_REGION,
    STS_SALT,
} from "../constants.ts";
import type { ApiRegion } from "../constants.ts";
import type {
    ActivityUploadData,
    BucketCredentials,
    ImportJobItem,
    RawBucketCredentials,
} from "../types/upload.ts";
import type { RequestOptions } from "../http.ts";

/** Copy a view into a standalone ArrayBuffer, which `fetch` and `crypto.subtle` require. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** `faq.coros.com` uses `{code, msg, data}`, not the Training Hub's `{result, message, data}`. */
interface StsEnvelope {
    code?: number;
    msg?: string;
    data?: { credentials?: string; v?: string };
}

/** Normalize the different field names returned by AWS and Aliyun STS. */
export function normalizeStsCredentials(
    raw: RawBucketCredentials,
    region: ApiRegion,
): BucketCredentials {
    const storage = OBJECT_STORAGE_CONFIG_BY_REGION[region];
    const accessKeyId = raw.AccessKeyId;
    const secretAccessKey = raw.SecretAccessKey ?? raw.AccessKeySecret;
    const securityToken = raw.SessionToken ?? raw.SecurityToken;
    if (!accessKeyId || !secretAccessKey || !securityToken) {
        throw new TypeError(`STS credentials for ${region} are missing access key or security token fields`);
    }
    return {
        accessKeyId,
        secretAccessKey,
        securityToken,
        expiration: raw.Expiration,
        tokenExpireTime: raw.TokenExpireTime,
        region: storage.region ?? raw.Region,
        bucket: storage.bucket,
        sessionName: raw.SessionName,
    };
}

/**
 * Fetch temporary credentials for `region`'s AWS S3 or Aliyun OSS bucket.
 * Must use the account's own region because the import backend owns that bucket.
 */
export async function getStsCredentials(region: ApiRegion, timeoutMs?: number): Promise<BucketCredentials> {
    const config = STS_CONFIG_BY_REGION[region];
    const url = buildUrl(FAQ_API_URL, "openapi/oss/sts", {
        bucket: config.bucket,
        service: config.service,
        v: "2",
        app_id: STS_APP_ID,
        sign: config.sign,
    });

    const controller = new AbortController();
    const timeoutId = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let res: Response;
    let text: string;
    try {
        res = await fetch(url, { signal: controller.signal });
        text = await res.text();
    } catch (cause) {
        if (controller.signal.aborted) throw new HttpError(`STS request timed out after ${timeoutMs}ms`, { status: 0, url, cause });
        throw new HttpError(`STS request failed: ${cause instanceof Error ? cause.message : String(cause)}`, { status: 0, url, cause });
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    let body: StsEnvelope;
    try {
        body = JSON.parse(text) as StsEnvelope;
    } catch (cause) {
        throw new HttpError(`STS returned a non-JSON response (HTTP ${res.status})`, {
            status: res.status,
            url,
            bodyText: text.slice(0, 500),
            cause,
        });
    }

    if (body.code !== 200 || !body.data?.credentials) {
        throw new HttpError(`STS failed: ${body.msg ?? "unknown error"} (code ${body.code ?? res.status})`, {
            status: res.status,
            url,
            bodyText: text.slice(0, 500),
        });
    }

    const encoded = body.data.credentials.replace(STS_SALT, "");
    let raw: RawBucketCredentials;
    try {
        raw = JSON.parse(atob(encoded)) as RawBucketCredentials;
    } catch (cause) {
        throw new HttpError("STS credentials could not be decoded", {
            status: res.status,
            url,
            bodyText: text.slice(0, 500),
            cause,
        });
    }
    return normalizeStsCredentials(raw, region);
}

const S3_CONTENT_TYPE = "application/zip";

/**
 * Upload a buffer to S3 with SigV4.
 *
 * `content-length` must not be signed: it is a forbidden header name, so the
 * runtime strips and regenerates it. `host` is signed, as SigV4 requires, but
 * not set explicitly — the runtime derives it from the URL.
 */
export async function s3Put(
    credentials: BucketCredentials,
    key: string,
    body: Uint8Array,
): Promise<void> {
    if (!credentials.region) throw new TypeError("AWS credentials are missing a signing region");
    const host = `${credentials.bucket}.s3.${credentials.region}.amazonaws.com`;
    const pathEncoded = key.split("/").map(encodeURIComponent).join("/");
    const url = `https://${host}/${pathEncoded}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const payloadHash = await sha256Hex(body);
    const headers: Record<string, string> = {
        "Content-Type": S3_CONTENT_TYPE,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": date,
        "x-amz-security-token": credentials.securityToken,
    };
    const signed = await signAwsS3Put(credentials, credentials.region, host, key, payloadHash, date);
    const res = await fetch(url, {
        method: "PUT",
        headers: { ...headers, ...signed },
        body: toArrayBuffer(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`S3 PUT failed: ${res.status} ${text}`);
    }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(data));
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function signAwsS3Put(
    creds: BucketCredentials,
    region: string,
    host: string,
    key: string,
    payloadHash: string,
    amzDate: string,
): Promise<Record<string, string>> {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    // Signed headers must be lowercase and sorted; canonical headers in the same order.
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
    const canonicalHeaders = `content-type:${S3_CONTENT_TYPE}\n` +
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n` +
        `x-amz-security-token:${creds.securityToken}\n`;
    const canonicalRequest = [
        "PUT",
        `/${encodedKey}`,
        "",
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join("\n");
    const credentialScope = `${amzDate.slice(0, 8)}/${region}/s3/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");
    const kDate = await hmacSha256(`AWS4${creds.secretAccessKey}`, amzDate.slice(0, 8));
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, "s3");
    const kSigning = await hmacSha256(kService, "aws4_request");
    const signature = await hmacSha256Hex(kSigning, stringToSign);
    const auth = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { Authorization: auth };
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
    const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key);
    const dataBytes = new TextEncoder().encode(data);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return globalThis.crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
    const sig = await hmacSha256(key, data);
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * POST activity/fit/getImportSportList — list import jobs.
 */
export async function getImportList(
    options: RequestOptions,
    size = 10,
): Promise<ImportJobItem[]> {
    if (!options.accessToken) throw new AuthError();
    const url = buildUrl(options.baseUrl, "activity/fit/getImportSportList");
    const data = await postJson<ImportJobItem[]>(url, { size }, options);
    return Array.isArray(data) ? data : [];
}

/**
 * POST activity/fit/deleteSportImport — remove item from import list.
 * Answers with a bare envelope and no `data` field.
 */
export async function deleteSportImport(
    options: RequestOptions,
    importId: string,
): Promise<void> {
    if (!options.accessToken) throw new AuthError();
    const url = buildUrl(options.baseUrl, "activity/fit/deleteSportImport");
    await postJsonVoid(url, { importId }, options);
}

/**
 * POST activity/fit/import — register uploaded file (multipart with jsonParameter).
 */
export async function postActivityImport(
    options: RequestOptions,
    body: {
        source: number;
        timezone: number;
        bucket: string;
        md5: string;
        size: number;
        object: string;
        serviceName: string;
        oriFileName: string;
    },
): Promise<ActivityUploadData> {
    if (!options.accessToken) throw new AuthError();
    const url = buildUrl(options.baseUrl, "activity/fit/import");
    const formData = new FormData();
    formData.append("jsonParameter", JSON.stringify(body));
    return await postForm<ActivityUploadData>(url, formData, {
        ...options,
        timeoutMs: options.timeoutMs ?? 60_000,
    });
}
