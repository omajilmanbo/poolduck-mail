# 研发流程（GitHub Flow）

## 1. 标准链路

1. 创建/认领 GitHub Issue
2. 从主分支拉取并创建分支
3. 开发与自测
4. 提交 PR（使用模板）
5. 触发 CI 检查
6. Code Review
7. 合并到主分支

## 2. 分支命名建议

- `feature/*`：功能开发
- `fix/*`：缺陷修复
- `setup/*`：初始化与规范建设
- `docs/*`：纯文档更新

## 3. Issue 要求

Issue 使用 `.github/ISSUE_TEMPLATE/*.md` 的 Markdown 模板创建，正文采用 [#60](https://github.com/omajilmanbo/poolduck-mail/issues/60) 的内容丰富型格式，而不是由多个 Issue Form 输入框拼出的碎片化文本。

功能和任务类 Issue 默认包含：

- Background
- Scope
- Out of scope
- Acceptance criteria
- Test requirements
- Recommended labels
- Risk labels
- Human decision required

每个标题下可以写完整、可读的上下文和项目符号。不要为了简短删除 Scope、Out of scope、验收或测试要求；也不要把仓库通用安全规则、无关的运行环境说明和空的“无”占位重复进每一份 Issue。

仅在任务确实依赖人工决策、账号权限、Secrets、外部服务或特定环境时，在 `Human decision required` 中说明具体条件和停止边界。需求后续细化优先通过 Issue 评论补充。

- 每个 Issue 保持在约 1–8 小时可独立实施的粒度
- 标注角色标签（如 `role:backend`）和风险标签（如 `risk:auth`）
- 涉及高风险（auth/billing/data/security）或架构决策时，必须在实现前获得必要的人类审批

## 4. PR 要求

- 关联 Issue（`Closes #id` 或 `Refs #id`）
- 填写变更内容、测试、风险、文档更新
- 不允许混入无关重构
- 业务行为变更必须同步更新 docs
- 基础设施、环境变量、Secrets、外部服务发生变更时，必须同步更新 `docs/inventory/` 下对应台账文档

## 5. CI 建议检查项

- lint
- unit test
- integration test（按需）
- migration check（若存在数据库变更）

## 6. 合并策略

- 默认 squash merge
- 至少 1 名 reviewer 通过
- 所有必需检查通过后方可合并

## 7. CI 门禁（必需）

- 所有 PR 会自动触发 GitHub Actions CI（`.github/workflows/ci.yml`）。
- `main` 分支上的 push 也会触发同一套 CI。
- 合并前必须通过以下检查：
  - Backend：`npm ci && npm run build && npm test`（在 `backend/`）
  - Frontend：`npm ci && npm test && npm run build`（在 `frontend/`）
- 本地提交前建议先执行上述等价命令，避免 PR 红灯。
