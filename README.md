# Poolduck Mail（暂定名）

Poolduck Mail 是一个面向企业客户的 Web SaaS 项目，目标是支持客户使用扫码枪扫描条码/二维码后，系统自动识别目标邮箱并触发邮件发送。

## 当前项目阶段

当前处于 **MVP Staging 冒烟验证完成后的运维补强阶段**：

- 已完成产品范围、业务流程、租户隔离与订阅规则文档化。
- 已通过 ADR-004 确认 MVP 技术栈（状态：`Accepted`）。
- 已完成前后端基础工程骨架。
- 已完成 Local Docker Compose 开发环境，当前可通过 Docker Compose 启动 PostgreSQL 16，也可一键启动 Frontend / Backend / PostgreSQL 本地容器组。
- 已生成并实施 OCI Always Free Staging 基线，当前 Staging 通过 public IP 暂时提供 HTTP 验证入口。
- 本地工作区已补齐认证与租户上下文、订阅门禁、location/人员映射、扫码事件、mail_job 生成与 sandbox 发送触发链路；#58 已完成 Staging 部署、seed、API 冒烟、订阅阻断与 mock success/failure 验证。

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

当前仓库已初始化前后端工程骨架，并已完成 Local Docker Compose 开发环境。

### 本地 Docker Compose

运行前人工检查项：

- 本机可执行 Docker / Docker Compose。
- 默认端口未被占用：PostgreSQL `5432`、Backend `3001`、Frontend `3000`。
- 如本机已有 PostgreSQL 占用 `5432`，先在本地 `.env` 中改用 `POSTGRES_PORT=5433` 等端口映射。
- 不要在 `.env`、compose 文件或文档中写入真实数据库密码、真实客户数据、真实邮件凭据。

启动完整本地容器组：

1. 复制环境变量示例：
   - Windows: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. 构建并启动容器组：`docker compose up -d --build`
3. 查看健康状态：`docker compose ps`
4. 健康检查：
   - Frontend: `GET http://localhost:3000/healthz`
   - Backend: `GET http://localhost:3001/health`
5. 初始化本地测试数据：`docker compose exec backend npm run local:seed`
6. API 冒烟：`docker compose exec backend npm run smoke:api`
7. 打开 MVP 工作台：`http://localhost:3000/`

常用容器操作：

- 仅启动 PostgreSQL（兼容宿主机开发入口）：`docker compose up -d postgres`
- 查看日志：`docker compose logs -f backend` / `docker compose logs -f frontend`
- 停止容器组：`docker compose down`
- 停止并清空本地数据库卷：`docker compose down -v`
- 重建镜像：`docker compose build --no-cache backend frontend`
- 验证数据库连接：
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`

`docker-compose.yml` 默认启动 `postgres`、`backend`、`frontend` 三个服务。Backend 容器使用 Compose 内部 service name `postgres` 连接数据库；宿主机直接启动后端时仍使用 `.env.example` 中的 `localhost` 数据库地址。

- 后端目录：`backend/`
- 安装依赖：`cd backend && npm install`
- 数据库连接串：`DATABASE_URL=postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`
- 认证本地变量：`JWT_SECRET` 需设置为本地测试值，`JWT_ACCESS_TOKEN_TTL_SECONDS` 默认示例为 `86400`（24 小时，支持扫码工作台长时间值守）
- 本地 CORS：后端默认允许 `CORS_ORIGIN=http://localhost:3000`；如果前端端口变化，需要同步修改后端环境变量
- 启动开发服务：`npm run start:dev`
- 默认健康检查地址：`GET http://localhost:3001/health`
- 运行测试：`npm test`

> 如需自定义端口，可在 `backend/.env` 或环境变量中设置 `APP_PORT`。

- 前端目录：`frontend/`
- 安装依赖：`cd frontend && npm install`
- API 地址：默认读取 `NEXT_PUBLIC_API_BASE_URL`，未设置时使用 `http://localhost:3001`
- 启动前端开发服务：`npm run dev`
- 前端健康检查地址：`GET http://localhost:3000/healthz`
- 前端构建：`npm run build`
- 前端测试：`npm test`
- MVP 登录与扫码工作台：`GET http://localhost:3000/`

## 本地测试、GUI 黑盒与 Staging 判断

### 当前可立即执行的本地测试

在提交 PR 或进入 Staging 前，至少执行：

- 后端单元/集成测试：`cd backend && npm test`
- 后端构建：`cd backend && npm run build`
- Prisma schema 校验：`cd backend && npm run db:validate`
- 如本地 PostgreSQL 已启动并完成迁移，可执行数据库 smoke：`cd backend && npm run test:db`
- 本地测试 seed：`cd backend && npm run local:seed`
- 本地 API 冒烟：后端服务启动后执行 `cd backend && npm run smoke:api`
- 前端测试：`cd frontend && npm test`
- 前端构建：`cd frontend && npm run build`
- 本地 GUI 黑盒入口：后端与前端服务启动后，打开 `http://localhost:3000/`，使用 #55 seed 账号完成登录、location 选择、扫码提交与 sandbox 发送触发。
- 本地容器组冒烟：`docker compose up -d --build` 后检查 `http://localhost:3000/healthz`、`http://localhost:3001/health`，再执行 `docker compose exec backend npm run local:seed` 与 `docker compose exec backend npm run smoke:api`。
- GUI 黑盒与 E2E 记录：`docs/testing/gui-black-box-2026-06-30.md`

本地 seed 会创建固定的安全示例数据（均为 `example.local`，不包含真实客户数据）：

- active tenant：`11111111-1111-4111-8111-111111111111`
- manager：`manager@example.local` / `PoolduckLocal123!`
- root admin：`root-admin@example.local` / `PoolduckLocal123!`
- location：`66666666-6666-4666-8666-666666666666`
- active scan code：`SCAN-LOCAL-001`
- unmapped scan code：`SCAN-LOCAL-UNMAPPED`

API smoke 默认验证 sandbox success。若要验证 sandbox failure，先用 `MAIL_MOCK_SEND_RESULT=failure` 启动后端，再执行：

- Windows PowerShell: `$env:API_SMOKE_EXPECT_SEND_STATUS='failed'; npm run smoke:api`
- macOS/Linux: `API_SMOKE_EXPECT_SEND_STATUS=failed npm run smoke:api`

### Staging deployment status

Issue #58 was executed on 2026-07-07 against the OCI Staging VM using temporary public-IP HTTP access.
The current rebuilt Staging VM public entry is `http://140.245.94.111/`, with Nginx proxying public port `80` to the internal Frontend and Backend containers.

Current Staging result:

- Backend health: `http://140.245.94.111/health` passed after 2026-07-09 rebuild.
- Frontend health: `http://140.245.94.111/healthz` passed after 2026-07-09 rebuild.
- Synthetic seed data was applied. New Staging-only seed data can be refreshed with `docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed`.
- API smoke passed for login, license, locations, scan event, queued mail job, and mock send success.
- Suspended subscription smoke passed with `SUBSCRIPTION_NOT_SENDABLE`.
- Mock send failure smoke passed, and the final Staging state was restored to `MAIL_MOCK_SEND_RESULT=success`.

Detailed results are recorded in `docs/testing/staging-smoke-2026-07-07.md`.
Real secrets, Terraform state, `terraform.tfvars`, and customer data remain outside Git.

### Staging 何时可以部署

Staging 部署不应直接从“代码能编译”开始。建议满足以下条件后再执行：

- #55 完成：本地 seed/test data 与 API 冒烟链路可重复执行。
- #60 完成：本地 Frontend / Backend / PostgreSQL 容器组可重复启动并通过健康检查。
- #37 完成或人工确认：Staging 部署流程、环境变量、secrets 边界已明确。
- #56 至少完成最小 GUI，或人工确认本轮 Staging 只验证 API。
- sandbox/mock mail provider 保持启用，确认不会真实发信。
- Staging 使用独立测试数据，不导入真实客户数据。

### GUI 黑盒测试何时可以开始

- 本地 GUI 黑盒测试：#55 与 #56 完成后即可开始，由 #57 执行。
- Staging GUI 黑盒测试：#57 本地通过且 #58 Staging 部署冒烟通过后开始。
- GUI 黑盒测试前必须确认：登录测试账号、tenant、subscription、location、person_mapping、sandbox success/failure 数据都可复现。

## 文档导航

- 产品说明：`docs/product.md`
- 需求说明：`docs/requirements.md`
- 架构设计：`docs/architecture.md`
- 数据库设计：`docs/database.md`
- API 草案：`docs/api.md`
- 开发流程：`docs/workflow.md`
- 测试策略：`docs/testing.md`
- 基础设施总览：`docs/infrastructure.md`
- 基础设施资源台账：`docs/inventory/infrastructure-inventory.md`
- 环境参数表：`docs/inventory/environment-parameters.md`
- Secrets 台账：`docs/inventory/secrets-inventory.md`
- 外部服务台账：`docs/inventory/external-services.md`
- 云资源参数表：`docs/inventory/cloud-resources-parameters.md`
- 环境定义：`docs/environments.md`
- 网络策略：`docs/network.md`
- 部署说明：`docs/deployment.md`
- 发布规范：`docs/release.md`
- 运维手册：`docs/operation.md`
- 用户手册：`docs/user-guide.md`
- 管理员手册：`docs/admin-guide.md`
- ADR 列表：`docs/decisions/`

## 推荐的 Issue 执行顺序

### 已完成 / 基线任务

- **#17**：MVP 技术栈 ADR 定版与文档对齐。
- **#18**：前端工程初始化。
- **#19**：后端工程初始化。
- **#20**：建立 CI 基础工作流。
- **#31**：审查当前阶段成果与文档一致性。
- **#35**：设计 Local/Staging/Production 基础设施架构。
- **#41**：更新 Issue 模板，强制填写人工准备与外部前提。
- **#43**：新增基础设施资源台账与环境参数表。
- **#36**：创建 Local Docker Compose 开发环境。
- **#48**：生成 OCI Always Free Staging 基础设施 IaC，等待人工确认后实施。
- **#21**：实现数据库迁移基础与初始模型。
- **#22**：实现租户登录与用户认证 API。
- **#33**：认证与租户上下文中间件最小实现。
- **#23**：实现订阅状态检查与扫码发送限制基础。
- **#24**：实现 location 与人员映射只读 API。
- **#25**：实现扫码事件创建与固定邮件任务生成 API。
- **#26**：实现邮件 sandbox provider 与发送触发 API。
- **#55**：准备本地测试种子数据与 API 冒烟验证。
- **#56**：实现 MVP 登录与扫码工作台最小前端界面。
- **#60**：容器化前端与后端，提供本地一键启动容器组。
- **#57**：制定并执行 GUI 黑盒与 E2E 冒烟测试。
- **#58**：执行 Staging 部署与环境冒烟验证。

### 当前后续执行顺序

1. **#38**：设计 PostgreSQL 备份与恢复策略。
2. **#39**：设计日志、监控与告警策略。
3. **Staging 域名/TLS follow-up**：在扩大外部测试前，为当前 public-IP HTTP Staging 补齐域名、TLS 与访问控制策略。

### 业务实现依赖关系（按当前执行计划）

- #48 已提供 Staging 云资源 IaC 基线；#37 在此基础上继续补齐部署流程与环境变量边界，避免后续实现后再倒补部署规则。
- #21 提供数据库基础模型，是 #22/#23/#24/#25/#26 的数据前置。
- #38 补齐 PostgreSQL 备份与恢复策略，确保后续 migration 与生产化路径有基线。
- #39 补齐日志、监控与告警策略，为登录、订阅门禁、扫码异常、邮件发送失败等实现提供日志基线。
- #22 与 #33 共同形成认证与 tenant scope 闭环；#23/#24/#25/#26 依赖该闭环。
- #23 提供订阅门禁规则，是 #25/#26 的前置门禁。
- #24 提供 location + 人员映射只读能力，是 #25 的直接前置。
- #25 完成扫码事件与固定邮件任务生成后，#26 才执行发送触发。
- #55 将本地 API 链路变成可重复验证的 smoke 流程，是 #56/#57/#58 的测试数据前置。
- #56 提供可操作 GUI，是 #57 GUI 黑盒测试的前置。
- #60 提供本地容器组启动基线，是 #57 前确认 GUI 与 API 可在容器形态下恢复的前置补强。
- #57 给出本地 GUI 黑盒结论；通过后再进入 #58 Staging 环境验证。
- #37 明确 Staging 部署流程与环境变量边界，是 #58 的部署前置。
- #58 只做 Staging 部署与冒烟验证；真实邮件 provider、自动队列、生产发布仍需后续 Issue。

> 说明：Issue 优先级按实施依赖排序，不按编号大小排序。

> 说明（2026-05-27 对齐）：本仓库后续实现编号以本 README 的“推荐的 Issue 执行顺序”为准。
> ADR-004 中 Follow-up 的旧编号仅用于历史追溯，不作为当前排期依据。

### 文档一致性 SSOT（实现前）

- 角色：`root_admin` / `manager`。
- 订阅状态：`trial` / `active` / `expired` / `suspended`。
- 登录流程：`tenant_id` + email + password。
- 邮件正文：后端固定模板生成，不支持自定义正文。

## 开发约束（当前阶段）

- 当前已进入实现准备阶段：按“推荐的 Issue 执行顺序”推进，优先完成 #37/#21 等基础任务。
- 不提交 secrets / token / 真实客户数据。
- 新功能开发前先确认 ADR、Issue、人工准备项与测试计划。

## Staging deployment design note (Issue #37)

Staging deployment is currently defined as a manual OCI Always Free workflow until a separate CI/CD issue is approved. The design uses the `infrastructure/oci-staging/` baseline from Issue #48, allows temporary public-IP access when no domain exists, requires isolated Staging PostgreSQL data, and keeps mail delivery on `mock` or `sandbox`.

Primary references:

- `docs/deployment.md` section "Staging deployment design (Issue #37)"
- `docs/environments.md` section "Staging environment baseline (Issue #37)"
- `docs/inventory/environment-parameters.md` section "Staging baseline for Issue #37"

Real OCIDs, Terraform tfvars, OCI credentials, database URLs, JWT secrets, mail credentials, and customer data must stay outside the repository.

## Database migration baseline (Issue #21)

Backend schema migrations are managed with Prisma in `backend/prisma/`.

Common commands:

- `cd backend && npm run db:validate`
- `cd backend && npm run db:migrate` for local development
- `cd backend && npm run db:deploy` for committed migrations in CI/Staging-like environments
- `cd backend && npm run prisma:generate`
- `cd backend && npm run test:db` for a synthetic model smoke test against a disposable/local database

The initial schema creates `tenants`, `users`, `subscriptions`, `devices`, `locations`, `person_mappings`, `scan_events`, `mail_jobs`, and `audit_logs`. Real database URLs, dumps, generated clients, and customer data must not be committed.
