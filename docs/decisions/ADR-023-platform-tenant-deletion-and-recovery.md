# ADR-023：平台管理员整租户删除与环境化恢复期

- 状态：Proposed
- 日期：2026-10-20
- 相关 Issue：#149

## Context

用户要求在平台控制台删除整个 tenant：删除前重新输入当前 platform_admin 密码；Production 保留数据一年且可恢复；Staging 立即删除，不提供恢复。现行 Accepted ADR-013 第 7 节明确 MVP 不提供 tenant 物理删除。ADR-006 限定 platform_admin 不读取租户业务明细；ADR-003、ADR-017 限定租户门禁、邮件领取与不可变发送事实；ADR-011 的人员/地点 14 天清理保留不可变业务历史。整租户清理必须明确与这些规则的关系，不能直接为 tenant 表增加级联删除。

当前数据库中 tenant 与用户、地点、人员、扫码、邮件任务、发送尝试、Session、审计、平台开通幂等记录等存在 Restrict/SetNull 外键。仅删除 `tenants` 主行既不能实现整租户删除，也可能因外键失败。Production 恢复还涉及订阅到期、已领取或结果未知的邮件、Session 撤销和跨 tenant 隔离。数据库备份生命周期尚未设计，本 ADR 暂不规定备份中的数据如何保留或清除；因此这里的“删除”仅指在线业务数据库中的数据。

本 ADR 是供人工审阅的提案。接受前不新增删除 API、数据库字段、清理器或 UI 操作，也不删除任何现有租户。

## Decision

拟采用如下方案，待人工批准后生效：

1. **权限与确认。** 仅 active platform_admin 可从独立平台控制台发起整租户删除或恢复。删除确认展示目标 tenant name、`tenant_code`、当前环境、影响和恢复期限；服务端重新校验当前平台管理员密码，并要求有限有效期的 Session。密码不进入日志、审计或持久化数据。服务端按受信任的 `APP_ENV` 选择策略，客户端不得指定环境或保留期。错误、重复及并发请求必须安全且幂等。
2. **Production 删除。** 用数据库时间原子写入 tenant 级 `deleted_at`、`purge_after` 和删除前状态快照；恢复期限按日历年计算，`purge_after = deleted_at + interval '1 year'`，闰日映射及时间边界须在实施前用测试明确。提交成功后立即拒绝该 tenant 的登录、Session 刷新、新扫描、业务写入、新邮件任务和后台待发送任务。所有仍有效的 tenant Session 撤销；取消或终止尚未调用 provider 的任务，但不改写已发送、已取消或 `delivery_unknown` 等历史事实。删除期间保留 tenant 及关联数据，仅平台控制台显示最小删除状态、剩余期限和恢复入口，不开放业务数据读取。
3. **Production 恢复。** 仅在数据库时间严格早于 `purge_after` 时允许恢复。恢复 tenant 级删除前状态，但不恢复已撤销 Session，也不重新排队因删除而终止的邮件；订阅仍按当前有效期和 ADR-003 门禁判断，过期订阅不因恢复自动续期。人员/地点若自身已进入 ADR-011 删除流程，不因 tenant 恢复而改变其独立状态。恢复与到期清理须以事务及条件更新防止竞态。
4. **Production 到期。** `purge_after` 到达后立即拒绝恢复，即使后台清理尚未完成。后台按小批次、可重试流程清理在线业务数据库中的 tenant 关联数据和 PII，并留下不含业务数据的最小平台审计证据。清理顺序及外键处理须在 migration 与运维计划中完整列出；不得以仅匿名化 tenant 名称宣称已清理整个租户。备份生命周期及其中数据的清理由后续独立决策处理，本 ADR 不承诺清理备份副本。
5. **Staging 删除。** 在同一密码确认和目标核对后，立即执行整租户及其关联数据的受控清理；不创建一年恢复期，也不显示恢复入口。Staging 不设数据保留期，本 ADR 不设计 Staging 备份。若清理不能原子完成，外部状态先保持不可访问并记录待补偿步骤；不得显示“已完成”而留下可业务访问的残余数据。仅使用 Staging 专用数据验证。
6. **历史和回执。** 已提交的 provider 调用不能撤回；`sent` 与 `delivery_unknown` 不得改回待发送。Production 恢复期内保留原始扫码、邮件、attempt 和审计事实；到期清理与 ADR-011 的“历史不删除”规则之间的优先级须在接受本 ADR 时明确，并同步修订 ADR-011/013 的冲突文字。

**待人工定案的细节：** 到期后不可变业务历史保留非 PII 墓碑，还是连同 tenant 一起从在线业务数据库清理；平台审计的最小保留字段和期限。上述事项直接影响数据处理承诺，未定案前不得把此提案改为 Accepted 或开始删除实现。数据库备份生命周期由后续独立决策处理；Staging 不考虑备份及数据保留。

## Alternatives considered

1. 只将 subscription 置为 `suspended`：可阻断部分业务，但仍可按现有流程恢复，不能表达一年保留、到期不可恢复或 Staging 立即清理。
2. 对 tenant 直接执行数据库 `DELETE CASCADE`：会绕过当前 Restrict 关系、不可变历史和审计边界，也难以保证在途邮件一致，否决。
3. Production 与 Staging 共用一年软删除：实现简单，但不满足用户指定的 Staging 立即删除，否决。

## Consequences

平台控制台可提供与环境一致的删除/恢复体验；代价是所有 tenant 门禁、worker、数据模型、清理器和审计都要加入 tenant 生命周期判断。数据库备份尚无生命周期设计，产品文案必须明确本 ADR 的清理范围仅为在线业务数据库，不能承诺备份副本同步清除。

## Migration impact

Production 需要 tenant 生命周期字段、索引、约束和安全回填；现有 tenant 默认保持可用。新增字段后先发布读路径和门禁，再开放删除入口。删除开始后的回滚必须保留生命周期字段和时间戳，不能通过回退代码重新开放待删除 tenant。Staging 立即删除需要单独的关联数据清理计划，不能复用 Production 软删除写路径。

## Security impact

独立 platform guard 和重新验密必须在同一次删除请求中服务端完成；前端确认弹窗不构成授权。密码只在请求处理内短暂使用，不记录明文。所有 tenant 业务读写、登录、刷新、邮件 worker、导出和重试按服务端 tenant 生命周期 fail closed；跨 tenant ID 不能泄露存在性。平台界面只显示最小 tenant 摘要，不因删除功能获得人员、邮件正文或完整邮箱读取权限。审计使用内部 ID、请求 ID、actor、环境、结果和安全原因码，不写 PII。

## Operational impact

需要清理队列、失败告警、到期阻断、在线数据恢复演练及人工紧急停发流程。清理器只在已确认的环境运行；错误环境、关联数据未核对或清理结果不一致时停止并告警。运维记录不包含客户明细。Production 到期清理及 Staging 立即清理应有可核对的计数和审计结果。备份生命周期另行设计；Staging 不设备份或数据保留要求。

## Follow-up

1. 用户先决定到期后历史与平台审计的待定事项；按模板修订本 ADR 并取得 Accepted 状态，随后同步修订 ADR-013 和受影响的 ADR-011 文字。数据库备份生命周期另行决策。
2. 按 1–8 小时范围拆分 schema/门禁、平台重新验密与删除 API、Production 恢复/到期清理、Staging 立即清理、UI、运维和测试 Issue。
3. 实施时更新 `docs/architecture.md`、`docs/database.md`、`docs/api.md`、`docs/admin-guide.md`、`docs/deployment.md` 和 `docs/issue-archive.md`。
4. 最低测试矩阵：正常删除/恢复/到期；错误密码、过期 Session、未知目标、重复与并发；tenant 与角色越权；`trial/active/expired/suspended`；待发/已发/未知邮件；闰日、期限边界、清理失败和回滚；Staging/Production 环境判定及在线数据残留。全部使用合成数据，不调用真实邮件 provider。
