import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthError, HttpError } from "../coros/errors.ts";
import { CorosClient, type ActivityQueryOptions } from "../index.ts";
import type { ApiRegion } from "../coros/constants.ts";
import {
    resolveCorosAuthentication,
    type AuthenticationResolutionOptions,
    type CorosAuthSource,
    type ResolvedCorosAuthentication,
} from "../auth/token-store.ts";
import { formatToolError } from "./errors.ts";
import {
    checkCorosAuthInputSchema,
    deleteImportJobInputSchema,
    listActivitiesInputSchema,
    listImportJobsInputSchema,
    readValidatedActivityFile,
    uploadActivityInputSchema,
} from "./validation.ts";

export interface CorosMcpOptions extends AuthenticationResolutionOptions {
    /** Test/embedding override. Production reads process.env. */
    env?: Record<string, string | undefined>;
}

interface LoggedInUser {
    userId: string;
}

export interface CorosAuthStatus {
    isLoggedIn: boolean;
    hasCredentials: boolean;
    authSource: CorosAuthSource;
    region: ApiRegion | null;
    userId: string | null;
}

/** Owns the lazy in-memory COROS session used by all tools in one MCP process. */
export class CorosSession {
    private clientInstance: CorosClient | undefined;
    private readonly options: CorosMcpOptions;
    private authentication: ResolvedCorosAuthentication | undefined;
    private configurationPromise: Promise<ResolvedCorosAuthentication> | undefined;
    private user: LoggedInUser | undefined;

    constructor(options: CorosMcpOptions = {}) {
        this.options = options;
    }

    async getStatus(): Promise<CorosAuthStatus> {
        const authentication = await this.configure();
        return {
            isLoggedIn: this.isLoggedIn(),
            hasCredentials: authentication.source !== "none",
            authSource: authentication.source,
            region: this.clientInstance?.getRegion() ?? authentication.region ?? null,
            userId: this.user?.userId ?? authentication.userId ?? null,
        };
    }

    isLoggedIn(): boolean {
        return this.user !== undefined && this.clientInstance?.getAccessToken() !== undefined;
    }

    getRegion(): ApiRegion | undefined {
        return this.clientInstance?.getRegion() ?? this.authentication?.region ?? this.options.region;
    }

    getUserId(): string | undefined {
        return this.user?.userId ?? this.authentication?.userId;
    }

    getSensitiveValues(): string[] {
        return [
            this.clientInstance?.getAccessToken(),
            this.authentication?.accessToken,
            this.authentication?.credentials?.password,
        ].filter((value): value is string => Boolean(value));
    }

    async withAuthentication<T>(operation: () => Promise<T>): Promise<T> {
        await this.loginIfNeeded();
        try {
            return await operation();
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) throw error;
            this.user = undefined;
            if (this.authentication?.source === "password") {
                this.client.setAccessToken(undefined);
                await this.loginIfNeeded();
                return await operation();
            }
            this.client.setAccessToken(undefined);
            throw new AuthError(
                "COROS session token is invalid or expired. Run `coros-auth import-token` again.",
            );
        }
    }

    async upload(input: Parameters<typeof readValidatedActivityFile>[0]): Promise<unknown> {
        const { bytes, filename } = await readValidatedActivityFile(input);
        return await this.withAuthentication(async () => {
            const result = await this.client.uploadActivity(bytes, filename, this.user!.userId, { timezone: input.timezone });
            return {
                importId: result.importId,
                status: result.status,
                success: result.success,
                message: uploadStatusMessage(result.status),
            };
        });
    }

    async listImportJobs(size: number): Promise<unknown> {
        return await this.withAuthentication(() => this.client.getImportList(size));
    }

    async deleteImportJob(importId: string): Promise<unknown> {
        return await this.withAuthentication(async () => {
            await this.client.removeFromImportList(importId);
            return { importId, deleted: true };
        });
    }

    async listActivities(options: { page: number; size: number; from?: string; to?: string; modeList?: string }): Promise<unknown> {
        const query: ActivityQueryOptions = {
            page: options.page,
            size: options.size,
            from: options.from ? new Date(`${options.from}T00:00:00`) : undefined,
            to: options.to ? new Date(`${options.to}T00:00:00`) : undefined,
            modeList: options.modeList,
        };
        return await this.withAuthentication(() => this.client.getActivities(query));
    }

    private get client(): CorosClient {
        if (!this.clientInstance) {
            throw new AuthError("COROS authentication is not configured. Run `coros-auth import-token`.");
        }
        return this.clientInstance;
    }

    private async configure(): Promise<ResolvedCorosAuthentication> {
        if (this.authentication) return this.authentication;
        this.configurationPromise ??= resolveCorosAuthentication(this.options, this.options.env ?? process.env)
            .then((authentication) => {
                this.authentication = authentication;
                if (authentication.source !== "none") {
                    this.clientInstance = new CorosClient(authentication.credentials, {
                        region: authentication.region,
                        accessToken: authentication.accessToken,
                    });
                }
                return authentication;
            });
        return await this.configurationPromise;
    }

    private async loginIfNeeded(): Promise<void> {
        if (this.isLoggedIn()) return;
        const authentication = await this.configure();
        if (authentication.source === "none") {
            throw new AuthError(
                "No COROS session is configured. Run `coros-auth import-token` after signing in through the browser.",
            );
        }
        if (authentication.source === "token-env" || authentication.source === "token-file") {
            const session = await this.client.resolveSession();
            this.user = { userId: session.userId };
            return;
        }
        const user = await this.client.login();
        this.user = { userId: user.userId };
    }
}

export function createCorosMcpServer(options: CorosMcpOptions = {}): McpServer {
    const session = new CorosSession(options);
    const server = new McpServer({ name: "coros-additional-mcp", version: "0.1.0" });

    server.registerTool("check_coros_auth", {
        description: "Report the configured COROS authentication source and current session metadata without exposing or validating the token.",
        inputSchema: checkCorosAuthInputSchema,
    }, async () => execute(() => session.getStatus(), () => session.getSensitiveValues()));

    server.registerTool("upload_activity", {
        description: "Upload one local FIT or TCX activity to COROS. Provide exactly one of filePath or contentBase64; filePath must be an absolute path.",
        inputSchema: uploadActivityInputSchema,
    }, async (input) => execute(() => session.upload(input), () => session.getSensitiveValues()));

    server.registerTool("list_import_jobs", {
        description: "List recent COROS activity import jobs so an upload can be checked after submission.",
        inputSchema: listImportJobsInputSchema,
    }, async ({ size }) => execute(() => session.listImportJobs(size), () => session.getSensitiveValues()));

    server.registerTool("delete_import_job", {
        description: "Remove an activity import job from the COROS import list by its import ID.",
        inputSchema: deleteImportJobInputSchema,
    }, async ({ importId }) => execute(() => session.deleteImportJob(importId), () => session.getSensitiveValues()));

    server.registerTool("list_activities", {
        description: "List COROS activities, optionally paginated and filtered by date range or sport mode.",
        inputSchema: listActivitiesInputSchema,
    }, async (input) => execute(() => session.listActivities(input), () => session.getSensitiveValues()));

    return server;
}

export function uploadStatusMessage(status: number): string {
    return status === 2
        ? "Activity import completed."
        : "Import may still be processing; use list_import_jobs to check its status.";
}

function success(value: unknown, secrets: readonly string[] = []) {
    const orderedSecrets = secrets.filter(Boolean).sort((left, right) => right.length - left.length);
    return {
        content: [{
            type: "text" as const,
            text: JSON.stringify(value, (_key, field) => {
                if (typeof field !== "string") return field;
                return orderedSecrets.reduce(
                    (redacted, secret) => redacted.split(secret).join("[redacted]"),
                    field,
                );
            }),
        }],
    };
}

async function execute(
    operation: () => Promise<unknown>,
    sensitiveValues: () => readonly string[] = () => [],
) {
    try {
        const value = await operation();
        return success(value, sensitiveValues());
    } catch (error) {
        return {
            content: [{ type: "text" as const, text: formatToolError(error, sensitiveValues()) }],
            isError: true,
        };
    }
}
