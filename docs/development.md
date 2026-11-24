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

本机 API 状态与延迟验收使用回环 HTTP 和固定时钟，命令与预期计数见[可观测性策略 §5.1](observability.md#51-api-5xx-与-p95-的本机核验)。

本地质量门禁命令：

- Backend：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`
- #139 全局预约验收：准备一次性本机 PG16，设置 `APP_ENV=test`、`DATABASE_URL` 指向其回环地址，账号须可创建数据库。在 `backend/` 执行 `npm run test:oci-pacing-pg16`。脚本迁移并清理自己的随机数据库，邮件调用只进入内存 fake。[断言和结果](testing/local-oci-pacing-2026-11-19.md)
- #209 平台地点调额审计：[初始化一次性 PostgreSQL 16 夹具并执行 HTTP 与 SQL 对账](#8-平台地点调额审计本机验收)。
- ADR-023 租户生命周期迁移：在 `APP_ENV=local` 或 `test`、`DATABASE_URL` 指向本机 PostgreSQL 时，
  于 `backend/` 执行 `npm run test:tenant-lifecycle-migration`；脚本仅创建并删除随机命名的合成测试数据库。
- 合成订阅：在 `APP_ENV=local` 或 `test`、`DATABASE_URL` 指向本机 PostgreSQL 时，于 `backend/` 执行
  `npm run test:synthetic-subscriptions`。连接字符串仅接受本机回环地址和可选的 `?schema=public`。
  脚本在随机命名的临时数据库中运行三个种子脚本，验证旧记录续期、跨年与重复执行，完成后删除该数据库。
- #160 平台删除事务：在相同本地环境下，于 `backend/` 执行 `npm run test:platform-delete-transaction`；
  脚本只在随机命名的临时数据库中验证并发重放、订阅更新竞态与失败回滚，完成后删除该数据库。
- #161 平台恢复事务：在相同本地环境下，于 `backend/` 执行 `npm run test:platform-restore-transaction`；
  脚本只在随机命名的临时数据库中验证恢复期限、并发、独立业务状态与失败回滚，完成后删除该数据库。
- #162 Production 当前对象墓碑事务：在相同本地环境下，于 `backend/` 执行 `npm run test:platform-tenant-purge-transaction`；
  脚本只在随机命名的临时数据库中验证到期边界、全关联清理、失败回滚、重试、跨租户隔离和历史字段不变，完成后删除该数据库。
- #163 Production 清理调度：在相同本地环境下，于 `backend/` 执行 `npm run test:platform-tenant-purge-scheduler`；
  脚本在随机命名的临时数据库中验证 25 个合成 tenant、双 worker、重启、失败重试与错误环境。
- #164 Staging 即时清理：在相同本地环境下，于 `backend/` 执行 `npm run test:staging-tenant-deletion`；
  脚本在随机命名的临时数据库中验证验密、环境隔离、完整 FK 图、补偿重试、重复请求及跨租户隔离。
- #166 跨模块 HTTP 验收：在相同本地环境下，于 `backend/` 执行 `npm run test:tenant-deletion-acceptance`；
  脚本使用随机命名的临时数据库、合成租户和 mock 邮件 provider 验证认证、订阅/扫码/邮件门禁、恢复、到期墓碑及 Staging 全图清理。
- #166 迁移回滚守卫：在相同本地环境下，于 `backend/` 执行 `npm run test:tenant-deletion-rollback`；
  脚本仅在临时数据库中验证三层 rollback 对删除中状态的拒绝，以及状态清空后的逆序回滚。
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
   `tenant_code=10CA000001`、
   `identifier=local-operator` 登录，确认 operator username 登录成功。
2. 使用同一 operator 的 `operator@example.local` 登录，确认可选邮箱路径成功；使用
   `tenant-manager@example.local` 确认 tenant_manager 邮箱登录成功。
3. 以 tenant_manager 进入“用户管理”，创建只有 username、没有邮箱的 operator；退出后使用该 username
   登录。补充邮箱后确认两种身份均可登录，清空邮箱后确认只有 username 可登录。
4. 修改 operator username，确认旧会话立即失效、旧 username 登录失败、新 username 可登录。
5. 尝试 UUID tenant_id、未知/大小写 tenant_code、同 tenant 大小写重复 username/email、保留字、Unicode username、跨 tenant 身份和错误密码，
   确认创建冲突明确，而登录统一返回 `LOGIN_FAILED` 且不显示账号类型或存在性。
6. 在 active/trial/suspended/expired 合成订阅下确认登录本身不受订阅状态影响；业务发送门禁仍分别按
   `can_send=true/true/false/false` 工作。
7. 停止后端后提交登录，确认前端显示网络错误；恢复后端后重新登录，不应保留密码输入。
8. 默认确认 UUID tenant_id 登录返回统一 `LOGIN_FAILED`；仅在隔离回滚验证中临时设置
   `AUTH_ACCEPT_LEGACY_TENANT_UUID=true`，确认旧 UUID 可双读后立即恢复为 `false`。

自动验证至少运行：

- Backend：`npm test -- --runInBand test/auth.spec.ts test/users.spec.ts test/prisma-schema.spec.ts`
- Frontend：`npm test -- test/smoke.test.tsx test/users-page.test.tsx`
- 完整 GUI：准备 Local seed 并启动前后端后执行 `npm run test:e2e`

## 7. Platform control plane 本地入口（Issues #110–#113）

先执行 migration；平台认证与租户开通还必须在运行时注入彼此独立的
`PLATFORM_JWT_SECRET`、`PLATFORM_REFRESH_TOKEN_SECRET` 与至少 32 字符的
`PLATFORM_PROVISIONING_SECRET`。示例文件仅列变量名，不是可部署 Secret。

- 初始化：在 `backend` 目录注入 `PLATFORM_ADMIN_EMAIL`、`PLATFORM_ADMIN_PASSWORD` 后执行
  `npm.cmd run platform:admin -- bootstrap`
- 轮换/禁用/恢复：将末尾命令分别改为 `rotate`、`disable`、`recover`
- 合成 seed：仅 Local/CI/Staging 可显式设置 `PLATFORM_SYNTHETIC_SEED=true`、
  `.example.local` 邮箱和运行时测试密码，再执行 `npm.cmd run platform:seed`
- Production 会拒绝合成 seed；CLI 与 seed 均不输出邮箱、密码、token 或哈希
- UI：`http://localhost:3000/platform/login`；租户登录仍为 `http://localhost:3000/`。
- 本地浏览器跨端口访问时，前端页面来源须匹配后端的 `CORS_ORIGIN`（默认
  `http://localhost:3000`），前端的 `NEXT_PUBLIC_API_BASE_URL` 默认指向 `http://localhost:3001`。
  使用 `APP_ENV=local`、`MAIL_PROVIDER=mock` 和 `REAL_MAIL_SEND_ENABLED=false` 启动后，
  控制台应显示“模拟发信（mock）”和“当前环境未开放租户删除”。

聚焦验证：

- Backend：`npm.cmd test -- test/platform.spec.ts test/auth.spec.ts test/management.spec.ts`
- Frontend：`npm.cmd test -- --run test/platform.test.tsx`
- UI E2E（模拟 API）：Frontend 可用后执行 `npm.cmd run test:e2e -- platform-control-plane.spec.ts`。
- 真实跨端口读取按[验证指南](testing.md#412-issue-195-本地跨端口平台状态)检查。

## 8. 平台地点调额审计本机验收

在仓库根目录打开 PowerShell。将 `$quotaSource` 设为与当前分支数据库结构相同的本机合成 PG16
容器名，例如按第 2 节初始化的本地 Compose PostgreSQL。准备过程仅从源读取结构，跳过表数据、
所有权、权限和 Prisma 迁移历史。目标是名称为 `poolduck_quota_209` 的一次性空库。

```powershell
$quotaSource = '替换为本机合成 PostgreSQL 容器名'
$quotaSchema = @(docker exec $quotaSource sh -c 'exec pg_dump --schema-only --no-owner --no-privileges --exclude-table=public._prisma_migrations --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"')
if ($LASTEXITCODE -ne 0 -or !$quotaSchema) { throw '无法读取本机合成库结构' }

docker run --detach --rm --name poolduck-quota-209-pg --publish 127.0.0.1::5432 --env POSTGRES_USER=quota_owner --env POSTGRES_PASSWORD=synthetic-quota-owner --env POSTGRES_DB=poolduck_quota_209 --tmpfs /var/lib/postgresql/data:rw postgres:16
if ($LASTEXITCODE -ne 0) { throw '一次性 PostgreSQL 容器启动失败' }
```

等待下一条命令显示 `accepting connections`，再装载结构。

```powershell
docker exec poolduck-quota-209-pg pg_isready -h 127.0.0.1 -U quota_owner -d poolduck_quota_209
$quotaSchema | docker exec -i poolduck-quota-209-pg psql -X --single-transaction -v ON_ERROR_STOP=1 -U quota_owner -d poolduck_quota_209
if ($LASTEXITCODE -ne 0) { throw '测试库结构装载失败' }
$quotaAddress = docker port poolduck-quota-209-pg 5432/tcp
if ($LASTEXITCODE -ne 0 -or $quotaAddress -notmatch '^127\.0\.0\.1:\d+$') { throw '未取得本机回环端口' }
$env:DATABASE_URL = "postgresql://quota_owner:synthetic-quota-owner@$quotaAddress/poolduck_quota_209"
$env:APP_ENV = 'test'
$env:NODE_ENV = 'test'
$env:MAIL_PROVIDER = 'mock'
$env:REAL_MAIL_SEND_ENABLED = 'false'
Set-Location backend
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Backend 构建失败' }
node scripts/platform-location-limit-audit-test.mjs
```

连接 URL 必须显式指定 `127.0.0.1` 和发布端口，且没有查询串或片段。脚本创建合成管理员及测试角色，
通过调额 HTTP 接口按请求标识核对审计，再撤销该角色的审计 INSERT 权限复测两个原 409。恢复权限后
核对成功调额的唯一审计。结束后执行 `docker stop poolduck-quota-209-pg` 回收容器和临时数据库。
用 `npm test -- platform-location-limit-audit-config.spec.ts` 单独验证连接护栏，测试替换连接方法且不打开网络连接。
