# coros-additional-mcp

A Node.js 20+ TypeScript library and stdio MCP server for the unofficial COROS Training Hub API. It supports account/activity APIs and FIT/TCX uploads to the region-appropriate AWS S3 or mainland-China Aliyun OSS bucket.

> **Unofficial and unsupported.** This project reverse-engineers a private COROS API. COROS can change its API or rotate the opaque upload `sign` values at any time, which will break uploads until they are recaptured. Do not use it to violate service terms or user privacy.

## Install and build

```bash
npm install
npm run build
```

### Library

```ts
import { CorosClient } from "coros-additional-mcp";

const client = new CorosClient({ email: process.env.COROS_EMAIL!, password: process.env.COROS_PASSWORD! });
const user = await client.login();
const result = await client.uploadActivity(fitBytes, "activity.fit", user.userId, { timezone: 32 });
console.log(result.importId, result.status, result.success);
```

When `region` is omitted, login probes the mainland-China API host, matching behavior observed in reverse-engineered clients. The login response's `regionId` (1 Americas, 2 mainland China, 3 Europe) then selects the API host and storage configuration. A server-reported region overrides a conflicting configured region, with a warning.

`timezone` is measured in 15-minute units (`32` means UTC+8). When omitted, it is calculated from the machine's current timezone.

## MCP server

The `coros-additional-mcp` binary uses stdio. It reads credentials only from environment variables, logs only to stderr, and keeps its access token in process memory. It never returns a password or access token.

| Environment variable | Required | Description |
| --- | --- | --- |
| `COROS_EMAIL` | Yes | COROS account email. |
| `COROS_PASSWORD` | Yes | COROS account password. |
| `COROS_REGION` | No | `en`, `eu`, or `cn`. Omit it to let login discover the account region. |

Authentication is lazy: activity/import operations log in on their first use and retry once after an HTTP 401. `check_coros_auth` only reports the current in-memory session; it does not trigger login.

The server registers five tools:

- `check_coros_auth` — report in-memory login state, region, and user ID (never the token).
- `upload_activity` — upload an absolute local `.fit`/`.tcx` file or base64 content. Files are limited to 50 MB. An import status other than `2` means it may still be processing; query `list_import_jobs`.
- `list_import_jobs` — list recent activity import jobs.
- `delete_import_job` — remove an import job by ID.
- `list_activities` — list uploaded COROS activities.

### Claude Code configuration

Add this to `.mcp.json` (or your Claude Code MCP configuration), replacing the values with your environment-variable source as appropriate:

```json
{
  "mcpServers": {
    "coros": {
      "command": "npx",
      "args": ["-y", "coros-additional-mcp"],
      "env": {
        "COROS_EMAIL": "you@example.com",
        "COROS_PASSWORD": "your-password",
        "COROS_REGION": "en"
      }
    }
  }
}
```

### Codex configuration

Add this server to your Codex MCP configuration:

```toml
[mcp_servers.coros]
command = "npx"
args = ["-y", "coros-additional-mcp"]

[mcp_servers.coros.env]
COROS_EMAIL = "you@example.com"
COROS_PASSWORD = "your-password"
COROS_REGION = "en"
```

For a checked-out repository, replace `npx` and its arguments with the absolute path to `dist/mcp/index.js` after running `npm run build`.

## Attribution

This project is a derivative of [`Pinta365/coros`](https://github.com/Pinta365/coros), Copyright (c) 2026 Pinta365, used under the MIT License. The original source is retained under `src/coros/`; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

The mainland-China region flow was independently implemented in TypeScript by referring to the public implementation approach in [`XiaoSiHwang/garmin-sync-coros`](https://github.com/XiaoSiHwang/garmin-sync-coros). No source files from that unlicensed repository are copied into this project.
