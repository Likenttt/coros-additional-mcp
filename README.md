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

const client = new CorosClient(undefined, {
  accessToken: process.env.COROS_ACCESS_TOKEN!,
  region: "en",
});
const session = await client.resolveSession();
const result = await client.uploadActivity(fitBytes, "activity.fit", session.userId, { timezone: 32 });
console.log(result.importId, result.status, result.success);
```

`resolveSession()` validates an existing Training Hub browser token with `getAccount()` and uses its `regionId` (1 Americas, 2 mainland China, 3 Europe) to select the API host and storage configuration. Password login remains available through `new CorosClient({ email, password }).login()`, but it is an opt-in compatibility fallback.

`timezone` is measured in 15-minute units (`32` means UTC+8). When omitted, it is calculated from the machine's current timezone.

## MCP server

The `coros-additional-mcp` binary uses stdio and never returns a password or access token. The recommended setup stores only a browser session token in `~/.coros-additional-mcp/session.json`; its directory is mode `0700` and the file is mode `0600`.

Authenticate once:

```bash
coros-auth import-token --region en
# Paste CPL-coros-token at the hidden stdin prompt.
coros-auth status
```

| Environment variable | Required | Description |
| --- | --- | --- |
| `COROS_ACCESS_TOKEN` | No | Highest-priority direct token; kept only in process memory. Set `COROS_REGION` too. |
| `COROS_TOKEN_FILE` | No | Session-file override. Defaults to `~/.coros-additional-mcp/session.json`. |
| `COROS_REGION` | No | `en`, `eu`, or `cn`; direct tokens default to `en`. |
| `COROS_EMAIL` / `COROS_PASSWORD` | No | Opt-in legacy password-login fallback, used only when no token is available. |

Credential priority is `COROS_ACCESS_TOKEN` → `COROS_TOKEN_FILE` → default token file → email/password. Authentication is lazy: the server starts and lists all tools with no credentials, while authenticated tools validate or log in on first use. `check_coros_auth` reports `authSource`, region, and user ID without printing or validating the token.

The server registers five tools:

- `check_coros_auth` — report auth source, in-memory login state, region, and user ID (never the token).
- `upload_activity` — upload an absolute local `.fit`/`.tcx` file or base64 content. Files are limited to 50 MB. An import status other than `2` means it may still be processing; query `list_import_jobs`.
- `list_import_jobs` — list recent activity import jobs.
- `delete_import_job` — remove an import job by ID.
- `list_activities` — list uploaded COROS activities.

### Getting `CPL-coros-token` from the browser

1. Sign in on the official Training Hub: [training.coros.com](https://training.coros.com) internationally or [trainingcn.coros.com](https://trainingcn.coros.com) in mainland China.
2. Open DevTools (`F12` or **Inspect**) and choose **Application** in Chrome/Edge, or **Storage** in Firefox.
3. Expand **Local Storage** (and check **Cookies** if necessary), then select the Training Hub origin.
4. Find `CPL-coros-token` and copy only its value. `CPL-coros-region` maps as `1=en`, `2=cn`, `3=eu`.
5. Run `coros-auth import-token --region en` (replace the region when needed), paste at the hidden prompt, and press Enter. The CLI verifies the token before saving it and never prints it.

### Claude Code configuration

After importing the token, no secrets are needed in `.mcp.json`:

```json
{
  "mcpServers": {
    "coros": {
      "command": "npx",
      "args": ["-y", "coros-additional-mcp"]
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

```

For a checked-out repository, replace `npx` and its arguments with the absolute path to `dist/mcp/index.js` after running `npm run build`.

## Attribution

This project is a derivative of [`Pinta365/coros`](https://github.com/Pinta365/coros), Copyright (c) 2026 Pinta365, used under the MIT License. The original source is retained under `src/coros/`; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

The mainland-China region flow was independently implemented in TypeScript by referring to the public implementation approach in [`XiaoSiHwang/garmin-sync-coros`](https://github.com/XiaoSiHwang/garmin-sync-coros). No source files from that unlicensed repository are copied into this project.
