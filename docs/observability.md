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

### 5.1 API 5xx 与 p95 的本机核验

在候选 `a052518` 上，Staging Caddy 将 `/api/*` 转发给 Backend，#116 的延迟与超时计数来自压测客户端。邮件 worker、#142 的 OCI 指标及 #126 的扫码拒绝各有独立范围。#227 在 Backend 的现有 Nest Logger 增加 `api.minute`，供本机按进程复核两个 API 阈值。

直接启动 Backend 进程时，显式传入 `API_METRICS_ENABLED=true` 即开始观测。默认关闭，取消该变量或改为 `false` 后重启进程即停用。启用时，每个进入 Backend `/api` 前缀的请求，从 CORS、解析请求体与鉴权之前开始，以单调时钟计至 HTTP 响应的 `finish`（数据交给底层系统）。每次完成按最终状态计一次，含预检、解析失败、未匹配路由和权限拒绝。分母排除健康探针 `/health`、代理自行产生的错误，以及完成前断开的连接。这个口径衡量服务端处理时间，客户端收到响应的时间另见 #116。

每个进程从启用时起按 60 秒分桶，按**完成时刻**归入左闭右开区间。每个已结束的桶最多一条日志。聚合事件仅使用下表字段，省略 §3 的逐请求关联信息。请求与响应内容、原始 URL、凭据、身份和业务资源均不进入观测数据。

| 字段 | 核对方法 |
|---|---|
| `event`、`windowStart` | 固定事件名 `api.minute` 和该桶起点的 UTC 时间。 |
| `requests`、`serverErrors`、`over2s` | 本分钟已完成的请求数、最终状态 500–599 的数量、耗时严格超过 2,000 ms 的数量。 |
| `fiveMinute5xxBreach` | 在最近五个连续完整桶中分别求请求数与 5xx 数之和。总请求数至少 10 且 5xx 占比 ≥5% 时为 `true`，可判定但未触线时为 `false`。窗口未满或总数不足为 `null`。 |
| `slowP95Minutes` | 连续多少个非空分钟的 p95 >2 秒，最多记到 10。按最近秩定义，排序后的第 `ceil(0.95 × requests)` 个耗时超过 2 秒，等价于 `20 × over2s > requests`。相等、空桶或低于阈值会中断连续性，达到 10 才满足表中的延迟条件。 |

看到 `requests > 0` 且 `serverErrors = 0` 可确认本分钟观测到零个 5xx。空桶表示观测开启、本分钟没有完成请求，错误率和 p95 均无样本。停用、日志丢失或进程退出都可能导致缺行。若定时器与响应回调同时延迟并跨过整分钟，只发布已有桶，跳过的分钟留缺口并重置连续窗口。重启会丢弃尚未结束的桶并重新预热。核对时只使用同一进程、同一次运行的连续记录。多进程的起点可能不同，分别判读，不能跨进程拼接连续分钟或平均 p95。

**本机复验。** 在已安装锁定依赖的 `backend/` 下执行 `npm test -- --runTestsByPath test/api-metrics.spec.ts`。夹具在本机回环地址启动 AppModule，使用 mock 邮件和数据库替身。启用、显式关闭和未配置时均应收到 201、401、503、404、400、204，登出均清除两枚 Cookie。开启时首条记录应为 `requests=6, serverErrors=1, over2s=1`，关闭时无该事件。固定时钟用例另核对 9 次请求、5xx 比例 1/20 与 1/21、p95 恰为 2 秒与连续超过 2 秒十分钟，以及缺样与重启。目标环境采集、通知送达和恢复仍须分别验收。

#### 本机 Compose 的启用与撤回

标准 `docker-compose.yml` 未将此开关映射进容器。即便在宿主环境或项目 `.env` 中设置为 `true`，Backend 仍按默认值关闭。要传入开关，可在仓库根目录用 PowerShell 创建临时 overlay。下例沿用本机项目 `poolduck-mail-local` 和它的 `.env`。如启动时指定了其他项目名或环境文件，在 `$base` 中填入原值，启用和撤回都复用它。

```powershell
$base = @('-p', 'poolduck-mail-local', '--env-file', '.env', '-f', './docker-compose.yml')
$overlay = (New-TemporaryFile).FullName
@'
services:
  backend:
    environment:
      API_METRICS_ENABLED: "true"
'@ | Set-Content -LiteralPath $overlay -Encoding ascii
$enabled = $base + @('-f', $overlay)

function Show-ApiMetricsFlag([string[]]$composeArgs) {
    $config = docker compose @composeArgs config --format json | Out-String | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Compose config failed' }
    foreach ($service in 'backend', 'frontend') {
        $flag = $config.services.$service.environment.PSObject.Properties['API_METRICS_ENABLED']
        $value = if ($flag) { $flag.Value } else { '<unset>' }
        "$service API_METRICS_ENABLED=$value"
    }
}
Show-ApiMetricsFlag $base     # backend=<unset>，frontend=<unset>
Show-ApiMetricsFlag $enabled  # backend=true，frontend=<unset>
```

预检只输出两个服务的该字段，无需 Docker 引擎。仅复验配置时，`--env-file` 可指向一个空文件，检查完后用 `Remove-Item -LiteralPath $overlay` 清理。实际启用时用项目原有环境文件执行上面的预检，核对结果与注释一致，确认本机已有包含 #227 的 Backend 镜像且 PostgreSQL 已就绪，然后只重建 Backend 容器。环境变量在创建容器时生效。

```powershell
docker compose @enabled up -d --no-deps --no-build --pull never --force-recreate backend
```

撤回时先确认基础配置下两项均为 `<unset>`，再用同一项目和基础文件重建 Backend，成功后删除临时 overlay。

```powershell
Show-ApiMetricsFlag $base
docker compose @base up -d --no-deps --no-build --pull never --force-recreate backend
if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath $overlay }
```

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

#142 的 OCI `OutboundAccepted`/`OutboundRelayed` 日志、`oci_emaildelivery` 指标、告警接收人、PII 权限与保留期、人工对账及测试步骤见 [OCI Staging 准入清单](oci-mail-staging-readiness.md)。2026-10-11 至 10-14 的记录确认当时的 90 天保留审批、指定读取人与告警接收人、两类日志、通知主题、原生告警及合成通知送达。当前权限、日志与通知链路以目标环境当次核验为准。本文件前述 Staging 30 天仅为应用日志建议。`sent` 只表示 provider accepted，`delivery_unknown` 不自动重发。

应用级异常进入 OCI Monitoring 的方案见 Accepted [ADR-020](decisions/ADR-020-staging-mail-application-alerts.md)。Backend 每分钟在 Staging 显式启用后向 `poolduck_staging_mail` 发布 7 个聚合指标（unknown、认证、配额新增/连续、provider 连续失败、积压、心跳），固定部署级维度且不含 PII；Terraform 以专用 namespace 和 `METRIC_WRITE` 条件限制写入权限并定义 CRITICAL 告警。2026-10-11 已将 1 条 IAM、6 条告警应用到 OCI，并以 mock 模式部署 Backend，云端可查询到 7 类指标；无邮件的合成认证失败触发 `FIRING`，指定 Gmail 收件箱可查到告警通知。2026-10-14 收紧 IAM 后，从目标容器读取指标返回 404，后续写入与心跳仍待当次核验。事件型告警采用 5 分钟查询窗覆盖指标摄取延迟。2026-10-16 的 #145 受控单封在当次窗口观察到 accept/relay，之后回滚 `mock/false`。见 [脱敏执行记录](testing/staging-oci-mail-single-send-2026-10-16.md)。

## Production 租户终结清理信号（#163）

启用后每分钟产生不含 PII 的 `tenant_purge_metrics` 结构化日志，字段为 `pending`、`oldestOverdueSeconds`、`purged`、`failed`、`skipped`。环境错误、扫描失败、事务失败与最老逾期超过 15 分钟产生 `tenant_purge_alert`；告警只含安全原因码和可选内部 tenant UUID。生产发布时须把此事件接入经批准的日志告警/值班路由并验证通知；本地实现只产生结构化事件，没有部署生产告警资源。Success 审计为 `platform.tenant.purged`，记录内部 ID 和清理计数；失败记录通用原因码，禁止输出原始数据库异常或客户明细。

本地 #166 验收只检查结构化事件及测试数据库中的审计字段，不接入真实告警接收方。Production 放行前应以合成到期任务验证告警路由、值班收件与恢复通知；任何 `TENANT_TRANSACTION_FAILED`、持续积压或环境错误必须可追溯到内部 tenant UUID 和安全原因码，且不得把 PII 写入日志。

## ADR-024 记录销毁信号（#171–#173）

`RECORD_RETENTION_PROCESSOR_ENABLED` 默认关闭。启用后每轮记录 `record_retention_metrics`：扫码家族、业务审计、平台审计的删除计数与剩余积压、被阻断计数、不安全逾期家族数量、最老逾期秒数及失败数。`record_retention_alert` 只含安全原因码；未终态、有在途调用或 `delivery_unknown` 尚未确认调用关闭的逾期家族、数据库失败、审计写入失败、错误环境与逾期积压必须告警。平台执行审计 `platform.record_retention.run` 仅留汇总计数，不复制被销毁的快照、邮件地址或正文。Production 告警接收方与灰度发布仍须在 #176 独立核对。

平台审计只读查询会记录最小 `platform.audit.query` 事件；查询写审计失败则 API 不返回记录。告警路由、发布前后无 PII 计数与停用步骤见 [ADR-024 发布执行卡](testing/adr024-release-acceptance.md)。
