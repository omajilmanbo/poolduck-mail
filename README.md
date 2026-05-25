# Poolduck Mail（暂定名）

Poolduck Mail 是一个面向企业客户的 Web SaaS 项目，目标是支持客户使用扫码枪扫描条码/二维码后，系统自动识别目标邮箱并触发邮件发送。

## 当前项目阶段

当前处于 **MVP 实现前的技术定版阶段**：

- 已完成产品范围、业务流程、租户隔离与订阅规则文档化。
- 已通过 ADR-004 提出 MVP 技术栈（状态：`Proposed`，待人工批准）。
- 本阶段 **不实现业务代码**，仅完成实现前的技术与文档对齐。

## MVP 技术栈摘要（以 ADR-004 为准）

- 平台：Cloudflare（Pages / Workers Static Assets / Workers API / D1 / Queues）
- 数据层：Cloudflare D1（单库多租户 tenant_id 隔离）
- 认证与授权：JWT + RBAC（root_admin / manager）
- 邮件发送：Mail Provider Adapter（AWS SES / OCI Email Delivery / Gmail API），MVP 默认 Sandbox/Mock
- CI：GitHub Actions（lint、typecheck、tests、文档一致性检查）

> 说明：后续实现 Issue 必须遵循 `docs/decisions/ADR-004-tech-stack-for-mvp.md`，未经人工批准不得自行更换核心技术栈。

## 本地开发入口（当前状态）

当前仓库尚未初始化前后端代码目录。

- 工程初始化与脚手架落地：待后续 Issue（建议 #18 / #19）完成。
- 初始化完成后，本节会补充：安装依赖、环境变量、启动前后端、测试命令。

## 文档导航

- 产品说明：`docs/product.md`
- 需求说明：`docs/requirements.md`
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
- ADR 列表：`docs/decisions/`

## 推荐的 Issue 执行顺序

1. **#17**：MVP 技术栈 ADR 定版与文档对齐（当前 Issue）。
2. **#18**：前端工程初始化（Cloudflare Pages / Workers Static Assets 适配）。
3. **#19**：后端工程初始化（Workers API + D1）。
4. 认证、租户上下文、订阅校验最小闭环。
5. Queues 邮件任务异步链路与状态跟踪。
6. Mail Provider Adapter 接入（AWS SES / OCI / Gmail API，默认 sandbox/mock）。

## 开发约束（当前阶段）

- 不实现正式业务代码（仅文档与决策）。
- 不提交 secrets / token / 真实客户数据。
- 新功能开发前先完善 ADR、Issue 与测试计划。
