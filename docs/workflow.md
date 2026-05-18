# 研发工作流（SaaS 扫码发邮项目）

> 目标：在正式开发前，统一分支、Issue、任务拆分、测试与发布协作规则，使团队可直接从第一个 Issue 开始执行。

## 1. 分支策略

- `main`：稳定分支，仅接受通过评审与测试的合并。
- `develop`：集成分支，用于汇总已完成功能。
- `feature/<issue-id>-<short-name>`：功能开发分支（例如 `feature/1-scan-input-ui`）。
- `fix/<issue-id>-<short-name>`：缺陷修复分支。
- `chore/<short-name>`：文档、CI、模板等非功能代码维护。

### 分支保护建议

- `main` / `develop` 必须启用：
  - 至少 1 位评审通过
  - CI 必须通过
  - 禁止直接 push

## 2. Issue 到开发的标准流程

1. 在 GitHub 使用模板创建 Issue（Feature / Bug）。
2. 负责人补充：范围、验收标准、测试要求、风险标签。
3. 创建分支：
   - `feature/<issue-id>-<short-name>` 或 `fix/<issue-id>-<short-name>`
4. 开发与自测：
   - 必须按 `docs/testing.md` 的测试规则补齐案例与结果。
5. 提交 PR：
   - 使用 PR 模板，关联 Issue（`Closes #<id>`）。
6. 通过评审和 CI 后合并到 `develop`。
7. 达到发布标准后，从 `develop` 合并至 `main`。

## 3. 任务拆分规则（Issue 粒度）

- 每个 Issue 建议 1–8 小时可完成。
- 禁止创建过大的“史诗任务”直接开发，先拆解。
- 每个 Issue 必须包含：
  - 背景（Background）
  - 范围（Scope）
  - 非范围（Out of scope）
  - 验收标准（Acceptance criteria）
  - 测试要求（Test requirements）
  - 推荐标签（Recommended labels）
  - 风险标签（Risk labels）
  - 是否需要人工决策（Human decision required）

## 4. 标签约定

### 类型标签（type）

- `type:feature`
- `type:bug`
- `type:chore`
- `type:test`
- `type:docs`

### 模块标签（area）

- `area:scanner-input`
- `area:mail-routing`
- `area:email-delivery`
- `area:tenant`
- `area:admin`
- `area:infra`

### 风险标签（risk）

- `risk:low`
- `risk:medium`
- `risk:high`
- `risk:security`
- `risk:data`

## 5. Definition of Ready（DoR）

Issue 开发前必须满足：

- 需求目标明确
- 依赖已标记
- 验收标准可测试
- 风险等级已评估
- 是否需要人工决策已标记

## 6. Definition of Done（DoD）

Issue 完成必须满足：

- 代码与文档同步更新
- 自动化测试通过（至少包含对应层级测试）
- 手工测试步骤可复现并记录结果
- PR 完成评审并关联 Issue
