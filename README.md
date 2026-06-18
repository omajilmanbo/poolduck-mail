# Poolduck Mail（暂定名）

Poolduck Mail 是一个面向企业客户的 Web SaaS 项目，目标是支持客户使用扫码枪扫描条码/二维码后，系统自动识别目标邮箱并触发邮件发送。

## 当前项目阶段

当前处于 **本地开发环境完成后的功能实现准备阶段**：

- 已完成产品范围、业务流程、租户隔离与订阅规则文档化。
- 已通过 ADR-004 确认 MVP 技术栈（状态：`Accepted`）。
- 已完成前后端基础工程骨架。
- 已完成 Local Docker Compose 开发环境，当前本地 PostgreSQL 16 可通过 Docker Compose 启动。
- 已生成 OCI Always Free Staging IaC，等待人工确认后在 `Mail_project_stg` 区间实施。
- 后续将在 Staging IaC 人工确认基础上补齐部署流程、数据库迁移基础、认证与租户上下文，再进入扫码邮件核心闭环。

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

启动本地 PostgreSQL 16：

1. 复制环境变量示例：
   - Windows: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. 启动数据库：`docker compose up -d postgres`
3. 查看健康状态：`docker compose ps`
4. 验证数据库连接：
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`

`docker-compose.yml` 默认只启动 PostgreSQL。本阶段前后端仍按本地 Node.js 进程运行，后端使用 `.env.example` 中的 `DATABASE_URL` 连接本地数据库。

- 后端目录：`backend/`
- 安装依赖：`cd backend && npm install`
- 数据库连接串：`DATABASE_URL=postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`
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

### 当前后续执行顺序

1. **#37**：设计 Staging 部署流程与环境变量。
2. **#21**：实现数据库迁移基础与初始模型。
3. **#38**：设计 PostgreSQL 备份与恢复策略。
4. **#39**：设计日志、监控与告警策略。
5. **#22**：实现租户登录与用户认证 API。
6. **#33**：认证与租户上下文中间件最小实现。
7. **#23**：实现订阅状态检查与扫码发送限制基础。
8. **#24**：实现 location 与人员映射只读 API。
9. **#25**：实现扫码事件创建与固定邮件任务生成 API。
10. **#26**：实现邮件 sandbox provider 与发送触发 API。

### 业务实现依赖关系（按当前执行计划）

- #48 已提供 Staging 云资源 IaC 基线；#37 在此基础上继续补齐部署流程与环境变量边界，避免后续实现后再倒补部署规则。
- #21 提供数据库基础模型，是 #22/#23/#24/#25/#26 的数据前置。
- #38 补齐 PostgreSQL 备份与恢复策略，确保后续 migration 与生产化路径有基线。
- #39 补齐日志、监控与告警策略，为登录、订阅门禁、扫码异常、邮件发送失败等实现提供日志基线。
- #22 与 #33 共同形成认证与 tenant scope 闭环；#23/#24/#25/#26 依赖该闭环。
- #23 提供订阅门禁规则，是 #25/#26 的前置门禁。
- #24 提供 location + 人员映射只读能力，是 #25 的直接前置。
- #25 完成扫码事件与固定邮件任务生成后，#26 才执行发送触发。

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
