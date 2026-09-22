---
name: coros-garmin-migration
description: 在佳明 Garmin 与高驰 COROS 之间逐条迁移活动。配合 dsh-plugin-garmin-connect 下载佳明 FIT，用 coros-additional-mcp 上传或下载高驰活动。必须使用迁移账本，双线分开记账，一次只处理一条，并遵守等待与指数退避。
---

# 佳明与高驰活动迁移

配合两个 MCP，不要自己抓网页，也不要绕过账本直接循环上传。

- 佳明：`dsh-plugin-garmin-connect` 的 `get_garmin_activities`、`download_garmin_activity_fit`
- 高驰：`coros-additional-mcp` 的 `list_activities`、`download_activity`、`upload_activity`、`migration_*`

佳明插件目前只能下载 FIT，没有导入活动的工具。高驰到佳明时，如果佳明侧没有上传工具，停下来告诉用户，不要另写上传脚本。

## 双线进度

两条线分开记，互不覆盖：

- `garmin_to_coros`：佳明 activityId → 高驰
- `coros_to_garmin`：高驰 labelId → 佳明

每次调用只处理账本返回的那一条。成功后停 45–85 秒。失败从 30 秒起加倍，上限 15 分钟。`migration_next` 返回 `wait` 时必须停止，不能紧接着再传。

## 一轮只做这些

1. `migration_status` 看两条线的数量和 `waitMs`。
2. 需要新任务时，`migration_enqueue` 最多 20 条。不要一次塞进全部历史。
3. `migration_next`。按它的 `instruction` 做完一条，再 `migration_record`。
4. 佳明 FIT 下载后不返回路径。用返回的 `fileName`/`sha256` 调 `migration_record outcome=downloaded`，或 `migration_locate_garmin_fit`。文件必须已在 `GARMIN_FIT_DOWNLOAD_DIR`。
5. 上传结果不明时先查 `list_import_jobs`，不要立刻重传。

写入前向用户确认这一条的日期和名称。不要把“开始迁移”理解成可以连续写完整个列表。

上传到高驰前先读 `coros-upload` 的时区规则。批量开始前扫完源清单，按活动原始时区偏移分组；境外活动必须带对应的 `timezone`（15 分钟单位，UTC+8 为 `32`）单独传。省略时用的是电脑当前时区，高驰不会报错，但开始时间会静默平移。
