import { describe, expect, it, vi } from "vitest";
import {
    BASE_URL_BY_REGION,
    buildAliyunOssStringToSign,
    contentMd5Base64,
    CorosClient,
    createZipBuffer,
    normalizeStsCredentials,
    OBJECT_STORAGE_CONFIG_BY_REGION,
    regionFromId,
    STS_CONFIG_BY_REGION,
    toApiTimezone,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Aliyun OSS V1", () => {
    it("canonicalizes the temporary security token header", () => {
        const actual = buildAliyunOssStringToSign({
            contentMd5: "XUFAKrxLKna5cZ2REBfFkg==",
            date: "Tue, 27 Mar 2007 19:36:42 GMT",
            securityToken: "token-value",
            bucket: "coros-oss",
            key: "fit_zip/user/hash.zip",
        });
        expect(actual).toBe(
            "PUT\n" +
                "XUFAKrxLKna5cZ2REBfFkg==\n" +
                "application/zip\n" +
                "Tue, 27 Mar 2007 19:36:42 GMT\n" +
                "x-oss-security-token:token-value\n" +
                "/coros-oss/fit_zip/user/hash.zip",
        );
    });

    it("uses base64 of the raw MD5 digest", () => {
        expect(contentMd5Base64(encoder.encode("hello"))).toBe("XUFAKrxLKna5cZ2REBfFkg==");
    });
});

describe("STS credential normalization", () => {
    it("normalizes AWS field names", () => {
        expect(
            normalizeStsCredentials(
                {
                    AccessKeyId: "aws-id",
                    SecretAccessKey: "aws-secret",
                    SessionToken: "aws-token",
                    Region: "wrong-region",
                    Bucket: "wrong-bucket",
                },
                "en",
            ),
        ).toMatchObject({
            accessKeyId: "aws-id",
            secretAccessKey: "aws-secret",
            securityToken: "aws-token",
            region: "us-west-1",
            bucket: "coros-s3",
        });
    });

    it("normalizes Aliyun field names", () => {
        expect(
            normalizeStsCredentials(
                {
                    AccessKeyId: "ali-id",
                    AccessKeySecret: "ali-secret",
                    SecurityToken: "ali-token",
                },
                "cn",
            ),
        ).toMatchObject({
            accessKeyId: "ali-id",
            secretAccessKey: "ali-secret",
            securityToken: "ali-token",
            bucket: "coros-oss",
        });
    });
});

describe("region mapping", () => {
    it("maps login region ids to API and object storage", () => {
        expect(regionFromId(1)).toBe("en");
        expect(regionFromId("2")).toBe("cn");
        expect(regionFromId(3)).toBe("eu");
        expect(BASE_URL_BY_REGION).toEqual({
            en: "https://teamapi.coros.com",
            eu: "https://teameuapi.coros.com",
            cn: "https://teamcnapi.coros.com",
        });
        expect(OBJECT_STORAGE_CONFIG_BY_REGION.en).toMatchObject({
            bucket: "coros-s3",
            service: "aws",
            region: "us-west-1",
        });
        expect(OBJECT_STORAGE_CONFIG_BY_REGION.eu).toMatchObject({
            bucket: "eu-coros",
            service: "aws",
            region: "eu-central-1",
        });
        expect(OBJECT_STORAGE_CONFIG_BY_REGION.cn).toMatchObject({
            bucket: "coros-oss",
            service: "aliyun",
            endpoint: "https://oss-cn-beijing.aliyuncs.com",
        });
        expect(STS_CONFIG_BY_REGION.cn.sign).toBe("9AD4AA35AAFEE6BB1E847A76848D58DF");
    });
});

describe("timezone conversion", () => {
    it("uses quarter-hour units and accepts UTC+8", () => {
        class UtcPlusEightDate extends Date {
            override getTimezoneOffset(): number {
                return -480;
            }
        }
        expect(toApiTimezone(new UtcPlusEightDate())).toBe(32);
        expect(toApiTimezone(-14)).toBe(-14);
    });

    it("rejects fractional and out-of-range values", () => {
        expect(() => toApiTimezone(1.5)).toThrow(RangeError);
        expect(() => toApiTimezone(57)).toThrow(RangeError);
    });
});

describe("login region discovery", () => {
    it("probes the fixed CN login host when no region is configured", async () => {
        let loginUrl = "";
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
            loginUrl = String(input);
            return new Response(
                JSON.stringify({
                    result: "0000",
                    message: "OK",
                    data: { accessToken: "test-token", userId: "user", regionId: 1 },
                }),
                { headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;
        try {
            const client = new CorosClient({ email: "person@example.com", password: "password" });
            await client.login();
            expect(new URL(loginUrl).origin).toBe("https://teamcnapi.coros.com");
            expect(client.getRegion()).toBe("en");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("uses the server region and warns when it contradicts an explicit region", async () => {
        const requestedUrls: string[] = [];
        const originalFetch = globalThis.fetch;
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
            requestedUrls.push(String(input));
            if (String(input).includes("account/login")) {
                return new Response(
                    JSON.stringify({
                        result: "0000",
                        message: "OK",
                        data: { accessToken: "test-token", userId: "user", regionId: 2 },
                    }),
                    { headers: { "content-type": "application/json" } },
                );
            }
            return new Response(
                JSON.stringify({ result: "0000", message: "OK", data: { userId: "user" } }),
                { headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;

        try {
            const client = new CorosClient({ email: "person@example.com", password: "password" }, { region: "en" });
            await client.login();
            await client.getAccount();
            expect(client.getRegion()).toBe("cn");
            expect(new URL(requestedUrls[1]).origin).toBe("https://teamcnapi.coros.com");
            expect(warning).toHaveBeenCalledOnce();
        } finally {
            globalThis.fetch = originalFetch;
            warning.mockRestore();
        }
    });
});

describe("mainland-China upload flow", () => {
    it("uses Aliyun OSS and preserves an intermediate import status", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, init });
            if (url.includes("openapi/oss/sts")) {
                const credentials = btoa(
                    JSON.stringify({
                        AccessKeyId: "temporary-id",
                        AccessKeySecret: "temporary-secret",
                        SecurityToken: "temporary-token",
                    }),
                );
                return new Response(JSON.stringify({ code: 200, data: { credentials } }), {
                    headers: { "content-type": "application/json" },
                });
            }
            if (init?.method === "PUT") return new Response("", { status: 200 });
            return new Response(
                JSON.stringify({ result: "0000", message: "OK", data: { idString: "import-1", status: 1 } }),
                { headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;

        try {
            const client = new CorosClient(
                { email: "person@example.com", password: "password" },
                { region: "cn", accessToken: "test-token" },
            );
            const result = await client.uploadActivity(encoder.encode("fit data"), "activity.fit", "user-1", {
                timezone: 32,
            });
            expect(result).toMatchObject({ importId: "import-1", status: 1, success: false });
            expect(requests[1].url).toContain("https://coros-oss.oss-cn-beijing.aliyuncs.com/fit_zip/user-1/");
            expect(new Headers(requests[1].init?.headers).get("authorization")).toMatch(/^OSS temporary-id:/);

            const form = requests[2].init?.body as FormData;
            expect(JSON.parse(String(form.get("jsonParameter")))).toMatchObject({
                bucket: "coros-oss",
                serviceName: "aliyun",
                timezone: 32,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe("ZIP layout", () => {
    it("stores the activity at {md5}/{originalFilename}", () => {
        const zip = createZipBuffer(encoder.encode("fit"), "abc123/activity.fit", new Date("2025-01-01T00:00:00Z"));
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        const directoryNameLength = view.getUint16(26, true);
        expect(decoder.decode(zip.subarray(30, 30 + directoryNameLength))).toBe("abc123/");

        const fileHeader = 30 + directoryNameLength;
        const fileNameLength = view.getUint16(fileHeader + 26, true);
        expect(decoder.decode(zip.subarray(fileHeader + 30, fileHeader + 30 + fileNameLength))).toBe(
            "abc123/activity.fit",
        );
    });
});
