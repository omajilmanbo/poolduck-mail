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
- ADR-023 租户生命周期迁移：在 `APP_ENV=local` 或 `test`、`DATABASE_URL` 指向本机 PostgreSQL 时，
  于 `backend/` 执行 `npm run test:tenant-lifecycle-migration`；脚本仅创建并删除随机命名的合成测试数据库。
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

## 8. 本地容量逐请求对账（#152）

在 `backend/` 运行 `npm run capacity:test`，可用固定合成样本离线验证负载参数和对账逻辑。实际运行 `npm run capacity:reconcile` 前须取得 D04 批准。执行窗口、并发、时长、停止和恢复条件见 [#152 计划草稿](https://github.com/omajilmanbo/poolduck-mail/pull/184)。

每个实例只核对一档。使用专用 `capacity152` PostgreSQL、合成数据、loopback HTTP 和隔离的 Docker 内部网络。核对被测后端的实际配置为 `APP_ENV=local`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。一档内仅本负载器写入扫码数据。管理员操作、smoke、定向探针和合成人员映射变更放在独立窗口。

保持候选后端镜像固定。若镜像尚未包含工具，只给计划中的 `loadgen` 容器增加以下只读挂载和本地连接配置。将 `CAPACITY_TOOLS_DIR` 设为工具 checkout 的 `backend/scripts` 绝对路径，数据库密码沿用专用 Compose 会话已有的临时值。

```yaml
# 合入计划的 services.loadgen
environment:
  APP_ENV: local
  MAIL_PROVIDER: mock
  REAL_MAIL_SEND_ENABLED: 'false'
  DATABASE_URL: postgresql://capacity152:${CAPACITY_DB_PASSWORD:?required}@postgres:5432/capacity152
volumes:
  - "${CAPACITY_TOOLS_DIR:?required}/capacity-load-test.mjs:/app/scripts/capacity-load-test.mjs:ro"
  - "${CAPACITY_TOOLS_DIR:?required}/capacity-reconcile.mjs:/app/scripts/capacity-reconcile.mjs:ro"
```

在已有的 `run_step` 参数与 watchdog 基础上，将最终命令改为 `node scripts/capacity-load-test.mjs --reconcile --plan`，预览同一档参数。获得人工批准并完成准备、监控和停机核验后，为执行档移除 `--plan`。每档执行后继续依照计划跟踪排空，使用原有 `capacity:report` 查队列时序和聚合。

对账模式保留 `capacity_load.step`、`capacity_load.complete` 的聚合，另输出一条 `capacity_reconcile.complete`：

- `passed`（退出 0）表示请求与只读快照一致。重复扫码或幂等重放复用原 event/job。若客户端无回执但数据库可按幂等键确认关联，会计入 `matched_without_response`。API SLO 仍以负载汇总判定。
- `failed`（退出 1）表示发现错误关联、漏或重复的 job、tenant/location 或收件快照不符、拒绝请求发生持久化，或该档出现无关联的新事件或 job。
- `incomplete`（退出 2）表示没有可验证关联、缺少回执或数据库证据。被中途终止且没有对账末行的档位也记为缺证据。无回执且找不到幂等记录只说明当前快照未能确认提交。

幂等键哈希、event/job ID 和预期租户地点只在进程内使用。数据库按档使用只读快照，收件快照比较只返回布尔值。只保留计数和结果，不保存逐行数据。取消窗口、worker 领取和逐项 provider 故障仍依原计划另行取证。
- UI：`http://localhost:3000/platform/login`；租户登录仍为 `http://localhost:3000/`

聚焦验证：

- Backend：`npm.cmd test -- test/platform.spec.ts test/auth.spec.ts test/management.spec.ts`
- Frontend：`npm.cmd test -- --run test/platform.test.tsx`
- E2E：本地前后端可用后执行 `npm.cmd run test:e2e -- platform-control-plane.spec.ts`
