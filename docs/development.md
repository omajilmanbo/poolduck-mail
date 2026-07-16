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
