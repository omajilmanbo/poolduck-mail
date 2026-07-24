# 开发入口与验证流程

本文集中维护开发过程入口。README 只描述产品，不再维护本地命令、测试步骤、部署状态或 Issue 顺序。

## 1. 技术基线

- Frontend：Next.js（App Router）+ TypeScript + Tailwind CSS
- Backend：NestJS + Node.js 20 LTS + TypeScript
- Database：PostgreSQL 16 + Prisma
- Auth：JWT + RBAC
- Mail：MVP 仅使用 mock/sandbox provider
- Test：Vitest / Testing Library、Jest / Supertest、Playwright
- CI：GitHub Actions

技术选型以 `docs/decisions/ADR-004-tech-stack-for-mvp.md` 为准。

## 2. 本地 Compose 快速启动

运行前确认 Docker / Docker Compose 可用，且默认端口 `3000`、`3001`、`5432` 未被占用。不要在 `.env`、Compose 文件或文档中写入真实 secret、客户数据或邮件凭据。

1. 创建本地配置：Windows 执行 `copy .env.example .env`；macOS/Linux 执行 `cp .env.example .env`。
2. 启动容器组：`docker compose up -d --build`。
3. 检查状态：`docker compose ps`。
4. 写入安全示例数据：`docker compose exec backend npm run local:seed`。
5. 执行 API smoke：`docker compose exec backend npm run smoke:api`。
6. 打开工作台：`http://localhost:3000/`。

健康检查：

- Frontend：`GET http://localhost:3000/healthz`
- Backend：`GET http://localhost:3001/health`

常用命令：

- 仅启动 PostgreSQL：`docker compose up -d postgres`
- 查看日志：`docker compose logs -f backend` 或 `docker compose logs -f frontend`
- 停止容器组：`docker compose down`
- 删除本地数据库卷：`docker compose down -v`

## 3. 提交前验证

至少执行与变更相关的命令：

- Backend：`cd backend && npm run build && npm test && npm run db:validate`
- Frontend：`cd frontend && npm test && npm run build`
- 容器链路：启动容器组后执行 seed 与 API smoke

完整测试分层、异常矩阵和历史验证记录见 `docs/testing.md` 与 `docs/testing/`。

本地质量门禁命令：

- Backend：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`
- Frontend：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`
- 关键 E2E：准备合成 seed 并启动前后端后，在 `frontend/` 执行 `npm run test:e2e`

## 4. 开发文档入口

- 研发流程：`docs/workflow.md`
- 架构与 ADR：`docs/architecture.md`、`docs/decisions/`
- 数据库与 API：`docs/database.md`、`docs/api.md`
- 环境与网络：`docs/environments.md`、`docs/network.md`
- Local/Staging/Production 部署：`docs/deployment.md`
- Staging 人工操作：`docs/staging-manual.md`
- 测试与发布：`docs/testing.md`、`docs/release.md`
- 运维：`docs/operation.md`
- 基础设施与台账：`docs/infrastructure.md`、`docs/inventory/`
- Issue 归档：`docs/issue-archive.md`

## 5. 开发约束

- 每次只实现当前 Issue 的 Scope，不实现 Out of scope。
- MVP 邮件发送只使用 mock/sandbox provider。
- 不提交 secret、token、真实客户数据、Gmail 凭据或 OAuth refresh token。
- 涉及认证、授权、tenant isolation、订阅、数据库、API 或邮件发送时，先读取相关 ADR。
- 行为变化按 `AGENTS.md` 的文档策略更新对应主题文档。

## 6. 用户名/邮箱登录手工验证（Issue #99）

只使用 Local/Staging 合成账号：

1. 执行最新 migration 与 `local:seed`，用
   `tenant_id=11111111-1111-4111-8111-111111111111`、
   `identifier=local-operator` 登录，确认 operator username 登录成功。
2. 使用同一 operator 的 `operator@example.local` 登录，确认可选邮箱路径成功；使用
   `tenant-manager@example.local` 确认 tenant_manager 邮箱登录成功。
3. 以 tenant_manager 进入“用户管理”，创建只有 username、没有邮箱的 operator；退出后使用该 username
   登录。补充邮箱后确认两种身份均可登录，清空邮箱后确认只有 username 可登录。
4. 修改 operator username，确认旧会话立即失效、旧 username 登录失败、新 username 可登录。
5. 尝试同 tenant 大小写重复 username/email、保留字、Unicode username、跨 tenant 身份和错误密码，
   确认创建冲突明确，而登录统一返回 `LOGIN_FAILED` 且不显示账号类型或存在性。
6. 在 active/trial/suspended/expired 合成订阅下确认登录本身不受订阅状态影响；业务发送门禁仍分别按
   `can_send=true/true/false/false` 工作。
7. 停止后端后提交登录，确认前端显示网络错误；恢复后端后重新登录，不应保留密码输入。

自动验证至少运行：

- Backend：`npm test -- --runInBand test/auth.spec.ts test/users.spec.ts test/prisma-schema.spec.ts`
- Frontend：`npm test -- test/smoke.test.tsx test/users-page.test.tsx`
- 完整 GUI：准备 Local seed 并启动前后端后执行 `npm run test:e2e`
