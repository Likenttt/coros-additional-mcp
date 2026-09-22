import { AuthError } from "../errors.ts";
import { buildUrl, getJson } from "../http.ts";
import { formatYYYYMMDD } from "../date.ts";
import type { RequestOptions } from "../http.ts";

import type { TrainingScheduleData } from "../types/training.ts";

export type { TrainingScheduleData };

/**
 * GET training/schedule/query — returns training calendar for date range.
 * Requires accessToken.
 */
export async function getTrainingSchedule(
    options: RequestOptions,
    params: { startDate: Date; endDate: Date; supportRestExercise?: number },
): Promise<TrainingScheduleData> {
    if (!options.accessToken) throw new AuthError();
    const startStr = formatYYYYMMDD(params.startDate);
    const endStr = formatYYYYMMDD(params.endDate);
    const supportRestExercise = params.supportRestExercise ?? 1;
    const url = buildUrl(options.baseUrl, "training/schedule/query", {
        startDate: startStr,
        endDate: endStr,
        supportRestExercise: String(supportRestExercise),
    });
    return await getJson<TrainingScheduleData>(url, options);
}
