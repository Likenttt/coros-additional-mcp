import { AuthError } from "../errors.ts";
import { buildUrl, getJson } from "../http.ts";
import { formatYYYYMMDD } from "../date.ts";
import type { RequestOptions } from "../http.ts";
import type { AnalyseData, PrivateProfileData } from "../types/analyse.ts";

/**
 * GET analyse/query — EvoLab metrics for a date range.
 *
 * GET only; POST answers `1001 Service exceptions`. Takes `startDay`/`endDay`,
 * not the `startDate`/`endDate` the training schedule uses.
 */
export async function getAnalyse(
    options: RequestOptions,
    params: { startDate: Date; endDate: Date },
): Promise<AnalyseData> {
    if (!options.accessToken) throw new AuthError();
    const url = buildUrl(options.baseUrl, "analyse/query", {
        startDay: formatYYYYMMDD(params.startDate),
        endDay: formatYYYYMMDD(params.endDate),
    });
    return await getJson<AnalyseData>(url, options);
}

/**
 * GET profile/private/query — Training Hub dashboard layout preferences.
 * Also GET-only, for the same reason as `analyse/query`.
 */
export async function getPrivateProfile(options: RequestOptions): Promise<PrivateProfileData> {
    if (!options.accessToken) throw new AuthError();
    return await getJson<PrivateProfileData>(buildUrl(options.baseUrl, "profile/private/query"), options);
}
