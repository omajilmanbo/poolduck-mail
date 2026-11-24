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
8. 仓库支持 OCI Email Delivery HTTPS 提交，默认使用 `mock`。当前代码的真实发送门禁仅适用于 Staging，启用须通过配置检查并获得当次窗口批准。2026-10-16 的获批窗口已完成受控单封验收，随后在当次窗口回滚到 `mock`。排障时按执行卡独立核对目标环境实际生效的 provider 和开关。Production 准入须按 ADR-019 另行批准。见[单封验收记录](testing/staging-oci-mail-single-send-2026-10-16.md)、[Staging 执行卡](oci-mail-staging-operator-runbook.md)和 [ADR-019](decisions/ADR-019-oci-email-delivery-provider.md)。
   - `sent` 仅表示 OCI 接受提交。只有 OCI 明确拒绝本次提交的 HTTP 429，以及服务错误码为 `QuotaExceeded` 或 `LimitExceeded` 的 HTTP 400，才按 30 秒、2 分钟、10 分钟有限退避。重试耗尽后进入 `failed`。
   - OCI 明确返回的永久请求、认证或配置拒绝，以及收件人 suppression，均进入 `failed`，不重试。
   - OCI 提交返回 HTTP 408、425、499 或 5xx，或遇到超时、断线、回执不完整等无法确认是否接受的情况，进入 `delivery_unknown`。按可用的 Message-ID、envelope ID 和 OCI request ID 人工对账，禁止自动重发或手工改回 `queued`。日志和工单只记录安全原因码与对账所需标识，避免复制收件邮箱、正文、凭据或 SDK 原始请求、响应和错误。

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

## 9. 平台地点调额拒绝

已授权的调额请求返回 409 时，记录时间、目标租户内部 ID、错误码和安全的 `X-Request-Id`。
用平台审计按目标租户、时间、`platform.location_limit.update` 和 `denied` 筛选。
逐请求对账时，有权限的运维人员可用只读数据库连接执行以下参数化查询，将 `$1` 绑定为安全的请求标识，
将 `$2` 绑定为目标租户内部 UUID。

```sql
SELECT request_id, platform_admin_id, target_tenant_id, result,
       metadata_json->>'reason' AS reason, created_at
FROM platform_audit_logs
WHERE request_id = $1 AND target_tenant_id = $2::uuid
  AND action = 'platform.location_limit.update' AND result = 'denied';
```

- `PLATFORM_VERSION_CONFLICT` 表示版本已变化。刷新平台租户摘要，重新确认目标、额度和版本。
- `LOCATION_LIMIT_BELOW_CURRENT_USAGE` 表示目标额度低于当前用量。核对 active、inactive 和待清理地点数后重新选定额度。
- 请求标识缺失或格式不符时，审计使用服务端 UUID。按管理员、目标租户和时间定位记录。
- 查无记录时，核对请求标识并检查审计存储是否可写。审计写入失败仍返回原 409。刷新租户摘要核对
  额度、版本和用量，仅在重新确认以后提交调额。

<a id="offline-integrity"></a>

## 10. 迁移、恢复与 seed 后的离线完整性检查

完成迁移、恢复到当前 schema 或写入合成 seed 后，在恢复服务或验收前手动运行。核实离线目标库和版本，从受控环境注入该库的 `DATABASE_URL`。使用能读取 `public` 下检查所需九张表全部相关行的只读账号。在仓库根目录执行：

```sh
npm --prefix backend run --silent integrity:check
```

检查在一个 PostgreSQL `REPEATABLE READ READ ONLY` 事务内完成。每次输出一行 JSON。

| 字段 | 计数单位与判定依据 |
|---|---|
| `person_location_tenant` | 人员行。所属 tenant 必须存在，地点必须属于同一 tenant。 |
| `person_code_groups` | 有问题的公共码组。所有 tenant 和墓碑一起按码分组，同码多行计一组，缺码也计一组。 |
| `lifecycle_rows` | 人员或地点行。active/inactive 的三个删除字段均为空。pending_delete 有原状态和相隔 14 天的起止时间，到期等待清理仍合法。purged 已清空原状态，允许保留原时间对，也允许随上级清理而两者均空。 |
| `history_rows` | 扫码、邮件、尝试或幂等行，每个有问题的行在本表只计一次。核对成功扫码的 tenant、地点、人员及任务指向，非空的设备、创建人、取消人必须同 tenant。动作码扫码和历史进出扫码有且仅有一个任务，现存尝试须指向同 tenant 任务，幂等行须指向同 tenant 的同一扫码与任务。 |

旧动作 `unknown/legacy_unknown` 和旧 `scan_type` 可以保留。检查依据内部关系，接受可空的设备和操作人、墓碑引用以及已按留存规则整组销毁的历史。迁移已清除的 `unmapped` 事件若重新出现，会计入历史异常。

| 退出码 | JSON 结果 | 运维处理 |
|---|---|---|
| 0 | `ok`，四项为零 | 保存本次检查对应的版本、步骤和汇总。 |
| 1 | `violations` 和四项计数 | 暂停放行。按非零类别在隔离副本复核迁移顺序、回填、删除时间对或留存家族关联。修复另行审核，之后重跑同一命令。 |
| 2 | `unavailable` | 检查没有完成。核实连接、schema 版本及全表读取权限后重跑。行级安全策略限制可见数据时也应按此处理。 |

工单只记录退出码和汇总，连接串、行标识、人员码和业务内容留在受控环境。验证使用合成数据，实际环境操作按既有发布审批执行。
