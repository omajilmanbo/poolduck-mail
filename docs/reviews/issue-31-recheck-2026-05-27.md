# 当前阶段审查报告（复查）

> 历史快照：本文记录 2026-05-27 的审查结论，其中部分问题已在后续实现和文档更新中解决。
> 当前阶段、Issue 状态与 SSOT 请查看 `README.md`、`docs/documentation.md` 和对应 GitHub Issue；不要把本文的“是否进入下一阶段”结论视为当前门禁。

## 1. 总体结论
- 是否可以进入下一阶段：**需先修正**

## 2. 已确认一致的内容
- 已排除 MVP 的“自定义邮件正文”在核心文档中一致：`docs/api.md`、`docs/requirements.md`、`docs/user-guide.md` 均明确固定模板并禁止 `custom_message/custom_text/mail_body`。
- 订阅状态主集合在核心文档中一致：`trial` / `active` / `expired` / `suspended`。
- 用户角色主集合在核心文档中一致：`tenant_manager` / `operator`。
- 登录流程主口径在核心文档中一致：`tenant_id + email + password`（文案中“用户名/密码”与 API 的 `email/password` 表述可对齐但不冲突）。
- API 草案与数据库草案关于 `location_id` 维度隔离、`tenant_id + location_id + scan_code` 约束基本一致。

## 3. 发现的问题

| 严重度 | 文件 | 问题 | 建议处理 |
|---|---|---|---|
| High | README.md vs docs/decisions/ADR-004-tech-stack-for-mvp.md | README 写 ADR-004 状态为 `Proposed`，但 ADR 文件已是 `Accepted`，且 README 同时写“已完成工程骨架”，容易导致阶段判断冲突。 | 统一 README 的 ADR-004 状态与当前阶段描述。 |
| High | README.md vs ADR-004 | README 的顺序定义 `#21=数据库迁移`、`#26=sandbox provider`；但 ADR-004 的“后续影响”写 `#21=Sandbox Mail Provider`。Issue 编号语义冲突。 | 明确“当前权威编号映射”（建议以 README 最新执行计划为准），并在 ADR-004 增加“后续变更说明/已 superseded 部分”。 |
| Medium | docs/database.md / docs/requirements.md / docs/architecture.md | 同时使用“办公室/学校”与 `location` 术语，字段命名虽基本统一为 `location_*`，但中文术语仍可能引起实现歧义。 | 在术语表补充“office/school 统一抽象为 location”，避免新 Issue 再引入 `office_id`。 |
| Medium | .github/ISSUE_TEMPLATE | 模板未显式要求“标注是否影响 SSOT（角色、订阅状态、登录、固定正文）”。 | 增加 checklist，强制提交人声明是否触及 SSOT，并引用对应文档。 |
| Low | docs/testing.md / workflow docs | 对“tenantId/权限/邮件目标地址异常测试”要求存在，但可执行检查清单粒度不足。 | 增加最小异常测试矩阵（跨租户、订阅失效、目标邮箱空/非法、location 越权）。 |

## 4. 缺失项
- 缺少“术语与编号单一真源（SSOT）页”：统一维护 `location`、角色、订阅状态、Issue 编号映射。
- 缺少“README 与 ADR 交叉校验”发布前检查条目，导致本次出现状态与顺序冲突。
- 缺少 #21～#26 的“输入/输出契约图”（每个 Issue 消费和产出哪些表/API/中间件能力）。

## 5. 建议新增或修改的 Issue
- 标题：`[Task] 对齐 README 与 ADR-004 的阶段状态与 Issue 编号映射`
- 背景：当前 README 与 ADR-004 在状态和 #21 语义冲突，影响排期与执行判断。
- 验收标准：
  - README 与 ADR-004 对“当前阶段”与“#21～#26 映射”完全一致；
  - 对历史编号变更给出注释，不删除可追溯信息；
  - 在 PR 中附冲突项对照表。

- 标题：`[Task] 新增 SSOT 一致性检查清单（Issue/PR 模板）`
- 背景：避免后续再次出现角色、订阅状态、登录流程、邮件正文模板漂移。
- 验收标准：
  - `.github/ISSUE_TEMPLATE/*` 与 PR 模板增加 SSOT 检查项；
  - 要求勾选是否影响 docs/api.md、docs/database.md、docs/requirements.md；
  - CI 或 review checklist 可见该检查项。

## 6. 对 #21～#26 执行顺序的评价
- 依赖逻辑总体合理：先数据模型与认证租户闭环，再做订阅门禁、映射只读、扫码任务、发送触发。
- 但在“编号语义冲突”未修正前，不建议直接推进实现；否则开发者可能按 ADR-004 的旧编号理解 #21。
- 建议先完成“编号映射对齐任务”，再继续 #21。

## 7. 是否建议继续执行 #21
- **否（当前复查结论）**
- 理由：存在高优先级文档冲突（README vs ADR-004），会直接影响 #21 的任务定义与实现边界，需先文档对齐后再进入开发。
