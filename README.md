# Poolduck Mail（暂定名）

Poolduck Mail 是一个面向企业客户的 Web SaaS 项目，目标是支持客户使用扫码枪扫描条码/二维码后，系统自动识别目标邮箱并触发邮件发送。

## 当前项目阶段

当前处于 **MVP 技术栈定版后的工程初始化阶段**：

- 已完成产品范围、业务流程、租户隔离与订阅规则文档化。
- 已通过 ADR-004 提出 MVP 技术栈（状态：`Proposed`，待人工批准）。
- 当前已完成前后端基础工程骨架，后续进入功能实现迭代。

## MVP 技术栈摘要（以 ADR-004 为准）

- 前端：Next.js（App Router）+ TypeScript + Tailwind CSS
- 后端：NestJS（Node.js 20 LTS，REST API）
- 数据库：PostgreSQL 16 + Prisma
- 认证与授权：JWT（access/refresh）+ RBAC（root_admin / manager）
- 邮件发送：MVP 使用 Sandbox/Mock provider（不接入真实邮件服务）
- 测试：Vitest / Testing Library（前端）、Jest / Supertest（后端）、Playwright（E2E）
- CI：GitHub Actions（lint、typecheck、tests 为最小门禁）

> 说明：后续实现 Issue 必须遵循 `docs/decisions/ADR-004-tech-stack-for-mvp.md`，未经人工批准不得自行更换核心技术栈。

## 本地开发入口（当前状态）

当前仓库已初始化后端工程骨架（NestJS + TypeScript）。

- 后端目录：`backend/`
- 安装依赖：`cd backend && npm install`
- 启动开发服务：`npm run start:dev`
- 默认健康检查地址：`GET http://localhost:3001/health`
- 运行测试：`npm test`

> 如需自定义端口，可在 `backend/.env` 或环境变量中设置 `APP_PORT`。

- 前端目录：`frontend/`
- 安装依赖：`cd frontend && npm install`
- 启动前端开发服务：`npm run dev`
- 前端健康检查地址：`GET http://localhost:3000/healthz`
- 前端构建：`npm run build`
- 前端测试：`npm test`

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
2. **#18**：前端工程初始化（Next.js + TypeScript + Tailwind）。
3. **#19**：后端工程初始化（NestJS + Prisma + PostgreSQL）。
4. 认证、租户上下文、订阅校验最小闭环。
5. Sandbox 邮件任务链路与状态跟踪。
6. 再进入真实邮件 provider 的评估与接入（非 MVP 首批）。

## 开发约束（当前阶段）

- 不实现正式业务代码（仅文档与决策）。
- 不提交 secrets / token / 真实客户数据。
- 新功能开发前先完善 ADR、Issue 与测试计划。
