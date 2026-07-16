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

Issue 应保持简短，默认只需要：

- **目标与范围**：问题、要做什么与明确不做什么
- **验收与测试**：可验证的完成条件和测试/检查方式
- **主要角色与风险标签**：如 `role:backend`、`risk:auth`

仅当确实依赖人工决策、账号权限、Secrets、外部服务或特定环境时，才填写“待确认 / 外部前提”。没有前提时不要为填写模板而添加“无”等占位文本。

需求在实施过程中变得更明确时，优先使用 Issue 评论补充；不要把每个潜在风险、仓库通用安全规则和执行环境重复写入每一份 Issue。

涉及高风险（auth/billing/data/security）或架构决策时，必须在实现前获得必要的人类审批；若缺少必需的权限、环境、Secrets、云资源或确认，Agent 必须停止并在 Issue 评论报告。

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
