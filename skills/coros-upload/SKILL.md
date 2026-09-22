---
name: coros-upload
description: 将本地 FIT/TCX 活动文件上传或导入到高驰 COROS 账号；适用于从佳明或其他设备迁移活动、补录漏传活动和批量导入历史数据。不用于查询活动、训练负荷或健康数据；这些查询请使用官方 COROS MCP。
---

# COROS 活动上传

**Credit：底座 Pinta365/coros（MIT）；大陆区思路来自 XiaoSiHwang/garmin-sync-coros（四哥）；安全设计来自 Likenttt/garmin-connect-plugin-for-dsh。**

这是社区维护的非官方 MCP：npm 包为 `coros-additional-mcp`，不指定版本，跟随 npm `latest`。

## 一句话接入

先分别取得“下载并执行 npm 包”和“修改 MCP 配置”的明确授权，再按所用客户端添加：

- **Claude Code：**`claude mcp add coros -- npx -y coros-additional-mcp`
- **Codex：**
  ```toml
  [mcp_servers.coros]
  command = "npx"
  args = ["-y", "coros-additional-mcp"]
  ```
- **通用 stdio MCP 客户端：**`command: npx`，`args: ["-y", "coros-additional-mcp"]`。

保存后重载 MCP 客户端；仅安装包不会让当前会话新增工具。完整配置与认证见 [references/setup.md](references/setup.md)。

## 认证：仅保存浏览器会话

认证前单独取得“打开浏览器/读取 Cookie 并写入本地会话文件”的授权。从已登录的浏览器把会话 token 桥接过来：

```bash
npx -y --package coros-additional-mcp coros-auth import-token --region cn
```

将 `cn` 换成 `en` 或 `eu`；在隐藏提示中粘贴 token，绝不把 token 放入命令行或对话。

手动取得 token：登录对应 Training Hub，打开 DevTools 的 **Application/Storage → Cookies**，复制 **仅** `CPL-coros-token` 的值；`CPL-coros-region` 映射为 `1=en`、`2=cn`、`3=eu`。密码不会落地；仅验证后的会话文件会保存，目录为 `0700`、文件为 `0600`。

## 工具选择

- `check_coros_auth`：开始前查看认证来源、区域和用户 ID，不暴露 token。
- `upload_activity`：明确确认后上传一个绝对路径的 `.fit`/`.tcx`，或其 base64 内容。
- `list_import_jobs`：上传后查看导入任务是否完成或仍在处理。
- `delete_import_job`：用户明确要求时，按 ID 从导入列表移除任务。
- `list_activities`：**仅**核对刚上传的活动是否出现；日常活动查询使用官方 MCP 的 `querySportRecords`。

## 分阶段授权与写入确认

不要把以下四类副作用混作一次授权，须在各动作前分别取得用户明确同意：

1. 下载并执行 `coros-additional-mcp` npm 包；
2. 修改客户端 MCP 配置；
3. 打开浏览器认证（或读取 Cookie）并写入本地会话文件；
4. 向 COROS 账号写入真实活动。

第 4 项尤其严格：上传会在账号中创建真实活动，可能影响训练负荷和统计。调用 `upload_activity` 前，必须向用户逐项确认目标文件（或文件列表）和**总数量**；批量任务逐批列出并确认。提交结果不明确时先查 `list_import_jobs`，不要自动重传。

## 风险与区域状态

非官方实现，依赖逆向私有 API，可能随时失效。STS `sign` 为硬编码值；若 COROS 轮换，上传会报 `401 signature error`，且无法从外部修复。区域：`cn` 已真实端到端验证；`eu` 由上游验证；`en` 尚未实测。

## 故障排查

- **工具不可用：**重载 MCP 客户端并新开会话；只安装包不会添加当前会话工具。
- **token 过期：**重新运行 `coros-auth import-token`。
- **上传返回的 status 不等于 2：**可能仍在处理；使用 `list_import_jobs`，不要重复上传。
- **`401 signature error`：**通常是上游 STS 签名轮换，无法外部修复；停止重试并报告。
