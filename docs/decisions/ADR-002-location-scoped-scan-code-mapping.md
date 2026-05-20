# ADR-002：按办公室/学校上下文隔离扫码编号映射

- 状态：Accepted
- 日期：2026-05-20

## Context

最新业务流程要求：用户在扫码邮件页面必须先切换办公室/校舍，再根据扫码编号查找邮箱。现有草案仅有 `scan_events` 与 `mail_jobs`，缺少办公室/学校维度与“扫码编号→人员邮箱”映射模型，无法支撑“人员一览”与同码在不同场所的隔离。

## Decision

- 新增 `locations` 表，承载租户内办公室/学校维度。
- 新增 `person_mappings` 表，承载在指定 `location` 下的 `scan_code -> person_name/email` 关系。
- 约束扫码查询必须同时使用 `(tenant_id, location_id, scan_code)`，并为其建立唯一索引，禁止仅按 `scan_code` 全局查找。
- `users` 明确为“可登录系统的管理员账号”，角色拆分为：
  - `root_admin`：可编辑订阅、增减 location。
  - `manager`：仅可编辑 `person_mappings`。
- `subscriptions` 由“租户级”调整为“location 级”，外键改为 `location_id`（每个 location 一条订阅配置）。

## Alternatives considered

- 使用 `offices` 单一命名：语义清晰但无法直接覆盖学校场景。
- 使用 `schools` 单一命名：同样不覆盖办公室场景。
- 统一命名为 `locations`：可覆盖办公室/学校，保留 `type` 区分，兼容后续扩展。

## Consequences

- 数据查询链路增加 location 上下文，前端与后端均需显式传递当前办公室/学校。
- 同一扫码编号可在不同 location 下复用且互不冲突。
- 管理与导入流程后续需要支持 location 维度。

## Migration impact

- 本次仅文档设计，不实施 migration。
- 后续落地 migration 时需考虑历史数据回填 location 的策略（若存在历史数据）。

## Security impact

- 降低跨租户、跨办公室/学校误查和误发邮件风险。
- 需在后续实现中对 tenant 与 location 双重校验，避免越权读取映射。

## Operational impact

- 运维排障需增加 `tenant_id + location_id + scan_code` 三元组定位。
- 测试需覆盖“同码不同 location 隔离”与越权访问拒绝场景。
