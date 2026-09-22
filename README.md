# coros-additional-mcp

A zero-runtime-dependency Node.js 20+ TypeScript library for the unofficial COROS Training Hub API. It supports account/activity APIs and FIT/TCX uploads to the region-appropriate AWS S3 or mainland-China Aliyun OSS bucket.

> **Unofficial and unsupported.** COROS uses a private API that can change without notice. Do not use this library to violate service terms or user privacy.

## Install and build

```bash
npm install
npm run build
```

```ts
import { CorosClient } from "coros-additional-mcp";

const client = new CorosClient({ email: process.env.COROS_EMAIL!, password: process.env.COROS_PASSWORD! });
const user = await client.login();
const result = await client.uploadActivity(fitBytes, "activity.fit", user.userId, { timezone: 32 });
console.log(result.importId, result.status, result.success);
```

When `region` is omitted, login probes the mainland-China API host, matching behavior observed in reverse-engineered clients. The login response's `regionId` (1 Americas, 2 mainland China, 3 Europe) then selects the API host and storage configuration. A server-reported region overrides a conflicting configured region, with a warning.

`timezone` is measured in 15-minute units (`32` means UTC+8). When omitted, it is calculated from the machine's current timezone.

## Attribution

This project is a derivative of [`Pinta365/coros`](https://github.com/Pinta365/coros), Copyright (c) 2026 Pinta365, used under the MIT License. The original source is retained under `src/coros/`; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

The mainland-China region flow was independently implemented in TypeScript by referring to the public implementation approach in [`XiaoSiHwang/garmin-sync-coros`](https://github.com/XiaoSiHwang/garmin-sync-coros). No source files from that unlicensed repository are copied into this project.
