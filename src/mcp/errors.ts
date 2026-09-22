import { ApiError, AuthError, HttpError } from "../coros/errors.ts";
import { z } from "zod";

/** Convert internal failures to safe, actionable MCP text without exposing secrets or stacks. */
export function formatToolError(error: unknown, secrets: readonly string[] = []): string {
    return redact(formatSafeError(error), secrets);
}

function formatSafeError(error: unknown): string {
    if (error instanceof z.ZodError) {
        const details = error.issues.map((issue) => issue.message).join("; ");
        return `Invalid input: ${details}`;
    }
    if (error instanceof HttpError) {
        if (error.status === 401) return "COROS session expired or was rejected. Run `coros-auth import-token` again.";
        if (error.status === 429) return "COROS is rate limiting requests. Please wait and try again.";
        if (error.status === 0) return "Unable to reach COROS. Check your network connection and try again.";
        return `COROS request failed (HTTP ${error.status}). Please try again.`;
    }
    if (error instanceof AuthError) {
        return "COROS authentication is required. Run `coros-auth import-token` after signing in through the browser.";
    }
    if (error instanceof ApiError) return `COROS rejected the request: ${error.message}`;
    if (error instanceof Error) return error.message;
    return "Unexpected error while processing the request.";
}

function redact(message: string, secrets: readonly string[]): string {
    let redacted = message
        .replace(/(access[_-]?token|password)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
        redacted = redacted.split(secret).join("[redacted]");
    }
    return redacted;
}
