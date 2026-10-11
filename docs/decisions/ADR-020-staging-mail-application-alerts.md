# ADR-020：Staging 真实邮件的应用级异常告警

- 状态：Accepted
- 日期：2026-10-11
- 相关 Issue：#142, #145

## Context

ADR-019 要求对 `delivery_unknown`、认证失败、配额拒绝、连续 provider 失败和积压建立告警。#142 已通过 Terraform 部署 OCI Email Delivery 的 accepted/relayed 日志、complaint/hard bounce/suppressed 原生指标告警及 Notifications 邮箱订阅，合成通知已送达；但应用数据库内的异常状态没有进入 OCI Monitoring。目前只有聚合应用日志和人工查询，不能声称应用级自动告警已接通。用户暂缓 #145 单发，Staging 保持 mock。

需要一个不记录收件邮箱、正文、tenant、person、job/attempt ID 的低维护告警通道。既有 Backend 已使用 Compute Instance Principal；任何新 IAM 权限、额外 OCI 用量及真实发信窗口仍需人工批准。本 ADR 只决定 Staging 应用级观测方案，不批准真实邮件提交。Oracle 的 [Monitoring IAM 参考](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/monitoringpolicyreference.htm)列出 `PostMetricData` 所需 `METRIC_WRITE` 权限；[官方价格表](https://www.oracle.com/manageability/pricing/)列出每月前 5 亿条 Monitoring ingestion datapoints 免费，超额可能收费。

## Decision

2026-10-11 用户接受本 ADR，并批准 Staging 指标写入权限及可能的 Monitoring 超额费用；这不批准真实邮件发送。决定如下：

1. Backend 在 `APP_ENV=staging` 且单独启用应用告警配置时，按固定周期从本地 PostgreSQL 读取安全聚合值，使用现有 Instance Principal 向 OCI Monitoring 的专用 namespace 发布自定义指标；mock 模式也可发布零值/心跳，验证通道时不发送邮件。Local/CI 使用 fake client，不访问 OCI。
2. 最小指标覆盖：新增 `delivery_unknown`、新增 `OCI_AUTH_REJECTED`、配额/429 拒绝及连续次数、连续 provider 失败、到期积压、采集心跳。只使用部署级固定维度；不得带 tenant、邮箱、正文、人员码、任务或 attempt ID。采集使用有界时间窗、可重复读取的数据库聚合，不改变 job 状态或重试语义。
3. Terraform 为现有单实例 Dynamic Group 增加**仅在 Staging compartment、仅在专用 namespace** 的 `use metrics` 权限，并配置对应 CRITICAL 告警，复用现有 OCI Notifications topic。不得授予实例管理 alarms、Notifications、Logging、IAM 或 Email Domain 的权限。Terraform 开关默认关闭，人工审核 plan、费用边界与 IAM 后才可应用。
4. 保持已批准停止阈值：任意新增 unknown/认证失败立即通知；连续 3 次配额拒绝通知；积压/连续 provider 失败按既有观测阈值提醒。原生 complaint/hard bounce/suppressed 告警不变。通知只包含稳定事件类别、计数、时间窗和环境，不复制 PII。
5. 发布失败或采集心跳缺失必须产生可见的健康失败/独立告警，不能把“没有指标”解释为“没有异常”；在告警链路未经验证时，真实邮件开关保持关闭。告警本身不自动重发、不改写 `delivery_unknown`、不自动清空 suppression。
6. 仅在 #145 新窗口获批后，才用一封受控邮件验证 OCI accepted/relayed 真实事件；应用告警的链路先以不含邮件和 PII 的合成信号验证。任何真实发送与回滚仍遵循 ADR-019。

## Alternatives considered

1. 只由操作者轮询 Docker 日志和数据库：没有独立通知，无法满足 ADR-019 的应用级告警要求；可作为短时排障手段，不作为正式告警。
2. 将整个 Docker 日志流导入 OCI Logging：可能携带人员地址或正文，扩大 PII 保留及读取面；需要额外 Agent/配置和审查，不选作首期最小方案。
3. Backend 直接向 Notifications topic 发布邮件：需要额外 topic 发布权限，且事件瞬时发送失败可能丢失；缺少连续次数和积压的统一指标视图，不选。
4. Prometheus/Grafana/APM：当前单机 Staging 运维成本和可观测数据面更大，#116 已明确不在现阶段引入常驻采集栈。

## Consequences

正面：应用异常可以复用现有 OCI 告警接收与停止流程；聚合数据库事实可在进程重启后重查；无需把收件 PII 送入自定义指标。

负面：Backend 增加 OCI Monitoring SDK/API 调用、指标费用和 IAM 维护；监控 API 故障与应用故障可能相关，因此需要心跳缺失告警及 fail-closed 发布检查。每分钟少量指标预计远低于当前免费量，但不能保证 tenancy 其他用量不会使总量超额。

## Migration impact

不修改产品数据库 schema、租户 API、人员邮箱或既有邮件状态。Backend 增加可关闭的聚合采集器和 fake 测试；Terraform 增加默认关闭的最小 IAM 与 alarms。先 mock 部署并验证合成信号，再单独批准真实发信。回滚先关闭采集配置和真实发信开关，保留历史指标/告警证据，不改写 attempt。

## Security impact

只授予当前 Staging 实例在指定 compartment/namespace 写入 metrics 的权限；不授予读取原始日志或管理告警的权限。指标名称和维度为固定白名单，值只为数值聚合，不包含 tenant、邮箱、正文、人员码或资源 ID。采集器查询只使用服务端数据库身份和固定 SQL，不接受客户端提供的过滤条件。

## Operational impact

用户已批准 Staging 专用 IAM、namespace、上述告警阈值和可能的 Monitoring 超额费用；Terraform plan 与实际订阅送达仍须留脱敏记录。告警出现时沿用 ADR-019 的立即停止/回滚 mock、按 Message-ID 人工对账流程；心跳缺失同样阻止真实发信。真实 accepted/relayed 对账仍留待 #145 的新批准窗口。

## Follow-up

1. 在 #142 内实现 fake/集成测试、Terraform、mock 模式合成告警验证与回滚，更新 `docs/architecture.md`、`docs/observability.md`、`docs/deployment.md` 和 Staging Runbook。
2. #141 的真实提交/负面权限效果、#142 的真实邮件事件及 #145 单发仍须另行安排，不因本 ADR 被接受而自动获得授权。
