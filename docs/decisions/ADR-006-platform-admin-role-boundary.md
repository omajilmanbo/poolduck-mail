# ADR-006：平台管理员与租户管理员的权限边界

- 状态：Accepted
- 日期：2026-07-23
- 相关 Issue：#82

## Context

历史高权限租户角色同时容易被理解为平台级管理员和租户级管理员，无法清晰表达平台运营与租户自治的边界。Issue #82 的人工确认要求保留不属于任何租户的 `platform_admin`，并将客户业务角色重命名为 `tenant_manager` 与 `operator`。

该决定涉及认证、授权、租户隔离和数据库模型。2026-07-23 已获得人工批准，允许同步迁移角色名称、数据、代码和文档。

## Decision

采用三层角色边界：

- `platform_admin`：平台级身份，不绑定 tenant，只能执行明确列出的平台运营操作；默认不得读取租户业务明细、邮件正文或人员邮箱。
- `tenant_manager`：必须绑定且只能管理一个 tenant，可管理本租户地点、人员映射、审计查询与 `operator` 账号；当前每个 tenant 仅允许一名，且不能通过租户 API 创建或管理其他 `tenant_manager`。
- `operator`：必须绑定 tenant，只能管理授权地点内的人员映射、扫描和历史查询，不得管理地点、用户角色或跨地点移动。

所有租户级资源查询继续强制带服务端解析出的 `tenant_id` 条件，客户端参数不得覆盖身份上下文。平台级 API 使用独立路由与独立授权策略，禁止通过可空 tenant 条件复用租户级查询。

权限矩阵如下；“只读”均限于自身 tenant：

| 能力 | platform_admin | tenant_manager | operator |
| --- | --- | --- | --- |
| 创建、暂停、恢复 tenant | 允许 | 禁止 | 禁止 |
| 查看/修改订阅与套餐 | 允许 | 只读 | 禁止 |
| 管理登录用户与角色 | 仅平台身份治理 | 本 tenant 的 operator | 禁止 |
| 管理 location | 默认禁止租户业务写入 | 本 tenant | 禁止 |
| 管理人员映射 | 默认禁止租户业务写入 | 本 tenant | 本 tenant 已授权 location |
| 扫描、查询历史 | 禁止 | 本 tenant | 本 tenant 已授权 location |
| 导出审计与历史 | 禁止跨租户业务导出 | 本 tenant | 禁止 |

`platform_admin` 若需租户业务数据支持能力，必须另行建立显式、限时、可审计的授权机制，不包含在本 ADR。

## Alternatives considered

1. 继续让高权限租户角色兼任平台管理员：角色含义混杂，容易造成跨租户越权，否决。
2. 让 `platform_admin` 绑定一个“平台租户”：会把平台控制面伪装成普通租户，隔离规则不清晰，否决。
3. 仅在现有角色上增加权限标志：组合数量会快速增长，审计和测试边界不直观，暂不采用。

## Consequences

正面影响是平台与租户权限可独立审计，`tenant_manager` 不具备隐含跨租户能力，`operator` 的职责也更贴近业务操作。代价是需要迁移现有角色值并同步所有鉴权、种子、测试和文档。

## Migration impact

将现有高权限租户角色数据迁移为 `tenant_manager`，将现有业务操作角色迁移为 `operator`。平台身份存储仍由后续平台管理 Issue 决定；本次不创建 `platform_admin` 运行时账号或跨租户 API。

## Security impact

这是高风险授权边界变更。实现必须覆盖：平台身份不能调用租户业务接口；`tenant_manager` 不能跨租户且只能管理 `operator`；`operator` 不能管理地点或角色；审计记录不得包含未脱敏 PII。

## Operational impact

需要独立的平台管理员初始化和撤销流程、异常访问告警以及账号恢复 Runbook。不得通过普通租户注册或管理页面创建 `platform_admin`。

## Follow-up

本次完成租户角色数据迁移、鉴权、文档同步与 `tenant_manager` 管理 `operator` 的生命周期 API。密码由 `tenant_manager` 在创建/重置请求中提交，至少 8 位且使用英文字母与数字组合。平台认证/授权、平台管理 API 与 `tenant_manager` 数量及相互管理规则另建 Issue；Issue #83 的套餐能力不在本次实现。
