# ADR-002：按办公室/学校上下文隔离扫码编号映射

- 状态：Accepted
- 日期：2026-05-20
- 相关 Issue：#2
- 部分 supersede：ADR-009 已取代本 ADR 中的 MVP location 计费与补差规则；
  location-scoped 扫码隔离决策继续有效。

## Context

最新业务流程要求：用户在扫码邮件页面必须先切换办公室/校舍，再根据扫码编号查找邮箱。现有草案仅有 `scan_events` 与 `mail_jobs`，缺少办公室/学校维度与“扫码编号→人员邮箱”映射模型，无法支撑“人员一览”与同码在不同场所的隔离。

## Decision

- 新增 `locations` 表，承载租户内办公室/学校维度。
- 新增 `person_mappings` 表，承载在指定 `location` 下的 `scan_code -> person_name/email` 关系。
- 约束扫码查询必须同时使用 `(tenant_id, location_id, scan_code)`，并为其建立唯一索引，禁止仅按 `scan_code` 全局查找。
- `users` 明确为“可登录系统的管理员账号”，角色拆分为：
  - `tenant_manager`：可管理 location；订阅权限按 ADR-006 为只读。
  - `operator`：仅可编辑 `person_mappings`。
- `subscriptions` 保持“租户级”模型，外键保持 `tenant_id`（每个 tenant 一条订阅配置）。
- 原计费提案要求 MVP 使用“租户基础套餐 + location 数量扩展”并对追加 location
  co-term / proration；该部分已由 ADR-009 supersede，不再适用于 MVP。

## Alternatives considered

- 使用 `offices` 单一命名：语义清晰但无法直接覆盖学校场景。
- 使用 `schools` 单一命名：同样不覆盖办公室场景。
- 统一命名为 `locations`：可覆盖办公室/学校，保留 `type` 区分，兼容后续扩展。
- 订阅改为 location 级：可直接按 location 定价，但会增加订阅聚合判断、门禁实现与迁移成本。
- MVP 保持租户级订阅且不按 location 数量执行商业计费：当前由 ADR-009 采用；
  未来商业化必须通过新的计费 ADR 和独立实现 Issue 引入。

## Consequences

- 数据查询链路增加 location 上下文，前端与后端均需显式传递当前办公室/学校。
- 同一扫码编号可在不同 location 下复用且互不冲突。
- 管理与导入流程后续需要支持 location 维度。
- 订阅门禁仍以 tenant 维度执行，避免在 MVP 阶段引入跨 location 的订阅一致性问题。

## Migration impact

- 本次仅文档设计，不实施 migration。
- 后续落地 migration 时需考虑历史数据回填 location 的策略（若存在历史数据）。

## Security impact

- 降低跨租户、跨办公室/学校误查和误发邮件风险。
- 需在后续实现中对 tenant 与 location 双重校验，避免越权读取映射。

## Operational impact

- 运维排障需增加 `tenant_id + location_id + scan_code` 三元组定位。
- 测试需覆盖“同码不同 location 隔离”与越权访问拒绝场景。


## Follow-up

- 后续实现阶段需将本 ADR 要求映射到数据库迁移、API 契约与测试用例。
- 如业务规则变化，需通过新 ADR 明确 supersede 关系。
