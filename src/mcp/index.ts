#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCorosMcpServer } from "./server.ts";

async function main(): Promise<void> {
    const server = createCorosMcpServer();
    await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
    // stdout is reserved for MCP JSON-RPC messages.
    const message = error instanceof Error ? error.message : "Unable to start COROS MCP server.";
    process.stderr.write(`coros-additional-mcp: ${message}\n`);
    process.exitCode = 1;
});
