# ADR-021：验证 OCI HTTPS SubmitEmail 的最小发信权限

- 状态：Rejected
- 日期：2026-10-14
- 相关 Issue：#141, #145

## Context

ADR-019 已接受 Staging 使用目标 Compute 的 Instance Principal，以及限定单一 approved sender、域和 compartment 的 IAM policy。Terraform 已部署该 policy，容器内身份获取成功，但这只证明认证与配置存在，不证明 HTTPS `SubmitEmail` 的有效授权或负面边界。

Oracle [HTTPS 提交说明](https://docs.oracle.com/en-us/iaas/Content/Email/Concepts/email-submission-using-https.htm)确认支持 Instance Principal；[Email Delivery IAM 权限表](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/emailpolicyreference.htm)将 `APPROVED_SENDER_USE` 明确列为 `SmtpSend` 所需权限，却未列出 `SubmitEmail`。当前 Staging region/compartment 只有一个 ACTIVE approved sender。向另一个 sender 发起“预期被拒绝”的 `SubmitEmail` 请求，如果意外成功，仍可能产生第二封真实邮件；畸形请求也不能保证授权判断先于内容校验。因此不得把这种调用当作无发信风险的预检。

2026-10-14 的 10 分钟单发窗口已在预检阶段停止，未切换或发信。需要确定一套可审计、不会暗中扩大实际发信数量的 #141 验证门禁。

## Decision

**2026-10-14 用户明确驳回本 ADR。以下仅保留被驳回草案的历史内容，不是实施门禁，也不授权真实发信。**

驳回原因：草案把 #141 的完整负面权限验收和 Oracle 权限映射证明提前设为 #145 受控正向验证的前置条件，使阶段性真实发信工程陷入不必要的循环。后续以已接受的 ADR-019、ADR-020 重新梳理阶段目标、现有安全设计和实装缺口；先完成可在 mock 下完成的工程与审查，再由用户另行决定何时进入真实发信验证。

1. 在 mock 模式完成只读控制面核查：实时读取目标 Dynamic Group 匹配规则、发信 policy、相关 tenancy/compartment 中可能覆盖目标实例的其他 policy、approved sender 清单；核对仅目标实例与精确 sender/domain/compartment 被授权，且无宽泛 `email-family`、`any-user` 或额外匹配规则。只记录脱敏摘要，不输出 token、收件人或原始日志。发现未知或宽泛授权即停止。
2. 在执行数据面验证前，取得 Oracle 官方文档或 Oracle Support 对 HTTPS `SubmitEmail` 所需 IAM 权限及 sender 条件变量是否参与授权的明确说明，并与实际 policy 对照。文档没有映射时，不把 `SmtpSend` 映射推断为 `SubmitEmail` 映射；若仍不能证实，#141 保持开放且真实发送门禁关闭。
3. 获得上述证据后，另经人工批准的新窗口，才从目标 Backend 的正常应用链路向已核查的受控人员邮箱提交**一封**合成邮件。用应用 attempt、OCI Audit/OutboundAccepted/OutboundRelayed 与收件结果证明正向功能；`accepted` 不等于送达。该单封不证明其他 sender/身份的负面效果。
4. 负面权限以第 1–2 项的完整 policy 范围审查和 Oracle 权限语义为首选证据。若验收方仍要求数据面负面调用，另行提交可审阅的 canary 方案：明确额外 approved sender/非目标身份的来源、最多可能发送的封数、唯一受控收件人、失败即回滚规则和清理步骤，并取得独立人工批准。未经此批准，不创建第二个 sender，也不调用预期失败的 `SubmitEmail`。
5. 不为测试临时授予 `manage email-family`、SMTP 凭据、API key 或 suppression 管理权。任何 policy 变更均先更新 Terraform、审阅完整 plan 并另获批准；不能手工在 Console 添加仓库外权限。

## Alternatives considered

1. **对无效 sender/畸形请求直接调用 SubmitEmail**：API 的验证顺序未获保证，意外成功可能产生额外真实邮件，不能算无发信预检。
2. **只凭单封成功关闭 #141**：证明正向权限，但不能证明精确 sender 和非目标身份被拒绝。
3. **放宽为 `manage email-family` 后测试**：扩大运行身份权限，违反 ADR-019，且掩盖最小权限问题。
4. **创建第二个 canary sender 立即做负面测试**：可获得较强实证，但新增 OCI 资源和可能的第二封邮件超出已批准单封范围，须独立审批。

## Consequences

正面：把只读验证、真实单封和可能产生额外邮件的负面测试明确分开；不因缺失的官方映射或“预期失败”请求误发邮件。负面：若 Oracle 无法确认权限语义，#141/#145 继续等待，不以推断替代安全证据。

## Migration impact

本 ADR 草案不修改 schema、应用代码、Terraform、OCI IAM 或真实发信开关。Staging 可按 ADR-019 预先注入非秘密 OCI 参数，但 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false` 必须保持不变。接受后仅更新 Runbook 和 #141 验收证据要求；如需 canary 资源或新 policy，另行设计、审批和实施。

## Security impact

不得将负面探测视作必然不会发信；额外调用必须按可能成功发送处理。只读证据不含认证材料、完整人员邮箱、邮件正文或 OCI 原始日志。静态 policy 审查必须考虑同一身份可能从其他 policy 获权，不能只检查本项目的一条 statement。

## Operational impact

运维需记录 OCI 文档/Support 答复、policy/Dynamic Group/approved sender 的脱敏快照、检查时间、责任人和结论。任何不明确之处均维持 mock。测试窗口、备份、监控、停止阈值与回滚责任人仍按 ADR-019 和 Staging Runbook 单独确认。

## Follow-up

1. 本 ADR 不实施；不得以其中的 Oracle Support 答复或负面 canary 方案作为既定前置条件。
2. 按 ADR-019/020 复核 #141–#145 的工程、权限与运维验收，将“工程就绪”和“真实邮件验证”分阶段记录。
3. 如未来需要新增授权策略或有风险的负面数据面测试，另行提出方案并取得人工批准。
