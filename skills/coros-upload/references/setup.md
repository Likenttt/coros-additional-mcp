# COROS Upload 接入与认证细节

本技能使用公开 npm 包 `coros-additional-mcp`（Node.js 20+），不锁定版本，始终由 npm 解析 `latest`。它是非官方 COROS Training Hub 私有 API 实现；执行 `npx` 会在本机运行该包及其依赖。不要把账号密码、`CPL-coros-token` 或会话文件内容发到对话、日志或命令行。

## 接入前的独立授权

依次确认用户是否允许：

1. 下载并执行 npm 包；
2. 修改其 MCP 客户端配置；
3. 打开浏览器/读取 Cookie 并写入会话文件；
4. 之后向其 COROS 账号上传真实活动。

前 3 项完成后需要重载 MCP 客户端；然后再开始上传请求。第 4 项不能由“已配置”或“导入历史活动”的笼统表述代替，必须在每次实际提交前核对文件和数量。

## 客户端配置

### Claude Code

```bash
claude mcp add coros -- npx -y coros-additional-mcp
```

### Codex

将以下服务合并到既有 Codex MCP 配置，保留其他服务：

```toml
[mcp_servers.coros]
command = "npx"
args = ["-y", "coros-additional-mcp"]
```

### 其他 stdio MCP 客户端

按客户端格式设置：

```json
{
  "command": "npx",
  "args": ["-y", "coros-additional-mcp"]
}
```

不需要把 token 放进 MCP 配置。服务启动时可先显示工具，认证在实际调用认证工具时校验。配置变更后重载服务并新开会话；仅 `npm install` 或 `npx` 下载不会给已运行会话新增工具。

## 浏览器会话认证

默认手动方式，先登录官方 Training Hub：国际区 `https://training.coros.com`、大陆区 `https://trainingcn.coros.com`、欧洲区 `https://trainingeu.coros.com`。

1. 打开浏览器开发者工具：Chrome/Edge 选 **Application**，Firefox 选 **Storage**。
2. 展开对应 Training Hub 域名下的 **Cookies**。
3. 找到 `CPL-coros-token`，仅复制其值；不要复制 Cookie 标题、其他字段或整个请求。
4. `CPL-coros-region` 的映射是 `1=en`、`2=cn`、`3=eu`。
5. 在可信本地终端运行（按实际地区替换）：

```bash
npx -y --package coros-additional-mcp coros-auth import-token --region cn
```

在隐藏 stdin 提示粘贴 token 并回车。CLI 会先向 COROS 验证 token，再写入默认的 `~/.coros-additional-mcp/session.json`；目录权限为 `0700`，文件权限为 `0600`。

可检查本地会话文件状态：

```bash
npx -y --package coros-additional-mcp coros-auth status
```

token 失效时重新执行 `import-token`。用户明确要退出并删除本地会话文件时才执行：

```bash
npx -y --package coros-additional-mcp coros-auth logout
```

`logout` 仅删除本地会话文件，不撤销 COROS 服务端会话；如果另设了 `COROS_ACCESS_TOKEN`，它仍会留在环境变量中。

## 上传后的核对与失败处理

调用 `upload_activity` 前，展示并确认每个本地路径或已识别内容、目标账号（如可知）及总数量。该工具接受单个绝对 `.fit`/`.tcx` 路径或 base64 内容，文件上限 50 MB。上传创建的是账户中的真实活动，会影响训练负荷或相关统计。

返回 `status: 2` 才表示导入完成。其他 status 可能仍在处理：先用 `list_import_jobs` 查任务，再用 `list_activities` 核对新活动出现；不要因响应不明确自动重传，避免重复活动。日常历史活动查询应使用官方 COROS MCP 的 `querySportRecords`，而不是 `list_activities`。

若报 `401 signature error`，通常是 COROS 轮换私有 STS 的硬编码 `sign`。这不能由本地配置、重新认证或重复上传在外部修复；停止重试并如实告知用户。
