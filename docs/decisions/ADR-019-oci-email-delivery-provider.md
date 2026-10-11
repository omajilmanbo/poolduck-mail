# ADR-019：使用 OCI Email Delivery HTTPS Submission 作为首个真实邮件 Provider

- 状态：Accepted
- 日期：2026-09-24
- 相关 Issue：#85, #116

## Context

Issue #85 要求在现有 `MailProvider` 抽象下接入一个经过人工批准的真实邮件 provider，同时保留
mock 作为 Local/Staging 的安全默认。真实投递还必须处理发件身份、错误分类、provider message ID、
bounce/complaint、凭据边界和安全日志，不能把 sandbox 调用直接替换成 SMTP 调用。

当前邮件链路已经具备以下安全边界：

- ADR-003 的 tenant、订阅与资源门禁在每次实际发送前重新检查；
- ADR-017 在 provider 调用前持久化 attempt 边界；调用结果不确定时进入 `delivery_unknown`，不得自动重发；
- worker 每秒最多顺序领取一批任务，Issue #116 在 mock provider 下测得的单机能力不代表 OCI 服务配额；
- 当前实现只有 `SandboxMailProvider`，`MAIL_PROVIDER` 尚未成为真实的 provider 选择器，失败结果也尚未区分
  transient、permanent、suppressed 与 unknown；
- ADR-004、现行部署文档和 Staging Runbook 仍要求默认使用 mock/sandbox。

OCI 官方当前同时支持 SMTP 和 HTTPS submission，并明确推荐新开发优先使用 HTTPS。HTTPS submission
支持 OCI 原生认证；Compute Instance Principal 可以让 VM 调用 OCI API，而不在主机保存 API key 或
SMTP 密码。`SubmitEmail` 成功响应返回 `messageId`、`envelopeId` 和 `suppressedRecipients`，适合与
现有 attempt、provider message ID 和 OCI Email Domain 日志关联。官方资料：

- [Email submission 方式](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted_topic-set-up-email-submissions.htm)
- [HTTPS SubmitEmail 配置](https://docs.oracle.com/en-us/iaas/Content/Email/Concepts/email-submission-configure-https-connection.htm)
- [Compute Instance Principal](https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/callingservicesfrominstances.htm)
- [SubmitEmail 返回模型](https://docs.oracle.com/en-us/iaas/tools/typescript/latest/modules/_emaildataplane_lib_model_email_submitted_response_.emailsubmittedresponse.html)

本 ADR 只决定 Issue #85 的实现与启用边界，不决定实际 Staging 发件域、发件地址、DNS 记录值、OCI
region 或启用时间。这些值与真实发信授权继续由人工决定。Production 接入不在本
ADR 范围内。

2026-09-29 修订：原方案要求独立的 Staging 收件地址 allowlist。用户确认人员邮箱已经由租户数据库
维护，新增人员地址若需再同步到独立清单，会形成持续的双份维护成本。因此取消独立地址清单；
此修订仅改变收件范围规则，不授权启用真实发信。

## Decision

### 1. Provider 与提交协议

1. 首个真实 provider 采用 OCI Email Delivery 的 HTTPS `SubmitEmail` API，不采用 SMTP relay。
2. 后端新增 `OciEmailDeliveryProvider`，继续实现现有 `MailProvider` 接口；mock provider 保留且为所有
   环境的默认值。
3. `MAIL_PROVIDER=oci_email_delivery_https` 是唯一真实 provider 选择值。未知值、配置缺失或不符合
   环境门禁时，后端必须 fail closed，不能静默回退为真实 provider 或猜测 region/sender。
4. 使用 OCI TypeScript/JavaScript SDK 的 Email Data Plane client。实现必须显式关闭 SDK 对
   `SubmitEmail` 的默认自动重试；重试、unknown 与终态只能由本系统的 attempt 状态机决定。
5. 每次请求只允许一个 `To` 收件人，不使用 CC/BCC，不接受客户端传入 From、Reply-To、header、region
   或 provider 选项。正文和目标地址继续来自已持久化的不可变 mail job 快照。
6. `sent` 仅表示 OCI 已接受提交，不表示邮件进入收件箱。最终 relay、bounce、complaint 是异步事实。

### 2. 认证、IAM 与配置

1. OCI Staging 使用 Compute Instance Principal，不创建或注入 SMTP credential、OCI API private key
   或用户 auth token。Local/CI 使用 fake client/contract test，不访问 Instance Metadata Service。
2. 为 Staging Compute 建立只匹配该实例的 Dynamic Group；IAM policy 仅允许在指定 compartment、指定
   approved sender/domain 上执行发送所需权限。不得把 `manage email-family`、suppression 删除权限或
   tenancy 管理权限授予运行时实例。
3. 单机上的 SSH 用户和容器共享主机安全边界；任何能控制该 VM 或访问其 Instance Principal 的主体都
   可能继承发送权限。因此继续限制 SSH 来源，Backend 以外的容器不得主动访问 OCI metadata/API，且
   policy 必须按 sender/domain 条件收窄。
4. 运行时只保存非秘密配置：
   - `MAIL_PROVIDER=oci_email_delivery_https`
   - `OCI_EMAIL_REGION=<人工批准的 region>`
   - `OCI_EMAIL_SENDER_COMPARTMENT_ID=<approved sender 所在 compartment OCID>`
   - `OCI_EMAIL_FROM_ADDRESS=<人工批准的 approved sender>`
   - `OCI_EMAIL_MESSAGE_ID_DOMAIN=<人工批准的发件域或专用子域>`
   - `REAL_MAIL_SEND_ENABLED=true`
5. 不维护独立收件地址 allowlist。收件地址只取自扫码时按 tenant/location/person 映射创建并持久化的
   `mail_job.to_email` 快照；新增人员邮箱只影响其后新建的任务，不追改已有任务。客户端、provider 配置
   和发送 API 都不能覆盖此地址。Staging 在启用真实模式前须人工核查人员数据仅含经同意的受控测试地址，
   不得包含真实客户地址；此核查是运维前提，不是运行时的第二份地址清单。
6. `REAL_MAIL_SEND_ENABLED=true` 是独立的人工启用门禁；只设置 provider 名称不得触发真实投递。

### 3. 发件域、DNS 与人工决策门禁

发件域和 DNS 由用户决定并操作。代码和 Terraform 不保存 DNS provider credential，也不硬编码 OCI
控制台生成的记录值。启用前使用实际 DNS 查询和 OCI Console 状态逐项验证：

| 决策/证据 | 责任人 | 启用要求 |
|---|---|---|
| OCI region | 用户 | 与 approved sender、Email Domain、HTTPS endpoint 和日志所在 region 一致 |
| 发件域与 From 地址 | 用户 | 域名为自有/可控域；From 已在该 region 成为 active approved sender |
| DKIM | 用户配置 DNS | 使用 OCI 为该 Email Domain 生成的 CNAME；OCI 状态为 Active |
| SPF / custom return path | 用户决定并配置 DNS | 按所选 region 和现有 SPF 合并，禁止创建第二条冲突 SPF；是否启用 custom return path 单独确认 |
| DMARC | 用户决定策略 | 初始建议 `p=none` 观察并确认所有合法发送源，再决定 `quarantine/reject`；报告邮箱必须真实可管理 |
| Staging 人员邮箱数据 | 用户 | 启用前核查仅含经同意的受控测试地址；不得使用真实客户地址，后续新增人员同样受此规则约束 |
| OCI 实际发送配额 | 用户/运维 | 尽快记录 tenancy 当前每分钟、每日和消息大小限制，用于后续调整；阶段性应用节流为全局最多 20 封/秒且无应用侧日上限，不能把它解释为 OCI 已批准配额 |
| 合规与投诉处理 | 用户 | 确认该邮件为业务通知、收件来源合法、投诉/退订和数据保留责任人明确 |
| 启用窗口与回滚人 | 用户 | 明确日期、观察窗口、停止条件与有权回滚的操作者 |

Oracle 要求 Email Domain 与 approved sender 配置在实际发送 region；DKIM active 后才能建立域级
approved sender。DNS 使用 OCI 控制台生成值，避免将其他 region 的示例值复制到实际域。DMARC 的
`p=none` 是观察起点，不代表永久策略。官方资料：

- [创建 Email Domain、return path 与 DMARC](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted_topic-create-email-domain.htm)
- [配置 DKIM](https://docs.oracle.com/en-us/iaas/Content/Email/Tasks/managing_dkim-setup_email_domain_with_dkim.htm)
- [Email Delivery region 与 approved sender](https://docs.oracle.com/en-us/iaas/Content/Email/Concepts/overview.htm)

`app.poolducktest.com` 是 Web/TLS 入口，不自动成为发件域；二者可以不同。是否复用
`poolducktest.com` 或使用专用子域由用户决定，本 ADR 不代选。

### 4. Message ID、提交结果与错误分类

1. 每个 attempt 在调用 OCI 前生成稳定、符合 RFC 5322 的 Message-ID，local part 使用 opaque
   `attempt_id`，domain 使用已批准的 `OCI_EMAIL_MESSAGE_ID_DOMAIN`。不写入 tenant code、邮箱、人员码
   或其他业务 PII。
2. 同一 attempt 的所有观察和人工对账使用同一 Message-ID；新的受控 retry 使用新的 attempt 和新的
   Message-ID。成功响应持久化 OCI 返回的 `messageId`，并在 attempt 的安全元数据中保存 `envelopeId`
   与 `opcRequestId`，字段长度与敏感性须在实现 Issue 中复核。
3. 单收件请求返回非空 `suppressedRecipients` 时，不标记为 `sent`，而是终态
   `failed/RECIPIENT_SUPPRESSED`；不得自动从 OCI suppression list 删除地址或自动重试。
4. 结果分类如下：

| OCI 结果 | 本地结果 | 自动动作 |
|---|---|---|
| 2xx，未 suppression | `sent`（含义为 provider accepted） | 不重试；等待 OCI 日志提供异步 relay/bounce/complaint 事实 |
| 明确 429/配额拒绝、可证明未接受的临时拒绝 | `queued` + `PROVIDER_TRANSIENT` | 走现有有限退避，并受 provider rate limiter 约束 |
| 明确 4xx 配置、认证、sender、recipient 或请求错误 | `failed` + 稳定安全错误码 | 不重试；告警并人工修复 |
| suppressed recipient | `failed/RECIPIENT_SUPPRESSED` | 不重试，不自动解除 suppression |
| timeout、连接中断、5xx 或无法证明未接受的响应丢失 | `delivery_unknown` | 禁止自动重发；按 Message-ID 查询 OCI accepted/relayed 日志并人工处置 |

5. Provider 不能把 OCI 原始错误、邮箱、正文、SDK request/response 或 credential 写入
   `error_message`、API 响应、日志或审计。只保存稳定错误码、HTTP/OCI 分类、attempt ID、Message-ID 和
   必要的 provider request ID。
6. 现有 provider result 类型必须扩展为显式分类，不能继续把所有 `success=false` 都重试三次。

### 5. 异步 relay、bounce、complaint 与 suppression

1. 在真实发送前必须为 Email Domain 启用 OCI `OutboundAccepted` 和 `OutboundRelayed` 日志；日志用于
   观察 accepted、relay、bounce、complaint、unsubscribe 与 suppressed。
2. Issue #85 的最小回执路径是“应用保存 Message-ID + OCI Email Domain 日志/指标 + Runbook 人工
   对账与告警”。本阶段不将 OCI 日志中的完整收件地址同步回应用数据库，也不增加公网 webhook。
3. 应用中的 `sent` 不因后续 bounce/complaint 被覆盖；异步事实保持 append-only。若以后需要在产品 UI
   展示 `delivered/bounced/complained`，必须另建 schema/API/保留期 Issue，并保持 tenant scope 与 PII
   最小化。
4. OCI 对 hard bounce、complaint 等自动加入 suppression list；系统不得绕过、批量清空或在 retry 时
   删除 suppression。解除 suppression 只能由经批准的人工 Runbook 在确认地址与原因后执行。
5. 监控至少覆盖 `EmailsAccepted`、`EmailsRelayed`、`EmailsHardBounced`、`EmailsSoftBounced`、
   `EmailsSuppressed`、`EmailComplaints`，并对 `delivery_unknown`、认证失败、配额拒绝和连续 provider
   失败设置告警。指标不得以 recipient、tenant 或正文作为标签。

OCI 官方说明 Email Domain 日志区分 accepted 与 relayed，并记录 bounce/complaint；suppression 对 hard
bounce 和 complaint 自动生效，不能 opt out：

- [Email Delivery 日志与查询](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/log-guide.htm)
- [Email Delivery 指标](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/guide-to-metrics-logs.htm)
- [Suppression list](https://docs.oracle.com/en-us/iaas/Content/Email/Tasks/managingsuppressionlist.htm)

### 6. 配额、节流与环境边界

1. 2026-09-29 用户批准阶段性应用上限：OCI provider 在所有 backend 实例之间串行预约，至少间隔
   50 ms，即最多 20 次提交/秒；不设置应用侧每日发送上限。该数字来自 #116 的 mock 应用能力，
   **不是** OCI tenancy 的每分钟或每日 service limit，也不保证不会收到 429/配额拒绝。
2. OCI 实际每分钟、每日及单封大小限额尚未核实；#139 保持开放，待取得 Console 限额并结合观察结果
   调整应用上限。OCI 429/明确配额拒绝走有限 transient 退避，不由 SDK 或 worker 无限重试；日额度
   耗尽可能导致多个任务重试后失败并产生积压，运维必须监控、暂停或回滚。用户明确接受不设应用日上限
   的阶段性风险。真实发送启用仍需要本 ADR 第 3、7 节的独立人工决策和批准。
3. Local、CI 和默认 Staging 永远使用 mock/fake，不访问 OCI、不解析真实域名、不发送邮件。
4. Staging 真实模式只用于人工批准的受控验证，必须同时满足 provider、enable flag、region、sender、
   Message-ID domain 和 Instance Principal 权限；任一缺失即启动失败或 provider fail closed。
5. Production 的域、IAM、secret、限额、数据、发布和回滚必须另行批准，不能复制 Staging 开关直接启用。

### 7. 部署、验证与回滚顺序

1. 人工接受本 ADR；Accepted 前不实现 provider、IAM、DNS 或部署变更。
2. 实现 provider selector、OCI adapter、错误分类、无自动 SDK retry、rate limiter 和 fake contract tests；
   Local/CI 全程 mock/fake。
3. 更新配置、运行手册、监控和回滚文档；代码合并后 Staging 仍保持 `MAIL_PROVIDER=mock`。
4. 用户决定 region、domain、From、SPF/DKIM/DMARC、实际配额和启用窗口，并核查 Staging 人员邮箱数据；运维创建 Email
   Domain、approved sender、Dynamic Group、最小 IAM policy 与日志/告警。
5. 在 Backend 容器内只做 Instance Principal 身份与 `GetEmailConfiguration`/受限权限预检；不得用真实
   客户地址做探测。
6. 经再次人工批准后，在受控窗口切换真实模式，只发送一封到已核查的受控测试人员邮箱；确认应用 attempt、OCI
   accepted、relayed、DKIM/SPF/DMARC 和收件结果，再执行小批量验证。
7. 出现误收件、收件地址与任务快照不符、认证异常、`delivery_unknown`、complaint、连续 bounce、配额异常或日志
   缺失时立即回滚为 mock，停止领取新的真实发送 attempt，并按 Message-ID 对账在途任务。
8. 回滚不能把 `delivery_unknown`、suppressed 或 failed 任务改回 queued，也不能删除 provider 回执。

## Alternatives considered

1. **OCI SMTP relay + SMTP credentials**
   - 可使用成熟 SMTP 库，但需要在 Staging VM 保存长期 SMTP username/password，并自行保证 TLS、认证和
     轮换；Oracle 当前也建议新开发优先 HTTPS，因此不选。
2. **HTTPS SubmitEmail + OCI API key 文件**
   - 能调用相同 API，但需要分发、保存和轮换用户私钥；Staging 已运行在 OCI Compute，可用 Instance
     Principal 消除该静态 secret，因此不选。
3. **继续只使用 mock provider**
   - 安全且测试稳定，但不能完成 #85 的真实投递、域认证和回执验证目标。
4. **直接接入 Gmail、SendGrid、AWS SES 等 provider**
   - 可能有不同的 sandbox/webhook 能力，但会增加第二个云控制面和新的 credential/费用边界；当前用户
     已选择 OCI 原生服务，因此不选。
5. **在 #85 内实现完整的 OCI 日志采集与产品级 delivery 状态**
   - 可让 UI 显示最终投递，但会引入 Logging API 权限、PII 保留、schema、轮询/幂等和 tenant 关联的新
     设计，超过首个真实 provider 的最小安全范围；先采用 Message-ID + OCI 日志/指标的运维路径。
6. **依赖 SDK 默认 retry**
   - 实现简单，但 `SubmitEmail` 没有由本 ADR 可依赖的幂等键保证；响应丢失时自动 retry 可能重复发信，
     与 ADR-017 的 `delivery_unknown` 决策冲突，因此不选。
7. **独立的 Staging 精确地址 allowlist**
   - 能提供第二道地址限制，但会与租户人员邮箱形成双份维护；新增人员若未同步就无法验证真实发信。
     2026-09-29 人工决定不采用。相应误发风险改由 Staging 测试数据准入、显式真实发送开关、
     单封/小批量人工验证及监控回滚承担；这些措施不等同于独立地址技术门禁。

## Consequences

正面影响：

- 真实 provider 继续位于现有抽象后方，Local/CI 和默认 Staging 保持安全、稳定的 mock 行为；
- Instance Principal 避免在 VM 保存长期 SMTP/API credential，并保留 OCI Audit 可追溯性；
- stable Message-ID、OCI response 和 Email Domain 日志形成 accepted、relay、bounce、complaint 对账链；
- 明确区分临时、永久、suppressed 与 unknown，避免无差别 retry 造成重复或信誉损伤；
- 发件域、DNS 和真实启用继续由人控制，接受设计不等于授权发信。
- 新增受控测试人员邮箱后无需同步第二份地址清单。

负面影响：

- 新增 OCI SDK、IAM Dynamic Group/policy、域配置、DNS、日志、告警和 Runbook 的维护成本；
- Staging 单 VM 的 Instance Principal 权限继承主机安全边界，必须持续限制 SSH 和最小 IAM；
- `sent` 只代表 OCI accepted，应用 UI 暂时不展示最终 delivered/bounced/complained；
- 保守的 `delivery_unknown` 策略可能产生少量需要人工对账的漏发，但避免不可证明安全的自动重复投递；
- OCI 配额可能显著低于 #116 的 mock worker 容量；阶段性 20 封/秒且无应用日上限可能导致 429、
  每日额度耗尽、任务失败及积压，须按 #139 后续实测限额调整。
- 取消独立收件地址技术门禁后，Staging 误录或误改人员邮箱会直接扩大真实发信范围，必须在启用前和
  后续维护中严格管控测试数据，并保留停止发送与对账能力。

## Migration impact

- 本 ADR 本身不修改 schema、代码、OCI、DNS、Local、Staging 或 Production。
- 2026-09-29 用户批准 #137 仅为 `mail_delivery_attempts` 增加三个可空专用字段：`rfc_message_id`、
  `envelope_id`、`opc_request_id`。历史及 mock attempt 不回填；现有 `provider_message_id` 保存 OCI `messageId`。
  标识与 attempt 同保留期，不保存 OCI 原始请求/响应。OCI 配置仍仅位于容器环境变量，不入数据库。
- schema rollback 若已有任一标识则拒绝删除；应用回滚保留这些列以供人工对账。
- Provider result contract、依赖注入、环境校验、worker retry 分类和测试需要兼容性修改。
- Staging 部署先发布“仍为 mock”的兼容代码，再由独立人工步骤创建 OCI 资源和切换配置。
- 回滚为 `MAIL_PROVIDER=mock` 不回写历史 OCI attempt，不删除 Message-ID、回执或审计。

## Security impact

- tenant、location、subscription、person/resource 门禁继续在 provider 调用前执行；provider 不接受客户端
  tenant、sender 或目标地址覆盖。
- Instance Principal 只授予发送所需最小权限并限制 sender/domain/compartment；不授予 suppression 删除、
  DNS、IAM 或 tenancy 管理权限。
- Staging 收件地址必须来自 tenant-scoped 人员映射生成的不可变 mail job 快照；不得用客户端参数或
  provider 配置替换。没有独立地址 allowlist，因此数据库人员邮箱的写入权限和测试数据核查直接影响
  真实发信范围；tenant、订阅和资源门禁仍须在每次发送前重新检查。
- 日志、指标、审计和错误响应不得记录完整邮箱、正文、token、Cookie、OCI credential 或 DNS credential。
- OCI 服务日志会包含 sender/recipient，必须按含 PII 的运维数据控制读取权限和保留期。
- SPF/DKIM/DMARC 降低冒用与信誉风险，但不替代收件人合法来源、最小发送、投诉处理和误发响应。

## Operational impact

- 运维新增 Email Domain、approved sender、DKIM、可选 custom return path、Dynamic Group、IAM policy、
  Email Domain logs、metrics、alarms 和 service-limit 管理。
- 发布前必须保存不含秘密/PII 的证据：代码 commit、region、sender/domain 的状态摘要、DNS 验证结果、
  当前配额、Staging 人员邮箱数据已核查但不展示地址、告警就绪和回滚人。
- smoke 只使用人工批准的合成内容与已核查的受控测试人员邮箱；先单封，再小批量，不使用客户数据。
- 故障排查以 attempt ID、Message-ID、envelope ID、OCI request ID 和时间窗口关联应用与 OCI 日志；
  不把完整邮箱复制到 Issue/PR/聊天。
- OCI 限额、accepted/relayed 差值、bounce、complaint、suppressed 和 `delivery_unknown` 是上线后的核心信号。

## Follow-up

本 ADR 经人工改为 Accepted 后，按以下顺序拆分或更新 Issue；每项继续遵守 #85 Scope：

1. Backend：provider selector、OCI HTTPS adapter、Instance Principal auth、无自动 SDK retry、稳定
   Message-ID、结果分类、suppression 与 rate limiter；
2. Test：fake OCI client contract、配置缺失、IAM/auth、2xx、suppressed、429、4xx、5xx/timeout unknown、
   tenant/订阅/资源门禁、任务收件快照来源、敏感日志和 mock 回归；
3. Infrastructure/operations：最小 Dynamic Group/IAM、Email Domain logs/metrics/alarms、配额记录和回滚；
4. Docs：按实际影响更新 `docs/architecture.md`、`docs/deployment.md`、`docs/environments.md`、
   `docs/inventory/`、`docs/operation.md`、`docs/observability.md`、`docs/testing.md` 和 Staging Runbook；
5. 人工决策：用户填写本 ADR 第 3 节表格中的 region、发件域、From、SPF/DKIM/DMARC、
   配额、合规责任人和启用窗口，并核查 Staging 人员邮箱数据；
6. Staging 启用：另一次明确批准后执行单封和小批量验证；本 ADR Accepted 或代码合并都不自动授权；
7. 后续可选 Issue：把 OCI relayed/bounce/complaint 日志同步为 tenant-scoped、append-only 的产品状态。

最低测试矩阵：

- 正常：mock 默认、OCI 2xx、Message-ID/envelope ID 持久化、单收件人、accepted 与 relayed 对账；
- 错误：配置缺失、非法 region/sender、401/403、429、请求 4xx、suppressed、timeout、5xx、响应丢失；
- 重试：只有明确 transient 才按现有有限退避；SDK 不暗中 retry；unknown 不自动重发；
- 隔离：跨 tenant/job/attempt 不可读取或改变，客户端不能指定 From、recipient、region 或 provider；
- 安全：人员邮箱新增后新任务可使用该地址，已有任务快照不变；日志/API/审计不含邮箱、正文、credential，
  容器外无多余 IAM 权限；
- 运维：配额节流、queue backlog、accepted/relayed、bounce/complaint/suppressed、unknown 告警与 mock 回滚。

2026-09-29 人工接受记录：用户确认接受 ADR-019，并要求将上述 Follow-up 拆分为 Issue。
实施与验证跟踪为 #136–#145；可选产品级异步投递状态设计为 #146。真实 Staging
发件域、DNS 与启用窗口仍由用户另行决定和批准。

2026-09-29 人工修订记录：用户取消独立 Staging 收件地址 allowlist，改为由租户数据库人员邮箱生成
不可变任务收件快照；理由是避免新增人员地址时持续维护第二份清单。用户知悉失去第二道地址技术门禁，
真实发信仍需按本 ADR 另行批准；#136 及后续 Issue 的验收要求同步更新。

2026-09-29 #137 schema 批准记录：用户批准上述三个可空标识字段，并明确 OCI 发送配置只放在
容器 OS 环境中。#137 仅实现 SDK adapter、标识持久化和 fake 验证；在 #138 结果分类与 #139
配额节流完成前，真实 provider 选择仍 fail closed，不授权实际发信。

2026-09-29 #139 人工修订记录：用户明确批准将阶段性 OCI 应用上限设为全局 20 封/秒，
暂不设应用侧每日上限，并要求 #139 保持开放以便依据实际 OCI 配额随时调整。用户知悉该值可能
高于未核实的 OCI 限额及日额度耗尽风险；此决定不选择发件域/DNS，也不授权切换真实 provider。
