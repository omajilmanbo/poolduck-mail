# ADR-003: Tenant Context Isolation and Subscription Gating Rules

## Context
Issue #6 当前阶段目标是先明确多租户、角色权限、订阅约束的基础规则，而不是直接实现中间件/RBAC 代码。
现有文档中对 tenant_id 来源、管理员权限边界、订阅状态命名存在不一致，容易导致越权访问与误发邮件风险。

## Decision
1. **Tenant 隔离来源**：登录接口显式接收 `tenant_id`，后端先校验该 tenant 是否存在，再校验用户是否属于该 tenant；登录成功后业务接口只使用会话/token 上下文中的 `tenant_id`，不接受业务接口再传 `tenant_id`。
2. **角色边界（MVP）**：
   - `root_admin`：可维护用户账号、订阅、办公室/学校，并可执行需要管理员权限的接口。
   - `manager`：仅可维护人员一览并执行扫码流程，不可维护订阅与办公室/学校。
3. **订阅状态统一**：使用 `trial` / `active` / `expired` / `suspended`。
4. **功能门禁**：仅 `trial`、`active` 可执行扫码与邮件发送；`expired`、`suspended` 禁止扫码提交、邮件创建与重试。

## Alternatives considered
- 登录阶段不输入 `tenant_id`：用户体验更简，但无法满足“先选择租户再登录”的业务流程，不采用。
- 订阅状态维持 `canceled`：与当前业务“暂停”语义不匹配，且与 issue 目标不一致。
- 在本次直接落地中间件：超出本 issue 文档澄清范围，不采用。

## Consequences
- 代码实现阶段需在登录流程落实“tenant 存在性 + 用户归属”双重校验，并在登录后统一从 auth context 注入 tenant scope。
- API/DB/需求文档间术语一致，降低实现偏差。
- `expired`/`suspended` 场景下用户体验需明确提示订阅受限。

## Migration impact
- 若历史实现已使用 `canceled`，后续迁移需映射到 `suspended` 或补充状态迁移脚本。
- 现阶段仅文档变更，不执行数据迁移。

## Security impact
- 降低跨租户访问风险（登录即校验 tenant 归属，且业务接口不信任客户端 tenant 参数）。
- 通过订阅门禁减少未授权邮件发送风险。

## Operational impact
- 运维与客服可按统一状态解释订阅行为。
- 监控可围绕 `expired`/`suspended` 拒绝事件建立告警。
