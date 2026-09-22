import { HttpError } from "../errors.ts";
import { md5Base64 } from "../md5.ts";
import type { BucketCredentials } from "../types/upload.ts";

export const OSS_CONTENT_TYPE = "application/zip";

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/** Base64 of the raw MD5 digest, not the hexadecimal digest. */
export function contentMd5Base64(body: Uint8Array): string {
    return md5Base64(body);
}

export interface AliyunOssStringToSignOptions {
    contentMd5: string;
    contentType?: string;
    date: string;
    securityToken: string;
    bucket: string;
    key: string;
}

/** Construct the exact OSS V1 canonical string used for a temporary-token PUT. */
export function buildAliyunOssStringToSign(options: AliyunOssStringToSignOptions): string {
    const contentType = options.contentType ?? OSS_CONTENT_TYPE;
    const canonicalizedOssHeaders = `x-oss-security-token:${options.securityToken.trim()}\n`;
    const canonicalizedResource = `/${options.bucket}/${options.key}`;
    return `PUT\n${options.contentMd5}\n${contentType}\n${options.date}\n${canonicalizedOssHeaders}${canonicalizedResource}`;
}

/** Sign an OSS V1 string with HMAC-SHA1 and return base64. */
export async function signAliyunOssV1(secretAccessKey: string, stringToSign: string): Promise<string> {
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secretAccessKey),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"],
    );
    const signature = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
    return bytesToBase64(new Uint8Array(signature));
}

/** Upload one small activity ZIP with Aliyun OSS V1 authentication. */
export async function aliyunOssPut(
    credentials: BucketCredentials,
    endpoint: string,
    key: string,
    body: Uint8Array,
    timeoutMs?: number,
    now: Date = new Date(),
): Promise<void> {
    const contentMd5 = contentMd5Base64(body);
    const date = now.toUTCString();
    const securityToken = credentials.securityToken.trim();
    const stringToSign = buildAliyunOssStringToSign({
        contentMd5,
        date,
        securityToken,
        bucket: credentials.bucket,
        key,
    });
    const signature = await signAliyunOssV1(credentials.secretAccessKey, stringToSign);
    const endpointUrl = new URL(endpoint);
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const url = `${endpointUrl.protocol}//${credentials.bucket}.${endpointUrl.host}/${encodedKey}`;
    const controller = new AbortController();
    const timeoutId = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `OSS ${credentials.accessKeyId}:${signature}`,
                "Content-MD5": contentMd5,
                "Content-Type": OSS_CONTENT_TYPE,
                Date: date,
                "x-oss-security-token": securityToken,
            },
            body: toArrayBuffer(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const xml = await response.text();
            throw new HttpError(`Aliyun OSS PUT failed: HTTP ${response.status}: ${xml}`, {
                status: response.status,
                url,
                bodyText: xml,
            });
        }
    } catch (cause) {
        if (cause instanceof HttpError) throw cause;
        if (controller.signal.aborted) {
            throw new HttpError(`Aliyun OSS PUT timed out after ${timeoutMs}ms`, { status: 0, url, cause });
        }
        throw new HttpError(`Aliyun OSS PUT failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
            status: 0,
            url,
            cause,
        });
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
}
