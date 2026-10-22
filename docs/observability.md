# 日志、监控与告警策略

## 1. 适用范围

本策略覆盖 Local、Staging 与 Production 的 API、数据库、认证、订阅门禁、扫码和邮件任务。本文件主要定义事件、指标、阈值和处理责任；#142 已在 OCI Staging 创建三条 Email Delivery 原生异常告警及六条 ADR-020 应用级告警，Production 仍未实施。

## 2. 环境与保留期

| 环境 | 用途 | 建议保留期 | 告警 |
|---|---|---:|---|
| Local | 开发排障 | 7 天或随开发环境清理 | 不发送，仅控制台/本地文件 |
| Staging | 集成与发布验证 | 30 天 | 运维邮箱，合并重复告警 |
| Production | 客户业务与安全追溯 | 90 天 | 运维邮箱，P0/P1 需人工确认恢复 |

Production 超过 90 天的在线日志应删除或转入经批准的合规归档；当前仓库不保存日志归档或客户数据。

## 3. 结构化日志字段

所有运行时日志使用 JSON 或等价的结构化格式，至少包含：

- `timestamp`：UTC ISO 8601。
- `level`：`info` / `warn` / `error`。
- `event`：稳定事件名。
- `request_id`：单次请求关联 ID。
- `tenant_id`、`actor_user_id`：仅在已验证上下文存在时记录内部 ID。
- `resource_type`、`resource_id`、`result`、`error_code`。
- `duration_ms`：API 和外部依赖耗时。

必须覆盖的业务事件：登录成功/失败、tenant 不存在、角色或跨租户拒绝、订阅拒绝、扫码成功、邮件发送成功/失败，以及人员、用户、location 的管理写操作。未映射拒绝不写逐请求数据库审计；首次上线前通过独立安全/运维 Issue 增加限流后的聚合指标与告警。

## 4. 敏感信息与 PII

不得记录密码、JWT、Cookie、Authorization header、OAuth refresh token、邮件正文、provider secret、数据库连接串或生产密钥。

- 邮箱：默认记录脱敏形式，例如 `a***z@example.com`；安全事件不需要邮箱时仅记录内部 user/person ID。
- 姓名：默认不记录；确需排障时使用内部 person ID。
- 自由文本错误：进入日志前必须清除邮箱、token、正文和 provider 原始响应。
- 请求体：禁止整体写入日志；仅提取白名单字段。

## 5. 指标与初始告警阈值

> ADR-018 已 `Accepted` 并移除未映射业务持久化。上线前的后续安全/运维 Issue 应按稳定错误类别聚合 `invalid_format`、`not_mapped`、授权/订阅拒绝和限流计数，不使用完整动作码、`person_code`、PII、UUID 或跨 tenant 映射作为指标标签；阈值和通知责任人必须人工批准。

> ADR-017 已 `Accepted` 且本地运行时已实现。监控应覆盖等待队列深度、到期至领取延迟、取消成功/
> 重复/过期/竞态失败、订阅/资源阻断、stale processing、`delivery_unknown` 和“截止前 provider 调用”
> 指标；最后一项目标恒为 0。标签只使用内部资源 ID 的安全聚合，不记录完整动作码、PII 或正文。

| 指标 | 初始阈值 | 严重度 |
|---|---|---|
| API 5xx 比率 | 5 分钟内 >= 5% 且至少 10 次请求 | P1 |
| API p95 latency | 连续 10 分钟 > 2 秒 | P2 |
| 数据库连接错误 | 5 分钟内 >= 3 次 | P1 |
| 邮件失败率 | 10 分钟内 >= 10% 且至少 10 个任务 | P1 |
| 首次发送到期领取延迟 | `send_not_before` 后 > 5 秒仍未领取 | P1 候选 |
| 截止前 provider 调用 | 任意一次 | P0/P1 误发不变量事件 |
| `delivery_unknown` | 任意新增 | P1，禁止自动重发 |
| 到期邮件积压 | `oldestDueMs` > 5 秒 | P1 候选；排查 OCI 应用节流/配额拒绝与 worker 吞吐 |
| 登录失败率 | 同 tenant 10 分钟内 >= 20 次 | P2；疑似攻击时 P1 |
| 订阅拒绝 | 10 分钟内 >= 20 次 | P2 |
| 跨租户拒绝 | 任意一次 | P1 安全事件 |

worker 当前以安全聚合日志实现本地/CI 可验证出口：`mail_job.claim_latency_batch` 记录 `count`、
`p95Ms`、`p99Ms`、`maxMs`、`overAlertThreshold`；任一延迟超过 5 秒时使用
`mail_job.claim_latency_slo_breach` 和 warn 级别。该出口不包含任务、tenant、人员或地址标签；真实
通知通道仍需部署环境单独批准，不能把本地 warn 宣称为 Production 告警已接通。
`mail_job.backlog_snapshot` 记录当前到期任务数 `dueCount`、最旧到期延迟 `oldestDueMs` 和本批次应用节流延期数 `rateDeferredCount`；仅含聚合数值，不含 tenant、任务 ID 或邮箱。超过 5 秒时 warn 每分钟最多一次。

告警先发送到经批准的运维邮箱。相同 `event + tenant_id + error_code` 在 10 分钟内合并，避免告警风暴；告警内容同样遵守脱敏规则。

## 6. 响应与责任

- P0：确认存在数据泄露、跨租户读取或真实误发时，立即阻断相关入口并通知负责人。
- P1：15 分钟内确认，收集 request ID、内部资源 ID、部署版本和脱敏错误码。
- P2：工作时间内处理并建立跟踪 Issue。
- 恢复后记录影响范围、根因、修复和防复发测试，不在 Issue 中粘贴客户数据或秘密。

## 7. 验证

后续日志实现必须以合成数据验证正常、错误、权限、租户隔离和边界路径，并断言输出不包含密码、Bearer token、完整邮箱、姓名或邮件正文。

## 8. Issue #116 低成本性能采集方案

容量测试第一阶段不安装新的常驻采集组件：使用 OCI 已有主机指标、5 秒一次的短期宿主机/容器 TSV、
现有 `mail_job.claim_latency_*` 聚合日志，以及按测试时间窗执行的 PostgreSQL 聚合查询。
原始测试指标只在 Staging 保存 30 天、权限 `0600`；容量报告只保留分位数、吞吐、状态计数和资源水位。

该方案避免在确认采集开销、免费额度、保留责任和告警接收方前引入 Prometheus/Grafana 或付费 APM。
正式长期监控仍需人工确认 OCI Monitoring 采集点、Notifications 用量、告警接收方与值班责任。
主机 CPU/内存不能替代 API 延迟、mail claim 延迟、积压、数据库连接/锁等待和容器 restart/OOM；
这些信号必须在同一 UTC 时间窗关联。采集命令、停止条件和脱敏边界见
[`staging-capacity-runbook.md`](testing/staging-capacity-runbook.md)。

## 9. ADR-019 OCI 邮件观测准入

#142 的 OCI `OutboundAccepted`/`OutboundRelayed` 日志、`oci_emaildelivery` 指标、告警接收人、PII 权限与保留期、人工对账及测试步骤见 [OCI Staging 准入清单](oci-mail-staging-readiness.md)。用户已批准邮件原始日志保留 90 天及可能费用；用户已指定当前唯一 OCI 用户作为读取人和告警接收人；OCI API 已核验该用户为唯一 ACTIVE 管理员，保守停止规则已批准；两类 90 天日志、通知主题及三条原生告警已应用，订阅为 ACTIVE，指定运维收件人已确认收到合成通知。ADR-020 应用级告警链路已在 mock 模式以无 PII 合成认证失败指标触发并投递到指定邮箱；真实邮件事件仍未验收。本文件前述 Staging 30 天仅为应用日志建议。`sent` 只表示 provider accepted，`delivery_unknown` 不自动重发。

应用级异常进入 OCI Monitoring 的方案见 Accepted [ADR-020](decisions/ADR-020-staging-mail-application-alerts.md)。Backend 每分钟在 Staging 显式启用后向 `poolduck_staging_mail` 发布 7 个聚合指标（unknown、认证、配额新增/连续、provider 连续失败、积压、心跳），固定部署级维度且不含 PII；Terraform 以专用 namespace 和 `METRIC_WRITE` 条件限制写入权限并定义 CRITICAL 告警。2026-10-11 已将 1 条 IAM、6 条告警应用到 OCI，并以 mock 模式部署 Backend，云端可查询到 7 类指标；无邮件的合成认证失败触发 `FIRING`，指定 Gmail 收件箱可查到告警通知。2026-10-14 收紧 IAM 后，从目标容器读取指标返回 404，仍须观察后续写入。事件型告警采用 5 分钟查询窗覆盖指标摄取延迟；真实邮件事件还须 #145 新窗口。

## Production 租户终结清理信号（#163）

启用后每分钟产生不含 PII 的 `tenant_purge_metrics` 结构化日志，字段为 `pending`、`oldestOverdueSeconds`、`purged`、`failed`、`skipped`。环境错误、扫描失败、事务失败与最老逾期超过 15 分钟产生 `tenant_purge_alert`；告警只含安全原因码和可选内部 tenant UUID。生产发布时须把此事件接入经批准的日志告警/值班路由并验证通知；本地实现只产生结构化事件，没有部署生产告警资源。Success 审计为 `platform.tenant.purged`，记录内部 ID 和清理计数；失败记录通用原因码，禁止输出原始数据库异常或客户明细。

本地 #166 验收只检查结构化事件及测试数据库中的审计字段，不接入真实告警接收方。Production 放行前应以合成到期任务验证告警路由、值班收件与恢复通知；任何 `TENANT_TRANSACTION_FAILED`、持续积压或环境错误必须可追溯到内部 tenant UUID 和安全原因码，且不得把 PII 写入日志。

## ADR-024 记录销毁信号（#171–#173）

`RECORD_RETENTION_PROCESSOR_ENABLED` 默认关闭。启用后每轮记录 `record_retention_metrics`：扫码家族、业务审计、平台审计的删除计数与剩余积压、被阻断计数、未终态逾期家族数量、最老逾期秒数及失败数。`record_retention_alert` 只含安全原因码；未终态或有在途调用的逾期家族、数据库失败、错误环境与逾期积压必须告警。平台执行审计 `platform.record_retention.run` 仅留汇总计数，不复制被销毁的快照、邮件地址或正文。Production 告警接收方与灰度发布仍须在 #176 独立核对。
