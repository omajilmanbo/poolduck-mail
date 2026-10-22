# ADR-023：平台管理员整租户删除与环境化恢复期

- 状态：Accepted
- 日期：2026-10-20
- 相关 Issue：#149

## Context

> 后续决策：Accepted ADR-024 局部取代本 ADR 中 Production 租户终结后继续保留扫码、邮件、回执及审计历史的规则；一年恢复期、当前对象非 PII 墓碑与 Staging 立即清理规则不变。历史销毁尚未实施。

用户要求在平台控制台删除整个 tenant：删除前重新输入当前 platform_admin 密码；Production 保留数据一年且可恢复；Staging 立即删除，不提供恢复。现行 Accepted ADR-013 第 7 节明确 MVP 不提供 tenant 物理删除。ADR-006 限定 platform_admin 不读取租户业务明细；ADR-003、ADR-017 限定租户门禁、邮件领取与不可变发送事实；ADR-011 的人员/地点 14 天清理保留不可变业务历史。整租户清理必须明确与这些规则的关系，不能直接为 tenant 表增加级联删除。

当前数据库中 tenant 与用户、地点、人员、扫码、邮件任务、发送尝试、Session、审计、平台开通幂等记录等存在 Restrict/SetNull 外键。仅删除 `tenants` 主行既不能实现整租户删除，也可能因外键失败。Production 恢复还涉及订阅到期、已领取或结果未知的邮件和跨 tenant 隔离。数据库备份生命周期尚未设计，本 ADR 暂不规定备份中的数据如何保留或清除；因此这里的“删除”仅指在线业务数据库中的数据。

2026-10-20 已获人工接受。本 ADR 确定后续实现边界；接受决策本身不执行数据删除。

## Decision

采用如下方案；本决策于 2026-10-20 获得人工接受：

1. **权限与确认。** 仅 active platform_admin 可从独立平台控制台发起整租户删除或恢复。删除确认展示目标 tenant name、`tenant_code`、当前环境、影响和恢复期限；服务端重新校验当前平台管理员密码，并要求有限有效期的 Session。密码不进入日志、审计或持久化数据。服务端按受信任的 `APP_ENV` 选择策略，客户端不得指定环境或保留期。错误、重复及并发请求必须安全且幂等。
2. **Production 删除。** 用数据库时间原子写入 tenant 级 `deleted_at`、`purge_after`、删除前 tenant/订阅状态快照，并将 subscription 置为 `suspended`；恢复期限按日历年计算，`purge_after = deleted_at + interval '1 year'`，闰日映射及时间边界须在实施前用测试明确。删除期间沿用 ADR-003/ADR-017 已有的 `suspended` 业务门禁：禁止新扫码、邮件任务创建及等待/重试任务的 provider 调用；登录、Session 刷新、既有业务读取与其他管理操作保持现有暂停订阅的权限语义。不另行撤销 tenant Session，也不单独取消或改写邮件任务；已调用 provider 的结果不能撤回。仅平台控制台显示 tenant 的删除期限和恢复入口；普通订阅更新不得将待删除 tenant 改回可发送状态，只能通过第 3 点恢复。
3. **Production 恢复。** 仅在数据库时间严格早于 `purge_after` 时允许恢复。恢复删除前 tenant 与 subscription 状态；订阅仍按当前有效期和 ADR-003 门禁判断，过期订阅不因恢复自动续期。删除期间因 `suspended` 发送门禁进入安全终态的邮件不重新排队。人员/地点若自身已进入 ADR-011 删除流程，不因 tenant 恢复而改变其独立状态。恢复与到期清理须以事务及条件更新防止竞态。
4. **Production 到期。** `purge_after` 到达后立即拒绝恢复，即使后台清理尚未完成。后台按小批次、可重试流程终结清理 tenant 及关联的当前业务对象：清除当前名称、邮箱等 PII，改写为非 PII 墓碑值，保留稳定的内部 UUID 关系；删除不再需要的当前授权、Session 和兼容标识。tenant 及其对象不得恢复或重新用于业务。清理顺序及外键处理须在 migration 与运维计划中完整列出；不得以仅匿名化 tenant 名称宣称已完成终结清理。备份生命周期及其中数据的清理由后续独立决策处理，本 ADR 不承诺清理备份副本。
5. **Staging 删除。** 在同一密码确认和目标核对后，立即执行整租户及其关联数据的受控清理；不创建一年恢复期，也不显示恢复入口。Staging 不设数据保留期，本 ADR 不设计 Staging 备份。若清理不能原子完成，外部状态先保持不可访问并记录待补偿步骤；不得显示“已完成”而留下可业务访问的残余数据。仅使用 Staging 专用数据验证。
6. **历史和回执。** 已提交的 provider 调用不能撤回；`sent` 与 `delivery_unknown` 不得改回待发送。Production 到期后沿用 ADR-011 的历史规则：`scan_events`、`mail_jobs`、provider 回执、上下文快照与 `audit_logs` 保持不可变，内部 UUID 关联指向非 PII 墓碑。历史快照可能仍含当时固化的名称、邮箱或邮件内容；“非 PII 墓碑”只描述当前对象的清理结果，不表示历史记录已去标识化。历史记录不得使已终结清理的 tenant 重新可用；平台管理员仍不得读取租户业务明细。

**2026-10-20 后续人工修订：** 删除后的即时业务门禁改为复用 subscription `suspended` 语义；不另行封禁登录/Session 或新增邮件终止机制。原 #158、#159 不再单独实施。删除 API 必须在同一事务内保存原订阅状态并设为 `suspended`，恢复 API 按本节第 3 点处理。

**2026-10-20 后续人工补充：** Production 与 Staging 均不可删除 `subscription.status=active` 的租户。删除 API 在锁定目标租户后读取当前订阅状态，若为 `active` 则拒绝且不写入生命周期字段或更改订阅；此限制不把 `tenant.status=active` 作为拒绝条件。`trial`、`expired`、`suspended` 仍按各环境的删除流程处理；#164 的 Staging 实现也须遵守此门禁。

**范围说明：** Production 的一年期限结束后，当前对象改为非 PII 墓碑，不删除不可变业务历史；这与 ADR-011 的人员/地点终结清理语义一致。数据库备份生命周期由后续独立决策处理；Staging 不考虑备份及数据保留。

## Alternatives considered

1. 只将 subscription 置为 `suspended`，不记录 tenant 删除期限与状态：不能表达一年保留、到期不可恢复或 Staging 立即清理；本决策复用其业务门禁，但另行保留 tenant 生命周期。
2. 对 tenant 直接执行数据库 `DELETE CASCADE`：会绕过当前 Restrict 关系、不可变历史和审计边界，也难以保证在途邮件一致，否决。
3. Production 与 Staging 共用一年软删除：实现简单，但不满足用户指定的 Staging 立即删除，否决。
4. Production 到期后物理删除全部关联历史：会破坏 ADR-011、ADR-008 的不可变历史及审计约束，且不符合本次人工选择，否决。

## Consequences

平台控制台可提供与环境一致的删除/恢复体验；删除期间扫码与发信复用已有 `suspended` 门禁，tenant 生命周期仍需要数据模型、到期清理和审计支持。Production 到期后保留不可变历史及可能含有历史 PII 的快照，产品文案须明确“终结清理”并不等于清除所有历史 PII。数据库备份尚无生命周期设计，也不能承诺备份副本同步清除。

## Migration impact

Production 需要 tenant 生命周期字段、索引、约束和安全回填；现有 tenant 默认保持可用。新增字段与现有 `suspended` 门禁回归验证完成后，才能开放删除入口。删除开始后的回滚必须保留生命周期字段、时间戳及暂停订阅状态，不能通过回退代码重新开放待删除 tenant 的扫码或发信。Staging 立即删除需要单独的关联数据清理计划，不能复用 Production 软删除写路径。

## Security impact

独立 platform guard 和重新验密必须在同一次删除请求中服务端完成；前端确认弹窗不构成授权。密码只在请求处理内短暂使用，不记录明文。删除期间新的扫码和邮件发送遵循 `suspended` 门禁；到期终结清理后的对象不得再用于业务，跨 tenant ID 不能泄露存在性。平台界面只显示最小 tenant 摘要，不因删除功能获得人员、邮件正文或完整邮箱读取权限。审计使用内部 ID、请求 ID、actor、环境、结果和安全原因码，不写 PII。

## Operational impact

需要清理队列、失败告警、到期阻断、在线数据恢复演练及人工紧急停发流程。清理器只在已确认的环境运行；错误环境、关联数据未核对或清理结果不一致时停止并告警。运维记录不包含客户明细。Production 到期清理及 Staging 立即清理应有可核对的计数和审计结果。备份生命周期另行设计；Staging 不设备份或数据保留要求。

## Follow-up

1. 2026-10-20 人工接受本 ADR：Production 按日历年保留一年且可恢复，到期沿用 ADR-011 的非 PII 当前对象墓碑和不可变历史规则；Staging 立即删除且不保留。同步修订 ADR-013 的租户删除边界；ADR-011 的既有历史规则保持适用。数据库备份生命周期另行决策。
2. 按 1–8 小时范围拆分实施 Issue：#157 生命周期 schema，#160 平台删除 API 与 `suspended` 切换，#161 Production 恢复，#162 当前对象墓碑，#163 到期调度，#164 Staging 立即清理，#165 平台 UI，#166 集成验收与运维文档。原 #158、#159 因复用现有门禁而关闭为 not planned。
3. 实施时更新 `docs/architecture.md`、`docs/database.md`、`docs/api.md`、`docs/admin-guide.md`、`docs/deployment.md` 和 `docs/issue-archive.md`。
4. 最低测试矩阵：正常删除/恢复/到期；错误密码、未知目标、重复与并发；tenant 与角色越权；`trial/active/expired/suspended`；删除后登录/读取维持暂停订阅语义，新扫码/发信被拒；待发/已发/未知邮件；当前 PII 清理、非 PII 墓碑和历史快照不变；闰日、期限边界、清理失败和回滚；Staging/Production 环境判定及在线数据残留。全部使用合成数据，不调用真实邮件 provider。
