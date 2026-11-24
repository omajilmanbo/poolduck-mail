# OCI Email Delivery Staging 准入清单（#141–#143）

值守操作请先使用 [OCI Staging 真实邮件执行卡](oci-mail-staging-operator-runbook.md)；
本页保留设计理由、详细证据与排障参考，不要求操作者在执行时记忆全文。

2026-11-24 的文档复核使用下列历史证据。目标环境实际生效的 provider、真实发送开关、IAM、指标采集和告警心跳仍待当次运行态核验。测试邮箱控制权、接收同意及执行卡审阅属于既有窗口的记录。2026-10-14 的 10 分钟窗口在预检阶段停止，未切换或发信；2026-10-16 新批准窗口完成一封受控真实邮件，OCI 出现 accept/relay 且收件人确认收到，随后在当次窗口恢复 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，详见 [脱敏测试记录](testing/staging-oci-mail-single-send-2026-10-16.md)。Staging 当次起点 commit 为 `45fbaf9`，限流器热修复当时尚未提交；下一次真实启用仍须独立批准。Local/CI 不访问 OCI。`sent` 只表示 OCI accepted，不表示 relay 或到达收件箱。依据 [ADR-019](decisions/ADR-019-oci-email-delivery-provider.md)。

2026-10-14 配置准备：Staging `.env` 已预置批准的 `OCI_EMAIL_REGION`、`OCI_EMAIL_SENDER_COMPARTMENT_ID`、`OCI_EMAIL_FROM_ADDRESS`、`OCI_EMAIL_MESSAGE_ID_DOMAIN` 四项非秘密值，并显式保留上述 mock/false 双门禁；旧 `.env` 已以权限 600 备份。仅重建 Backend 后容器健康，`/health` 返回 200，运行中的七项相关配置逐项核对通过；未调用 `SubmitEmail`。[ADR-021](decisions/ADR-021-oci-https-submit-authorization-verification.md) 已被用户驳回，不作为准入依据。

2026-10-11 已批准并执行的资源选择：Staging region 为 `ap-tokyo-1`，发件子域为 `mail.poolducktest.com`，精确 From 为 `no-reply@mail.poolducktest.com`。Email Domain、DKIM selector `stg202610` 与 approved sender 在该 region 的实时只读复核均为 `ACTIVE`；前两项由现有资源导入 Terraform state，sender 经完整 plan 核查后由 Terraform 创建。DKIM CNAME 和发件子域的 `p=none` DMARC TXT 已由权威 DNS 查到；不在仓库硬编码 OCI 生成的记录值或 DMARC 报告邮箱。用户决定暂不启用 custom return path，采用 OCI 亚太区推荐的发件子域 SPF；权威 DNS 已返回完整且唯一的 SPF TXT。已定位唯一 `test1` 地点：地点及其 1 条人员记录均为 active，人员邮箱域名为 Gmail；所属租户与订阅均 active，订阅在有效期内。用户更正了先前笔误后，数据库中的人员邮箱与用户指定的受控测试地址精确匹配；仓库不记录完整地址；用户已确认该邮箱由其控制并同意接收受控单发测试。用户批准 OCI 原始邮件日志可保留 90 天并接受超出免费存储额度后的可能费用；用户当时指定唯一 OCI 用户作为日志读取人、告警接收人与回滚责任人；OCI API 已核验其为唯一 ACTIVE 用户并属于 `Administrators`，未给运行实例新增日志读取权限；若增加管理员须复核日志访问边界。保守停止规则已获批准；用户撤销“暂不应用 IAM”后，Terraform 已创建只匹配当时的目标 Staging VM 的 Dynamic Group 和精确 sender policy；两者均为 `ACTIVE`，完整 plan 为 `No changes`。**当日两类 90 天日志、通知主题及三条 OCI 原生异常告警已应用，真实发送仍关闭。** OCI Limits API 在该 region 返回 `sendrate=18000`（每分钟）、`max-emails-day=50000`（每 24 小时）、`max-message-size=2008192` 字节；Staging compartment 的 resource-availability 接口对这三项返回空值，故仍须在启用前核查账户类型、有效 quota 和成本，不能把这些值当作已验证的可持续发信容量。OCI [Email Domain 创建说明](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted_topic-create-email-domain.htm)与 [DKIM 步骤](https://docs.oracle.com/en-us/iaas/Content/Email/Tasks/managing_dkim-setup_email_domain_with_dkim.htm)说明 DNS 和发件域要求。

2026-10-16 更新：上段为单发前的配置盘点。受控单封已证明目标容器的 HTTPS `SubmitEmail` 正向权限效果，但不能证明其他身份或 sender 的负面权限边界；#141 保持开放。OCI 有效 compartment quota 仍未核实，#139 按用户决定保持开放；本次单封不得解释为容量验收。

## 1. 人工决策与只读盘点

由操作者在 OCI Console 确认并在受控变更记录中保存：Staging tenancy/region、实例 OCID、实例 compartment、Email Domain、approved sender 及其 compartment、发件域 DNS 状态、实际分钟/每日/单封大小限额、日志读取运维角色与保留期、Notifications 接收人、停止阈值、启用窗口和回滚责任人。仓库、Issue、PR 与聊天只记录资源类型、状态、计数和脱敏证据，不记录完整人员邮箱、邮件正文、凭据或原始 OCI 日志。

核对 Terraform state/Console 中的实例与 compartment、approved sender 的 region/地址/Active、Email Domain DKIM Active，以及 SPF/DMARC 的实际 DNS。`app.poolducktest.com` 仅是 Web 入口，不默认是发件域。Staging 人员邮箱只可包含获同意的受控测试地址；不维护第二份运行时 allowlist，任务目标只取不可变 `mail_job.to_email` 快照。数据库核查只保存记录数与复核人结论，不导出地址名单。

## 2. #141 Instance Principal 最小权限与验收证据

Terraform 在 tenancy 根声明只匹配目标 Staging Compute 实例的 Dynamic Group。匹配规则如下。

```text
instance.id = '<APPROVED_STAGING_INSTANCE_OCID>'
```

发信 policy 声明在 tenancy 根，其语句将授权范围限定到指定 sender compartment 及精确的地址和域。仓库声明如下。

```text
Allow dynamic-group <STAGING_MAIL_DG> to use approved-senders in compartment id <SENDER_COMPARTMENT_OCID> where all {target.approved-sender.emailaddress = '<APPROVED_FROM_ADDRESS>', target.approved-sender.email-domain = '<APPROVED_EMAIL_DOMAIN>'}
```

以下三项对应 [#141 原始验收条款](https://github.com/omajilmanbo/poolduck-mail/issues/141)。静态复核基线为 `a052518`。历史证据仅覆盖所列日期和执行范围。

| 验收条款 | 候选源码 | 历史证据 | 尚缺证据 |
|---|---|---|---|
| AC1. policy 仅覆盖已批准 sender/domain、Staging compartment 和实例 | [邮件 IaC](../infrastructure/oci-staging/email-delivery.tf) 用同一[默认关闭的开关](../infrastructure/oci-staging/variables.tf)控制 Dynamic Group 和发信 policy。匹配指向目标 Compute。发信语句使用 `use approved-senders`，同时限定 compartment、地址和域。ADR-020 的独立指标 policy 复用该组，限定专用 namespace 和 `METRIC_WRITE`。 | 10 月 11 日先验证了默认关闭时的候选配置，获批后应用了单实例组与精确 policy，部署摘要记录完整 plan 无差异。10 月 14 日复核了 tenancy 根和 sender compartment 的相关语句及唯一 ACTIVE approved sender。[10-11 配置记录](https://github.com/omajilmanbo/poolduck-mail/issues/141#issuecomment-6106051669) · [部署摘要](../infrastructure/oci-staging/README.md) · [10-14 控制面复核](https://github.com/omajilmanbo/poolduck-mail/issues/141#issuecomment-6161198460) | 当前控制面配置、实际生效权限、非目标 sender 的 HTTPS 拒绝效果和撤销生效结果均待核。历史单封提供批准 sender 的正向证据。 |
| AC2. Backend 能在受控 preflight 中使用 Instance Principal；无关身份不能发信 | [OCI adapter](../backend/src/mail-jobs/oci-email-delivery.provider.ts) 使用 OCI SDK 的 Instance Principal builder。Dynamic Group 的实例匹配限定了这条授权语句的适用身份。 | 10 月 11 日与 14 日目标容器的身份获取通过。10 月 14 日的预检停在 mock，HTTPS 权限映射和负面效果当时未明。10 月 16 日 #145 在独立窗口验证当时版本的正向 HTTPS 提交及收件，随后回滚 `mock/false`。[10-11 应用与身份](https://github.com/omajilmanbo/poolduck-mail/issues/141#issuecomment-6106775360) · [10-11 发布](testing/staging-oci-mail-release-2026-10-11.md) · [10-14 权限记录](https://github.com/omajilmanbo/poolduck-mail/issues/141#issuecomment-6159925292) · [10-14 预检](testing/staging-oci-mail-admission-2026-10-14.md) · [10-16 单封](testing/staging-oci-mail-single-send-2026-10-16.md) | 受控身份预检已有历史证据。无关身份的实际拒绝效果仍待验证，候选版本的运行态未复验。10 月 14 日的指标读取 404 仅涉及 Monitoring 权限。 |
| AC3. 私钥、SMTP 密码和 auth token 不进入 Git、Terraform state、cloud-init 或日志 | [Terraform provider](../infrastructure/oci-staging/versions.tf) 和邮件 IaC 未声明 OCI 邮件静态凭据输入。OCI HTTPS 由实例身份认证，Compose 使用[非秘密配置字段](../.env.example)。[cloud-init](../infrastructure/oci-staging/templates/cloud-init.yaml.tftpl) 的邮件 API key 是旧 sandbox 占位符，OCI HTTPS 不使用该字段。[`.gitignore`](../.gitignore) 覆盖 `.terraform/`、默认命名的 `terraform.tfvars`、`terraform.tfstate` 及其备份、`tfplan`。自定义变量和计划文件名需核对忽略规则。 | 10 月 11 日和 14 日的脱敏预检记录确认未输出凭据或 token。10 月 16 日的记录只保留脱敏测试结果。[10-11 应用与身份](https://github.com/omajilmanbo/poolduck-mail/issues/141#issuecomment-6106775360) · [10-14 预检](testing/staging-oci-mail-admission-2026-10-14.md) · [10-16 单封](testing/staging-oci-mail-single-send-2026-10-16.md) | 静态检查限于相关 Git 跟踪配置。实际 state、已渲染 user data、运行时日志及容器内凭据文件或变量状态未核验。 |

#141 保持开放。10 月 14 日的 HTTPS 权限映射疑问保留在历史评论中。10 月 16 日的单封支持当时获准路径的正向效果，其他身份和 sender 的拒绝效果仍待验证。

[ADR-019](decisions/ADR-019-oci-email-delivery-provider.md) 与 [ADR-020](decisions/ADR-020-staging-mail-application-alerts.md) 为 Accepted。[ADR-021](decisions/ADR-021-oci-https-submit-authorization-verification.md) 为 Rejected。后续发送按 [执行卡](oci-mail-staging-operator-runbook.md) 确认当次预检和独立批准。

只读身份预检：先在目标 Backend 容器核对 OCI SDK 能取得 Instance Principal，且没有 API key/SMTP credential 文件或环境变量；如需调用 `GetEmailConfiguration`，仅在另行批准其 `EMAIL_CONFIGURATION_READ` 的精确条件后进行。预检不得调用 `SubmitEmail`、输出认证 token 或打开 SDK debug。检查 VM/容器对 metadata 的访问边界；单 VM 上能控制宿主机的主体可能继承实例身份，不能把容器隔离当作独立 IAM 边界。

权限复核只留存脱敏结果，包括匹配规则、发信语句的范围、额外授权检查和已有正负向证据。缺项标为待验证。撤销顺序：若已进入真实模式，先按第 5 节回滚 mock；再撤销发信 policy，确认权限失效。停用或删除 Dynamic Group 前核对 ADR-020 的指标写入 policy 对该组的依赖。不要删除历史审计或 OCI Email Domain 日志。Dynamic Group 规则变化可能有传播延迟，撤销验证必须等待 OCI 实际生效。

## 3. #142 OCI 日志、指标和告警

2026-10-11 的变更记录与 10 月 14 日预检记录覆盖了批准的 Email Domain 下的 `OutboundAccepted` 与 `OutboundRelayed` 两类日志。前者含成功、拒绝、suppressed 的提交事件，后者含 relay、hard/soft bounce、complaint 等异步事件。OCI Email Domain 原始日志可能包含完整 sender、recipient 和错误文本；仅经批准的运维角色可读，Backend Instance Principal 不获 Logging 读取权限，普通应用日志、Issue/PR、告警通知只保留聚合计数及安全错误码。用户当时批准 90 天保留及可能费用。10 月 14 日实测两类日志均启用、状态为 `ACTIVE`，保留期为 90 天。既有记录中的读取人为当时的指定管理员。管理员或读取范围变化时重新审查该边界。OCI Logging 前 10 GB/月免费不代表 90 天必定免费。[Oracle 价格页](https://www.oracle.com/manageability/pricing/)；默认 Staging 应用日志的 30 天建议值不自动适用于 OCI 原始邮件日志。

在 OCI Monitoring 的 `oci_emaildelivery` namespace，按已批准 sender `resourceId` 或域 `resourceDomain` 查看 `EmailsAccepted`、`EmailsRelayed`、`EmailsHardBounced`、`EmailsSoftBounced`、`EmailsSuppressed`、`EmailComplaints`。只使用 OCI 原生 sender/domain 维度，不把 recipient、tenant、正文或 Message-ID 做指标标签。Terraform 声明按精确 sender 过滤的 complaint、hard bounce、suppressed 三条 CRITICAL 原生指标告警，并使用同一 OCI Notifications 主题。ADR-020 应用侧新增 `poolduck_staging_mail` 专用 namespace：每分钟聚合 `delivery_unknown`、`OCI_AUTH_REJECTED`、`OCI_QUOTA_REJECTED` 新增/连续次数、provider 连续失败、到期积压和采集心跳；无 PII/tenant/job/attempt 维度。Terraform 声明 1 条限定 `METRIC_WRITE` 的 IAM 和 6 条应用告警，事件型告警采用 5 分钟查询窗。2026-10-11 在 mock 模式观察到 7 类指标，合成认证失败触发 FIRING，指定接收人收到 OCI 通知。2026-10-14 目标容器读取指标返回 404，后续写入、心跳和通知链路待按当次环境核验。

已批准的受控测试停止规则：任意误发、complaint、hard bounce、suppressed、`delivery_unknown`、认证失败、日志缺失或跨租户/收件快照不符，或连续 3 次配额拒绝，均由指定运维人员立即停止真实发送并回滚 mock。OCI 原生告警覆盖 complaint、hard bounce、suppressed；ADR-020 应用告警部署后覆盖 unknown、认证、配额连续 3 次、provider 连续 3 次、积压超过 5 秒及心跳缺失 5 分钟，但**没有自动停发或自动回滚**。告警默认只在状态变化时通知，不重复发送；无替补值班人，故不得无人值守启用真实发信。`EmailsAccepted` 不等于实际投递，`EmailsRelayed` 也只代表收件域接收，不能据此宣称进入收件箱。

日志对账由有权限的运维人员在 OCI Logging Search 以选定域与短 UTC 窗口查询，并按 `data.messageId` 对应本地 attempt 的 `rfc_message_id`；使用 `envelope_id` 和 `opc_request_id` 辅助定位。先查 `OutboundAccepted` 的 `data.action='accept'` 与 `data.errorType`，再查 `OutboundRelayed` 的 `data.action='relay'|'bounce'|'complaint'` 和 bounce `data.errorType`。对 `delivery_unknown` 即使未查到日志也**不得自动重发**：可能是采集延迟或响应丢失，须扩大时间窗并人工裁定。查询结果只在受控 OCI 界面查看，证据仅保留时间窗、标识是否匹配、事件类别与计数，不复制原始记录。

2026-10-16 的 [受控单封](testing/staging-oci-mail-single-send-2026-10-16.md) 已观察到同一邮件的 accept 和 relay。后续窗口仍按当次范围核对日志和应用标识。10 月 11 日的记录确认 OCI Notifications 订阅当时为 ACTIVE，指定运维收件人收到不含 PII 的合成通知。异常告警的合成通知证据与受控单封的 accept/relay 证据分别记录。验证失败时保持或回退 mock。回滚告警/日志配置时先保留法定或批准的历史证据，不直接删除含 PII 的历史日志；撤销新增规则/权限由运维按变更记录执行。

参考：[OCI 日志类型与查询](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/log-guide.htm)、[Email Domain 日志字段和 PII](https://docs.oracle.com/en-us/iaas/Content/Logging/Reference/details_for_emaildelivery.htm)、[指标名称](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/metricsalarms_topic-Available_Metrics_oci_emaildelivery.htm)、[启用日志](https://docs.oracle.com/en-us/iaas/Content/Email/Tasks/enablelogs_using-the-console.htm)。

## 4. #143 受控单封前清单

1. #136–#140 的 fake/mock 测试及 ADR-017 发布门禁在目标 commit 和 CI 通过；迁移、备份与回滚点已审核。合并代码不等于启用真实模式。
2. #144 决策齐备：region/domain/approved sender、SPF/DKIM/DMARC、实际 OCI 配额、Staging 人员邮箱核查、合规与投诉责任人；#139 的 20 次/秒只是应用上限，没有应用日上限，不代表 OCI 配额。
3. 按第 2 节当次复核 #141 的实例身份和精确 sender policy。#142 两类日志、指标、告警读取权限、保留期、接收人及测试须通过。Backend 容器不使用 API key/SMTP password。
4. 操作者记录精确 commit、变更窗口、单封收件人的受控审批（不在记录中写地址）、停止条件与回滚责任人。下次真实发送窗口获独立批准前，Compose 保持 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。
5. 新窗口获批且预检完成后，切换时容器环境中的 `APP_ENV=staging`、`MAIL_PROVIDER=oci_email_delivery_https`、`REAL_MAIL_SEND_ENABLED=true`、`OCI_EMAIL_REGION`、`OCI_EMAIL_SENDER_COMPARTMENT_ID`、`OCI_EMAIL_FROM_ADDRESS`、`OCI_EMAIL_MESSAGE_ID_DOMAIN` 必须与批准记录逐项一致；**未完成预检和新窗口批准前不得仅靠设置环境变量启用真实发送。**
6. 首先只创建一个合成任务并观察本地 attempt、OCI accepted/relayed、DKIM/SPF/DMARC、受控收件结果；人工复核后才能小批量。不得使用真实客户数据、临时 API key 或独立收件 allowlist。

## 5. 停止与回滚

触发停止信号立即暂停新的真实发信领取，回滚容器环境到 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，按现有 [Staging Runbook](staging-manual.md) 的审批、备份、Compose config/health/smoke 流程重建 Backend。先核对实际执行的 Compose 文件与 `.env`，不要在命令行输出 secret。回滚不改写已有 `sent`、`suppressed`、`failed`、`delivery_unknown` 或 attempt 标识；在途 `delivery_unknown` 按第 3 节人工对账，绝不自动置回 `queued`。保留 OCI 日志、审计与脱敏事件记录。IAM 和日志资源的撤销是独立审批步骤，不替代应用先回滚 mock。
