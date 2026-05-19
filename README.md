# Poolduck Mail（暂定名）

Poolduck Mail 是一个面向企业客户的 Web SaaS 项目，目标是支持客户使用扫码枪扫描条码/二维码后，系统自动识别目标邮箱并触发邮件发送。

> 当前仓库阶段为“事前准备”，仅包含文档、模板、流程与规范，不包含正式业务功能实现。

## 当前目标

- 明确产品 MVP 范围与不做事项
- 明确架构、数据库、API 草案
- 标准化 Issue / PR 模板
- 建立测试、发布、运维基线

## 文档导航

- 产品说明：`docs/product.md`
- 架构设计：`docs/architecture.md`
- 数据库设计：`docs/database.md`
- API 草案：`docs/api.md`
- 开发流程：`docs/workflow.md`
- 测试策略：`docs/testing.md`
- 部署说明：`docs/deployment.md`
- 发布规范：`docs/release.md`
- 运维手册：`docs/operation.md`
- 用户手册：`docs/user-guide.md`
- 管理员手册：`docs/admin-guide.md`
- ADR：`docs/decisions/ADR-001-use-web-saas-for-mvp.md`

## 开发约束（当前阶段）

- 不实现正式业务代码
- 不提交 secrets / token / 真实客户数据
- 新功能开发前先完善 ADR、Issue 与测试计划

## 分支与 PR

- 推荐分支命名：`type/short-description`，例如 `setup/docs-and-templates`
- PR 必须使用仓库模板，填写测试与文档更新项
