/**
 * Format a date as the `YYYYMMDD` the API expects for day-range parameters.
 *
 * Local-time components: these are calendar days in the user's own timezone,
 * so converting to UTC first would shift the range by a day.
 */
export function formatYYYYMMDD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}
