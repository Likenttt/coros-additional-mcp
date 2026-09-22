# coros-additional-mcp

[![npm version](https://img.shields.io/npm/v/coros-additional-mcp.svg?logo=npm)](https://www.npmjs.com/package/coros-additional-mcp)
[![npm downloads](https://img.shields.io/npm/dm/coros-additional-mcp.svg?logo=npm)](https://www.npmjs.com/package/coros-additional-mcp)
[![CI](https://github.com/Likenttt/coros-additional-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Likenttt/coros-additional-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English | **[中文](README.zh-CN.md)**

A Node.js 20+ TypeScript library and stdio MCP server for the unofficial COROS Training Hub API. It supports account/activity APIs and FIT/TCX uploads to the region-appropriate AWS S3 or mainland-China Aliyun OSS bucket.

## A complement to the official COROS MCP

This project is a **complement** to the [official COROS MCP endpoint](https://mcp.coros.com/mcp) and [`coroslab/COROS-MCP`](https://github.com/coroslab/COROS-MCP). It adds the one capability the official server does not provide: creating/importing an activity through `activity/fit/import`. The official MCP's activity tools are read-only (`querySportRecords`, `getActivityDetail`, and `downloadActivityFitFiles`); its write tools cover workouts and training plans. Run both servers side by side: use the official MCP for activity reads, workouts, and training plans, and use this server for activity uploads.

The two servers authenticate separately: sign in to the official MCP as its documentation describes, and bridge a Training Hub browser session here with `coros-auth import-token`.

> [!WARNING]
> **Unofficial, unsupported, and use-at-your-own-risk.** This project is not affiliated with, endorsed by, or approved by COROS. COROS is a trademark of COROS Wearables, Inc.
>
> It depends on reverse-engineered, unpublished private APIs that may change or stop working at any time. In particular, STS uses a hard-coded, fixed `sign` value for each storage bucket; its generation algorithm is not public. If COROS rotates these signatures, uploads will fail immediately with `401 signature error` and **cannot be repaired externally**. Read operations are unaffected by that specific failure.
>
> An upload creates a real activity in your COROS account and can affect training load and other statistics. Upload carefully and comply with applicable service terms and privacy requirements.

## Verification status

| Region | Status |
| --- | --- |
| Mainland China (`cn`) | End-to-end verified with a real account, including Aliyun OSS upload and successful activity import (2026-09). |
| Europe (`eu`) | Verified by upstream `Pinta365/coros`. |
| International/Americas (`en`) | Uses the same code path, but has not been tested end to end in this project. |

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

Authenticate once by bridging the session token from a signed-in browser:

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

The server registers six tools:

- `check_coros_auth` — report auth source, in-memory login state, region, and user ID (never the token).
- `upload_activity` — upload an absolute local `.fit`/`.tcx` file or base64 content. Files are limited to 50 MB. An import status other than `2` means it may still be processing; query `list_import_jobs`.
- `list_import_jobs` — list recent activity import jobs.
- `delete_import_job` — remove an import job by ID.
- `download_activity` — download one activity as FIT, TCX, GPX, KML, or CSV. `labelId` and `sportType` come from `list_activities`. The file is written locally with mode `0600`; the tool returns the path, not the bytes.
- `list_activities` — check that a newly uploaded activity appeared, and look up the `labelId` needed for download. For routine activity queries, use the official MCP's `querySportRecords` tool instead.

### Getting `CPL-coros-token` from the browser

The token is never passed as a command-line argument, and the CLI verifies it before saving:

1. Sign in on the official Training Hub: [training.coros.com](https://training.coros.com) internationally, [trainingcn.coros.com](https://trainingcn.coros.com) in mainland China, or [trainingeu.coros.com](https://trainingeu.coros.com) in Europe.
2. Open DevTools (`F12` or **Inspect**) and choose **Application** in Chrome/Edge, or **Storage** in Firefox.
3. Expand **Cookies**, then select the Training Hub origin.
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

This project is a derivative of [`Pinta365/coros`](https://github.com/Pinta365/coros) (revision `240ac18`), Copyright (c) 2026 Pinta365, used under the MIT License — see [LICENSE](LICENSE). That source is retained under `src/coros/`, adapted from Deno-first TypeScript to a Node.js 20+ package.

`src/coros/md5.ts` carries the MD5 implementation from the Deno standard library, as vendored by `Pinta365/coros` and changed only in formatting, exported wrappers, and a narrowed parameter type. MD5 has no Web Crypto equivalent, so a userland implementation is required.

Big thanks to [XiaoSiHwang](https://github.com/XiaoSiHwang) (四哥), whose [`garmin-sync-coros`](https://github.com/XiaoSiHwang/garmin-sync-coros) worked out the mainland-China upload path first. This project follows that approach and reimplements it in TypeScript — the code here is written from scratch, not copied.

The credential handling here follows the security design of [`dsh-plugin-garmin-connect`](https://github.com/Likenttt/garmin-connect-plugin-for-dsh): the password stays on the vendor's own sign-in page, only a session token is persisted, the session file is owner-only (`0700` directory, `0600` file) and written atomically, and tokens never reach command-line arguments, logs, or error messages.
