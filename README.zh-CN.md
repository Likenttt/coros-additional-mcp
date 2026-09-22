# coros-additional-mcp

> 一个基于 Node.js 20+ TypeScript 的库与 stdio MCP 服务器，对接非官方 COROS Training Hub API：支持账号/活动相关接口，并把 FIT/TCX 上传到与区域匹配的 AWS S3 或中国大陆阿里云 OSS 存储桶。

**[English](README.md)** | 中文

## 对官方 COROS MCP 的补充

本项目是[官方 COROS MCP 端点](https://mcp.coros.com/mcp)与 [`coroslab/COROS-MCP`](https://github.com/coroslab/COROS-MCP) 的**补充**。它补上了官方服务器没有的那一项能力：通过 `activity/fit/import` 创建/导入一条活动。官方 MCP 的活动类工具是只读的（`querySportRecords`、`getActivityDetail` 和 `downloadActivityFitFiles`），其写入类工具覆盖的是训练课程与训练计划。两个服务器可以并行运行：活动读取、训练课程和训练计划交给官方 MCP，活动上传则用本服务器。

两个服务器各自独立认证：按官方 MCP 的文档登录它，再用 `coros-auth import-token` 把这里的 Training Hub 浏览器会话桥接过来。

> [!WARNING]
> **非官方、无官方支持、风险自担。** 本项目与 COROS 无任何关联，也未经 COROS 认可或批准。COROS 是 COROS Wearables, Inc. 的商标。
>
> 它依赖逆向得来、未公开的私有 API，这些接口随时可能变更或失效。尤其是 STS 对每个存储桶都使用硬编码的固定 `sign` 值，其生成算法并未公开。如果 COROS 轮换了这些签名，上传会立即以 `401 signature error` 失败，且**无法在外部修复**。读取操作不受这一特定故障影响。
>
> 一次上传会在你的 COROS 账号中创建一条真实活动，可能影响训练负荷及其他统计。请谨慎上传，并遵守适用的服务条款与隐私要求。

## 验证状态

| 区域 | 状态 |
| --- | --- |
| 中国大陆（`cn`） | 已用真实账号端到端验证，包含阿里云 OSS 上传与活动导入成功（2026-09）。 |
| 欧洲（`eu`） | 由上游 `Pinta365/coros` 验证。 |
| 国际/美洲（`en`） | 走同一套代码路径，但本项目尚未做端到端测试。 |

## 安装与构建

```bash
npm install
npm run build
```

### 库用法

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

`resolveSession()` 通过 `getAccount()` 校验已有的 Training Hub 浏览器令牌，并用它的 `regionId`（1 美洲，2 中国大陆，3 欧洲）来选择 API 主机和存储配置。密码登录仍然可用，走 `new CorosClient({ email, password }).login()`，但它是一个需显式开启的兼容性回退方案。

`timezone` 以 15 分钟为单位（`32` 表示 UTC+8）。省略时，会根据机器当前时区计算。

## MCP 服务器

`coros-additional-mcp` 可执行文件使用 stdio，永不返回密码或访问令牌。推荐的配置方式只在 `~/.coros-additional-mcp/session.json` 中保存浏览器会话令牌；其目录权限为 `0700`，文件权限为 `0600`。

先把已登录浏览器里的会话令牌桥接过来，认证一次：

```bash
coros-auth import-token --region en
# 在隐藏的 stdin 提示符处粘贴 CPL-coros-token。
coros-auth status
```

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `COROS_ACCESS_TOKEN` | 否 | 优先级最高的直接令牌；只保留在进程内存中。需同时设置 `COROS_REGION`。 |
| `COROS_TOKEN_FILE` | 否 | 会话文件覆盖项。默认 `~/.coros-additional-mcp/session.json`。 |
| `COROS_REGION` | 否 | `en`、`eu` 或 `cn`；直接令牌默认 `en`。 |
| `COROS_EMAIL` / `COROS_PASSWORD` | 否 | 需显式开启的旧版密码登录回退，仅在没有可用令牌时使用。 |

凭据优先级为 `COROS_ACCESS_TOKEN` → `COROS_TOKEN_FILE` → 默认令牌文件 → 邮箱/密码。认证是懒加载的：服务器在没有凭据时也能启动并列出所有工具，而需要认证的工具会在首次使用时校验或登录。`check_coros_auth` 会报告 `authSource`、区域和用户 ID，但不会打印或校验令牌。

服务器注册了五个工具：

- `check_coros_auth` — 报告认证来源、内存中的登录状态、区域和用户 ID（绝不返回令牌）。
- `upload_activity` — 上传本地绝对路径的 `.fit`/`.tcx` 文件，或 base64 内容。文件上限 50 MB。导入状态不是 `2` 表示可能仍在处理中，可查询 `list_import_jobs`。
- `list_import_jobs` — 列出最近的活动导入任务。
- `delete_import_job` — 按 ID 删除一个导入任务。
- `list_activities` — 检查新上传的活动是否已出现。日常的活动查询请改用官方 MCP 的 `querySportRecords` 工具。

### 从浏览器获取 `CPL-coros-token`

令牌绝不会作为命令行参数传递，CLI 会先校验再保存：

1. 登录官方 Training Hub：国际区 [training.coros.com](https://training.coros.com)，中国大陆 [trainingcn.coros.com](https://trainingcn.coros.com)，欧洲 [trainingeu.coros.com](https://trainingeu.coros.com)。
2. 打开开发者工具（`F12` 或 **检查**），在 Chrome/Edge 中选择 **Application**，在 Firefox 中选择 **Storage**。
3. 展开 **Cookies**，然后选中 Training Hub 的来源。
4. 找到 `CPL-coros-token`，只复制它的值。`CPL-coros-region` 的映射为 `1=en`、`2=cn`、`3=eu`。
5. 运行 `coros-auth import-token --region en`（按需替换区域），在隐藏提示符处粘贴并回车。CLI 会先校验令牌再保存，且绝不打印它。

### Claude Code 配置

导入令牌之后，`.mcp.json` 里不需要任何密钥：

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

### Codex 配置

把这个服务器加到你的 Codex MCP 配置中：

```toml
[mcp_servers.coros]
command = "npx"
args = ["-y", "coros-additional-mcp"]

```

如果是检出的仓库，请在运行 `npm run build` 后，把 `npx` 及其参数替换为 `dist/mcp/index.js` 的绝对路径。

## 致谢

本项目衍生自 [`Pinta365/coros`](https://github.com/Pinta365/coros)（修订 `240ac18`），Copyright (c) 2026 Pinta365，依据 MIT 许可证使用——见 [LICENSE](LICENSE)。该源码保留在 `src/coros/` 下，从 Deno 优先的 TypeScript 改写为 Node.js 20+ 包。

`src/coros/md5.ts` 沿用了 Deno 标准库的 MD5 实现，由 `Pinta365/coros` 引入，仅改动了格式、导出的包装函数以及收窄的参数类型。MD5 没有 Web Crypto 对应实现，因此需要一份用户态实现。

特别感谢 [XiaoSiHwang](https://github.com/XiaoSiHwang)（四哥），他的 [`garmin-sync-coros`](https://github.com/XiaoSiHwang/garmin-sync-coros) 最先摸清了中国大陆的上传路径。本项目沿用了他的思路并用 TypeScript 重新实现——这里的代码是从零写的，没有照抄。

这里的凭据处理沿用了 [`dsh-plugin-garmin-connect`](https://github.com/Likenttt/garmin-connect-plugin-for-dsh) 的安全设计：密码只停留在厂商自己的登录页面上，本地只持久化一个会话 token，会话文件仅所有者可访问（目录 `0700`、文件 `0600`）且采用原子写入，token 绝不进入命令行参数、日志或错误信息。
