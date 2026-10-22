# 运维与故障排查手册（初版）

统一的事件、指标、脱敏、保留期和告警阈值见 `docs/observability.md`。Production 日志保留 90 天，初期告警发送到经批准的运维邮箱。

## 1. 登录失败

排查步骤：
1. 使用内部 user ID 确认账号状态（active/inactive），不要在工单或普通日志复制 username/完整邮箱
2. 检查 401 `LOGIN_FAILED` 与 429 `LOGIN_RATE_LIMITED` 聚合指标；不得根据对外响应判断 tenant 或账号是否存在
3. 检查 IP、tenant hash、identifier hash 与组合维度的限流配置是否符合当前流量
4. 检查 `JWT_SECRET`、`REFRESH_TOKEN_SECRET`、`AUTH_IDENTITY_HASH_SECRET` 或 session 配置是否异常

## 2. 邮件发送失败

排查步骤：
1. 查看 `mail_jobs` 中失败状态与错误信息
2. MVP 阶段优先检查 Sandbox/Mock provider 记录与返回错误
3. 检查 `MAIL_MOCK_SEND_RESULT`：`success` 表示模拟成功，`failure` / `failed` 表示模拟失败
4. 检查 `retry_count` 与 `scheduled_at` 是否符合 30 秒、2 分钟、10 分钟退避；三次重试耗尽后应为终态 `failed`
5. 检查是否有长期停留在 `processing` 的异常任务；原子领取应阻止同一任务并发重复发送
6. 重试期间订阅失效时，任务应安全终止为 `failed` / `SUBSCRIPTION_NOT_SENDABLE`
7. 检查收件箱地址格式与域名策略
8. OCI 真实模式尚未启用；未来启用后，`sent` 仅表示 accepted。只有明确未接受的限流/配额拒绝可按 30 秒、2 分钟、10 分钟退避；4xx 与 suppression 不重试，timeout/断线/5xx/回执不完整进入 `delivery_unknown` 并按 Message-ID、envelope ID、OCI request ID 人工对账，不直接改回 `queued`。排查时不复制收件邮箱、正文或 SDK 原始错误。

OCI Email Domain 的 `OutboundAccepted`/`OutboundRelayed`、bounce/complaint 对账、停止条件、回滚 mock 与 IAM 撤销顺序见 [OCI Staging 准入清单](oci-mail-staging-readiness.md)。OCI 原始日志含收件人 PII，只允许获批运维角色查看；`delivery_unknown` 无日志命中也不得自动重发。

### 2.1 ADR-017 等待、取消与不确定投递

ADR-017 本地运行时代码已落地，按以下 Runbook 排查：

1. 区分首次 `waiting`、retry `queued`、`processing`、`canceled`、`failed`、`sent` 与
   `delivery_unknown`；不得把 `canceled` 或 `delivery_unknown` 手工改回 `queued`。
2. 检查数据库 `cancel_until/send_not_before`，确认截止前没有 provider attempt；两字段不得解释为
   retry `scheduled_at`。
3. `send_not_before` 后超过 5 秒仍未领取时按 P1 候选告警检查 worker、数据库时钟、队列深度与 claim。
4. 进程崩溃后，未领取的 `waiting` 可恢复处理；无法证明 provider 未调用的任务进入
   `delivery_unknown` 并人工排查，不自动重发。
5. 取消、领取、订阅/资源阻断和竞态审计仅使用内部 ID 与安全原因码，不复制邮箱、正文或完整动作码。
6. Local/CI 发布前在 `backend` 运行 `npm run validate:adr017`。脚本仅允许 local/test PostgreSQL，创建
   并最终删除独立临时数据库；失败时不得把当前环境视为通过准入。
7. worker 会输出聚合事件 `mail_job.claim_latency_batch`；发现任一观测领取延迟超过 5 秒时改为
   `mail_job.claim_latency_slo_breach` 警告。事件只含数量和延迟，不含 tenant/job、邮箱、正文或动作码。

## 3. 订阅异常

排查步骤：
1. 查看 `subscriptions` 状态与有效期
2. 调用 `/api/license/check` 验证返回
3. 检查时区与过期判断逻辑
4. 确认订阅状态是否属于 `trial` / `active` / `expired` / `suspended` 之一，并核对门禁动作

## 4. 租户隔离异常（高优先级）

排查步骤：
1. 审查请求中的 tenant 上下文
2. 检查 SQL 查询是否包含 tenant_id 过滤
3. 核查审计日志中越权访问记录
4. 立即阻断可疑访问并升级处理

任意跨租户拒绝均按 P1 安全事件处理；确认发生数据读取或误发时升级为 P0。排障只使用 request ID、tenant/resource 内部 ID 和稳定错误码，不复制完整邮箱、姓名、token 或邮件正文。

## 5. Staging 容量测试

Issue #116 的执行与恢复使用 [`docs/testing/staging-capacity-runbook.md`](testing/staging-capacity-runbook.md)。
运维人员负责确认测试窗口、备份、mock provider、宿主机采集和停止条件；测试负责人负责外部负载机、
阶梯与结果报告。出现提前 provider 调用、真实误发、跨租户读取、OOM/restart、数据库异常或持续 5xx 时，
立即停止负载，保留聚合证据并按 P0/P1 流程处理。

## 6. Production 租户到期清理（#163）

自动清理只在 `APP_ENV=production` 且人工审核后显式设置 `TENANT_PURGE_PROCESSOR_ENABLED=true` 时启动；默认关闭。每分钟用数据库时间取最多 20 个到期 tenant，逐个运行 #162 事务。多个实例可以同时运行；tenant 行锁保证每个租户只完成一次。失败时本轮停止，保留 `pending_delete` 与 `suspended`，下一轮或重启后重试；到期恢复立即被拒，即使清理尚未成功。

查看结构化 `tenant_purge_metrics`：`pending`、`oldestOverdueSeconds`、`purged`、`failed`、`skipped`。`tenant_purge_alert` 的 `WRONG_ENVIRONMENT`、`SCAN_FAILED`、`TENANT_TRANSACTION_FAILED` 和 `BACKLOG_OVERDUE`（最老逾期超过 15 分钟）需进入生产运维告警路由。日志只有内部 tenant UUID、原因码和计数，不含名称、邮箱和正文。若出现环境错误或关联计数不符，保持开关关闭或立即设为 `false` 并重启 worker，核对数据库状态、迁移和 FK 计数后再恢复；不可直接将 `pending_delete` 改回可用状态，也不可重发未知邮件。停机及回滚保留生命周期字段和 `suspended` 门禁。发布前必须核准告警接收方、值班安排、迁移与回滚步骤；本次未启用生产任务。

## 7. 租户删除与恢复验收及故障处理（#166）

发布前在隔离的本地 PostgreSQL 上，以合成数据执行 `npm run test:tenant-deletion-acceptance`、`npm run test:tenant-deletion-rollback` 和 #160–#164 的事务/调度脚本；确认平台 Session、重新验密、`active` 订阅拒绝、跨租户隔离、暂停后的扫码/发信阻断、恢复期限及原订阅状态、到期墓碑和历史不变。检查本次代码与迁移的评审记录、Staging 演练、告警路由及人工放行。测试结果记录在 `docs/testing/tenant-deletion-acceptance-2026-10-20.md`。

Staging 仅在 `APP_ENV=staging` 且 `STAGING_TENANT_DELETE_ENABLED=true` 时允许物理删除。若事务失败，目标停留在 `staging_deleting`，订阅保持 `suspended`；先用内部 tenant UUID 核对状态及各关联表计数，修复故障后由平台管理员在同一环境重新验密、重试相同目标。只有接口返回 `deleted` 且目标数据为零、平台结果审计存在，才确认完成。网络结果未知时先刷新平台状态再重试。不得将状态改回 active、绕开门禁或手工部分删除。Staging 不考虑备份和保留期。

控制台“删除中”来自最近 10 分钟的开始审计，“删除失败”来自明确的失败审计；超过该窗口或缺少对应审计则显示“删除结果未确认”。这些是操作状态提示，不替代数据库残留核对。清理重试重新验密后写入新的开始审计，避免继续显示上一次失败。

Production 到期失败时保留 `pending_delete` 与 `suspended`；查 `tenant_purge_alert` 原因码、待处理量和数据库锁/错误聚合，修复后由调度器重试。恢复只允许数据库时间严格早于 `purge_after`；到期即使清理还没运行也拒绝。暂停调度或回滚应用时保留 schema 与写入门禁。对于历史邮件的 `delivery_unknown`，仅人工对账，不重置发送状态。日志、工单和验收记录不得含管理员密码、租户名称、邮箱、邮件正文或原始 SQL 错误。

## 8. ADR-024 一年记录销毁（#170–#173）

`RECORD_RETENTION_PROCESSOR_ENABLED` 默认关闭；Production 启用前须先应用 `20261022000000_record_retention_scan_indexes`，按 tenant/月份盘点到期行数，核对合成数据测试、告警路由和备份边界。`RECORD_RETENTION_BATCH_SIZE` 可设 1–100；每分钟分别选取最多该数量的扫码家族、租户审计和平台审计候选，按全局到期顺序处理。清理先锁 tenant 并复核数据库到期时间。`pending_delete` 的既存扫码家族与业务审计冻结，关联平台审计延至删除流程结束；恢复后超期记录可在下一轮清理。未终态邮件或未完成发送尝试不得强制清理。`delivery_unknown` 的尝试若没有 `provider_call_closed_at`，即使 `completed_at` 已被陈旧认领恢复流程填写，也必须保留并报警。人工核实原调用已结束后才可在受控维护中记录关闭时间；不得修改邮件业务状态、自动重发或为清理而调用 provider。核对 `record_retention_alert` 安全原因码。

出现清理失败、外键/计数异常或积压时将开关设为 `false` 并重启 Backend，确认无事务在途，再依据内部 ID 核对状态和迁移。Production 租户终结清理也须确认无 `processing`、未完成尝试或尚未确认关闭的 `delivery_unknown` 调用，才可销毁全部在线记录并写墓碑；失败则保持 `pending_delete` 和不可恢复门禁，修复后重试。索引回滚需停清理器并在数据库会话中显式设置 `app.allow_record_retention_index_rollback=true`；已销毁行无法靠回滚恢复。不得宣称备份副本已经清除。
