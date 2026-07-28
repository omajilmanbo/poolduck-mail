# ADR-009：MVP 延后商业计费并解除功能前置依赖

- 状态：Accepted
- 日期：2026-07-24
- 相关 Issue：#64, #65, #83, #92, #102

## Context

Issue #83 原计划在 MVP 展示套餐允许的 location 数量、已使用数量、订阅剩余时间和
续订提醒，并要求 location 创建路径执行商业配额检查。Issue #92 因此把 #83 的
allowance 与超额处理规则列为实现前置。

商业定价仍需要决定 location 边际阶梯、活动人员附加费、价格 `a`、proration、退款、
Enterprise 审批和支付责任。这些问题不会帮助 MVP 验证地点、人员、扫码与邮件发送闭环，
反而会让非商业化功能持续等待价格和支付规则。

MVP 仍需保留 ADR-003 已接受的订阅安全门禁：只有有效的 `trial` / `active` 订阅可以
创建扫码和邮件任务，`expired` / `suspended` 必须阻断关键发送链路。安全门禁与商业
计价必须分开，不能因为延后收费而移除防误发保护。

业务负责人于 2026-07-24 明确批准：关闭 #83，把商业计费降为未来工作，并解除它对
其他功能改进的前置依赖。

## Decision

1. MVP 不实现商业订阅概览、套餐 allowance、location/person 数量收费、proration、
   付款、发票、自动续订或退款。
2. location 创建、编辑、停用、重新启用，以及人员、扫码、邮件、历史和权限功能，
   不得依赖价格、套餐 allowance、付款状态、#83 或 #102。
3. ADR-003 的 subscription `status` / `end_at` 安全门禁继续生效；该门禁只决定是否
   可以扫码和发送邮件，不定义 location 或人员数量。
4. `tenant_manager` 遵循 ADR-006，只能只读查看自身 tenant 的基础订阅状态，不能修改
   套餐或订阅状态。MVP 不为此建设商业订阅管理页面。
5. Issue #83 以 `not_planned` 关闭。扫码页面移除剩余时间等已确认行为由 #65 承接，
   订阅到期与停用门禁由 #64 承接。
6. Issue #92 仅依赖已批准的 ID/location 决策，不执行商业配额检查，也不依赖 #102。
7. Issue #102 保留为 P3/Future。只有未来价格展示、收费、支付、发票和结算工作可以
   依赖其批准后的计费 ADR；其阻塞条件不得传播到非商业化 MVP 功能。
8. 未来启动商业化时，必须重新核对当时已接受的 subscription、权限、location 与数据
   决策，创建独立计费 ADR 和小范围实现 Issue。未来规则不得追溯性阻止已有非商业化
   location 或人员功能。

本 ADR supersede ADR-002 中以下计费部分，但不改变其 location-scoped 扫码隔离决策：

- “MVP 采用租户基础套餐 + location 数量用于后续计费扩展”；
- “追加 location 与 `end_at` co-term 并按剩余周期补差计费”；
- 把 location 数量计费作为 MVP 推荐方案的相关替代项结论。

## Alternatives considered

1. 保持 #83 开放并继续让 #92 等待 allowance
   - 未选择。它把尚未需要的商业规则放到地点核心功能之前，扩大 MVP 依赖链。
2. 在 MVP 先实现固定免费配额，未来再替换为收费
   - 未选择。临时配额仍会进入 API、测试和数据模型，后续商业化需要迁移且可能阻塞客户。
3. 完全移除 subscription 状态与到期门禁
   - 未选择。ADR-003 的门禁用于防止过期或暂停租户继续扫码和发信，属于安全边界，不是
     商业价格功能。
4. 当前立即完成 #102 的计费 ADR
   - 未选择。价格、合同、支付和市场验证尚未进入 MVP，提前固化会增加无效设计成本。

## Consequences

正面影响：

- location、人员、扫码、邮件、历史和权限工作不再等待商业定价；
- 安全门禁与商业计价职责分离，#64/#65 可以独立验证；
- 未来计费仍有 #102 记录候选方向，不丢失商业化讨论；
- 不需要在当前 schema、API 或 UI 中引入临时 allowance 与 proration。

负面影响：

- MVP 不提供商业套餐展示、location/person 收费或自动续订；
- 当前不能通过产品内计费限制控制客户规模，测试环境需继续使用合成数据并依赖常规容量、
  速率限制和运维监控；
- 未来商业化需要重新设计价格版本、历史客户迁移和已有 location 的收费生效策略。

## Migration impact

- 本决策不要求新增或删除数据库字段，也不修改已有 tenant、subscription、location 或
  person 数据。
- 删除文档和 Issue 中把 allowance、proration 或付款作为 MVP location 前置的描述。
- 已有 location 创建/停用实现不增加商业计费检查点；未来收费通过独立迁移和功能开关引入。
- 不删除 `subscriptions.plan`、`status`、`start_at`、`end_at`，因为状态和到期门禁仍在
  MVP 使用。

## Security impact

- ADR-003 的 tenant-scoped subscription 门禁保持不变，`expired` / `suspended` 继续
  阻断扫码、邮件创建和重试。
- ADR-006 的角色边界保持不变；`tenant_manager` 不能修改订阅，`operator` 不能查看或
  修改订阅。
- 解除商业配额不得削弱 tenant isolation、location 授权、停用对象门禁或防误发测试。
- 当前阶段不接触真实支付凭据、合同、发票或客户计费数据。

## Operational impact

- MVP 部署不需要价格表、支付 provider、invoice worker 或计费 Secrets。
- 监控继续关注 subscription 状态拒绝、过期时间边界、扫码和邮件失败，而不生成商业用量
  或账单指标。
- #92 及其他非商业化功能不得因为 #102 未启动或缺少计费配置而停止。
- 未来商业化启用前需要单独的迁移、回滚、审计、价格版本和客户通知方案。

## Follow-up

- #83：保持 `not_planned` 关闭。
- #64：继续实现用户状态、subscription 状态与 `end_at` 的安全门禁。
- #65：继续移除扫码页面的剩余订阅时间，并保留不可发送提示。
- #92：按 ADR-007 实现 location ID、简化创建与重新启用，不执行商业配额检查。
- #102：保持 P3/Future；仅在业务负责人明确启动商业化后恢复。
- 同步更新 `docs/requirements.md`、`docs/architecture.md` 与 `docs/issue-archive.md`。
