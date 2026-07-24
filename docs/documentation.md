# 文档职责与一致性维护

本文定义仓库文档的职责边界、单一真源（SSOT）和阶段性整理检查。目标是让 README 保持简洁，并避免同一规则在多处独立维护后发生漂移。

## 1. 文档职责

| 内容 | 单一真源 | 其他文档如何引用 |
|---|---|---|
| 产品入口、产品目标、核心流程、MVP 状态与边界 | `README.md` | 不放开发命令、技术过程或 Issue 排期 |
| 产品目标与 MVP 范围 | `docs/product.md` | 需求与手册不得扩大范围 |
| 业务规则与功能需求 | `docs/requirements.md` | API、架构和手册保持实现口径一致 |
| 开发入口与验证流程 | `docs/development.md` | 汇总入口，详细规则继续引用主题文档 |
| Issue 历史、当前跟进项与产品改进索引 | `docs/issue-archive.md` | GitHub Issue 仍是实时 Scope 与状态权威来源 |
| 已接受的重要决策 | `docs/decisions/` | 架构文档总结，不能覆盖 ADR |
| 运行架构与安全边界 | `docs/architecture.md` | 部署文档只描述环境落地 |
| 数据模型 | `docs/database.md` | API 与实现使用相同字段和枚举 |
| API 契约 | `docs/api.md` | 用户手册不重复请求/响应细节 |
| 环境差异与网络规则 | `docs/environments.md`、`docs/network.md` | 部署文档引用这些约束 |
| 部署与 Staging 操作 | `docs/deployment.md`、`docs/staging-manual.md` | README 仅保留入口和风险摘要 |
| 实际资源与非敏感参数 | `docs/inventory/` | 操作前仍需实时复核云平台/Terraform |
| 测试策略与验证证据 | `docs/testing.md`、`docs/testing/` | README 不复制完整账号、矩阵或报告 |
| 用户可见行为 | `docs/user-guide.md`、`docs/admin-guide.md` | 与已实现行为同步，不写未实现能力为现状 |

## 2. 核心术语与规则 SSOT

- `tenant` 是一级数据隔离边界。
- `location` 是办公室、学校或校舍的统一技术抽象；字段使用 `location_id`，不引入 `office_id` 等并行命名。
- 角色集合为 `tenant_manager` / `operator`。
- 订阅状态集合为 `trial` / `active` / `expired` / `suspended`。
- 登录输入为 `tenant_id + identifier + password`；operator 使用 username 或可选 email，
  tenant_manager 使用 email。登录后 tenant scope 来自后端认证上下文。
- 邮件正文由后端固定模板生成，MVP 不接受前端自定义正文。
- 仅 `trial`、`active` 允许扫码和发送；`expired`、`suspended` 必须阻断扫码提交、邮件任务创建、发送与重试。

上述规则的决策依据分别位于 ADR-002、ADR-003、ADR-010 与相关产品/需求文档。若需要改变规则，应按
`AGENTS.md` 创建或 supersede ADR，并等待人工批准。

## 3. 当前状态与历史记录

- GitHub Issue 是 Issue Scope、编号语义和实时状态的权威来源；`docs/issue-archive.md` 维护仓库内索引。
- README 只保留产品信息，不维护开发命令、Issue 顺序或开发历史。
- `docs/testing/*.md` 和 `docs/reviews/*.md` 是带日期的执行证据或历史快照；其中的 IP、阶段判断、阻塞项和建议不得视为当前状态。
- 云资源台账只记录非敏感基线。部署或运维前必须从云平台、Terraform state 和当前容器状态实时确认。
- 已接受 ADR 中的历史背景和原始 Follow-up 保留用于追溯；若编号后来变化，应明确标注历史映射失效，不让 README 反向覆盖 ADR 决策。

## 4. AGENTS.md 与 skills 自检

仓库级 `AGENTS.md` 已生效的可观察条件：

- 任务开始时能发现本文件以及 `skills/` 下的 5 个 skill。
- 涉及架构、认证、授权、tenant isolation、订阅、数据库、API 或邮件发送时，会先检查相关 ADR 状态。
- 行为变化会按文档策略路由到对应主题文档。
- 重要架构决策在 ADR `Accepted` 前不会进入实现。

Skill 触发矩阵：

| 任务 | 必读 skill | 最小输出/约束 |
|---|---|---|
| 拆分 GitHub Issues | `skills/planning.md` | 小范围 Issue、Scope/Out of scope、验收和人工决策标记 |
| 架构变更 | `skills/architecture-decision.md` | 使用 ADR 模板，等待 `Accepted` 后实施 |
| PR 审查 | `skills/code-review.md` | 先安全与租户隔离，再给出最终判断 |
| 测试规划 | `skills/test-design.md` | 正常、异常、权限、租户、边界与回归场景 |
| 发布准备 | `skills/release-check.md` | 测试、迁移、备份、回滚、配置、smoke 与 secret 检查 |

自检的含义是确认触发条件、读取路径和约束可执行；它不等于每个任务都必须套用全部 skill。未匹配任务的 skill 不应被机械调用。

## 5. 阶段性整理清单

- [ ] README 只保留产品定位、核心流程、产品能力、当前产品状态和 MVP 边界。
- [ ] 开发命令与验证入口统一维护在 `docs/development.md`。
- [ ] 历史、当前跟进项和产品改进 Issue 已登记到 `docs/issue-archive.md`。
- [ ] ADR 状态与引用一致，历史 Issue 编号已明确标为历史。
- [ ] 产品、需求、架构、数据库、API 和用户手册的角色、订阅状态、登录流程、location 与邮件模板一致。
- [ ] Staging/Production 的现状、目标态和历史验证记录已区分。
- [ ] `docs/inventory/` 已反映非敏感资源基线，且没有 secret、PII 或客户数据。
- [ ] 带日期的 review/testing 报告明确属于历史证据，不被当成当前计划。
- [ ] 新增或移动文档后，README 导航和 Markdown 相对链接仍有效。
