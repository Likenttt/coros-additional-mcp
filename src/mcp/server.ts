import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HttpError } from "../coros/errors.ts";
import { CorosClient, type ActivityQueryOptions } from "../index.ts";
import { formatToolError } from "./errors.ts";
import {
    checkCorosAuthInputSchema,
    deleteImportJobInputSchema,
    listActivitiesInputSchema,
    listImportJobsInputSchema,
    readValidatedActivityFile,
    uploadActivityInputSchema,
} from "./validation.ts";

type CorosRegion = "en" | "eu" | "cn";

export interface CorosMcpOptions {
    email?: string;
    password?: string;
    region?: CorosRegion;
}

interface LoggedInUser {
    userId: string;
}

/** Owns the in-memory COROS session used by all tools in one MCP process. */
export class CorosSession {
    private readonly client: CorosClient;
    private user: LoggedInUser | undefined;

    constructor(options: CorosMcpOptions = {}) {
        const email = options.email ?? process.env.COROS_EMAIL;
        const password = options.password ?? process.env.COROS_PASSWORD;
        if (!email || !password) {
            throw new Error("COROS_EMAIL and COROS_PASSWORD environment variables must be set.");
        }
        const region = options.region ?? readRegionFromEnvironment();
        this.client = new CorosClient({ email, password }, region ? { region } : {});
    }

    isLoggedIn(): boolean {
        return this.user !== undefined && this.client.getAccessToken() !== undefined;
    }

    getRegion(): CorosRegion {
        return this.client.getRegion();
    }

    getUserId(): string | undefined {
        return this.user?.userId;
    }

    async withAuthentication<T>(operation: () => Promise<T>): Promise<T> {
        await this.loginIfNeeded();
        try {
            return await operation();
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) throw error;
            this.client.setAccessToken(undefined);
            this.user = undefined;
            await this.loginIfNeeded();
            return await operation();
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

    private async loginIfNeeded(): Promise<void> {
        if (this.isLoggedIn()) return;
        const user = await this.client.login();
        this.user = { userId: user.userId };
    }
}

export function createCorosMcpServer(options: CorosMcpOptions = {}): McpServer {
    const session = new CorosSession(options);
    const server = new McpServer({ name: "coros-additional-mcp", version: "0.1.0" });

    server.registerTool("check_coros_auth", {
        description: "Report whether this MCP server currently has an in-memory COROS session. This does not trigger login.",
        inputSchema: checkCorosAuthInputSchema,
    }, async () => success({ isLoggedIn: session.isLoggedIn(), region: session.getRegion(), userId: session.getUserId() ?? null }));

    server.registerTool("upload_activity", {
        description: "Upload one local FIT or TCX activity to COROS. Provide exactly one of filePath or contentBase64; filePath must be an absolute path.",
        inputSchema: uploadActivityInputSchema,
    }, async (input) => execute(() => session.upload(input)));

    server.registerTool("list_import_jobs", {
        description: "List recent COROS activity import jobs so an upload can be checked after submission.",
        inputSchema: listImportJobsInputSchema,
    }, async ({ size }) => execute(() => session.listImportJobs(size)));

    server.registerTool("delete_import_job", {
        description: "Remove an activity import job from the COROS import list by its import ID.",
        inputSchema: deleteImportJobInputSchema,
    }, async ({ importId }) => execute(() => session.deleteImportJob(importId)));

    server.registerTool("list_activities", {
        description: "List COROS activities, optionally paginated and filtered by date range or sport mode.",
        inputSchema: listActivitiesInputSchema,
    }, async (input) => execute(() => session.listActivities(input)));

    return server;
}

export function uploadStatusMessage(status: number): string {
    return status === 2
        ? "Activity import completed."
        : "Import may still be processing; use list_import_jobs to check its status.";
}

function readRegionFromEnvironment(): CorosRegion | undefined {
    const region = process.env.COROS_REGION;
    if (region === undefined || region === "") return undefined;
    if (region === "en" || region === "eu" || region === "cn") return region;
    throw new Error("COROS_REGION must be one of en, eu, or cn.");
}

function success(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

async function execute(operation: () => Promise<unknown>) {
    try {
        return success(await operation());
    } catch (error) {
        return { content: [{ type: "text" as const, text: formatToolError(error) }], isError: true };
    }
}
