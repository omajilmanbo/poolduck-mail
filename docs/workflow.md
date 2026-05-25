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

- 明确背景、范围、验收标准
- 标注角色标签（如 `role:backend`）
- 标注风险标签（如 `risk:auth`）
- 涉及高风险（auth/billing/data/security）需人工审批

## 4. PR 要求

- 关联 Issue（`Closes #id` 或 `Refs #id`）
- 填写变更内容、测试、风险、文档更新
- 不允许混入无关重构
- 业务行为变更必须同步更新 docs

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
