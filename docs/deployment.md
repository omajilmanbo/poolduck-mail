# 部署说明（Local / Staging / Production）

## 1. 环境划分

- Local：开发调试环境
- Staging：预发布验证环境
- Production：正式生产环境

## 2. 基础依赖

- Node.js 20 LTS
- npm 10+
- Docker / Docker Compose（Local PostgreSQL 16 与本地应用容器组）
- PostgreSQL 16（Local 由 `docker-compose.yml` 提供；Staging/Production 数据库与 secrets 策略仍需按对应 Issue 明确）
- MVP 阶段邮件 provider 使用 sandbox/mock（不接入真实邮件发送）

## 3. 环境变量

参考 `.env.example`，至少包括：
- `APP_ENV`
- `APP_PORT`
- `FRONTEND_PORT`
- `API_BASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `AUTH_IDENTITY_HASH_SECRET`
- `AUTH_LOGIN_RATE_WINDOW_MS` / `AUTH_LOGIN_MAX_PER_IP` /
  `AUTH_LOGIN_MAX_PER_TENANT` / `AUTH_LOGIN_MAX_PER_IDENTIFIER` /
  `AUTH_LOGIN_MAX_PER_COMPOSITE`
- `MAIL_PROVIDER`
- `MAIL_SMTP_HOST` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`
- `MAIL_FROM_ADDRESS`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `TENANT_CONTEXT_ENFORCED`

## 4. Local 部署

### 4.0 运行前人工检查项

- 当前环境必须可以执行 Docker / Docker Compose。
- 当前环境必须允许安装 npm 依赖。
- 当前环境必须可以访问 GitHub 仓库并创建分支/PR。
- 默认端口未被占用：PostgreSQL `5432`、Backend `3001`、Frontend `3000`。
- 如本机已有 PostgreSQL 占用 `5432`，需人工决定是否改用其他端口，例如在 `.env` 中设置 `POSTGRES_PORT=5433`。
- 不提供真实数据库密码、真实客户数据、真实邮件凭据或 OAuth refresh token。
- MVP 阶段邮件发送必须使用 sandbox/mock provider。

### 4.1 Local 容器组（Docker Compose）

`docker-compose.yml` 提供本地 MVP 容器组：`postgres`、`backend`、`frontend`。该配置用于本地恢复、黑盒验证与后续 Staging 方案参考，不等同于 Production 发布流水线。

1. 准备本地环境变量：
   - `copy .env.example .env`
2. 构建并启动完整容器组：
   - `docker compose up -d --build`
3. 检查容器状态：
   - `docker compose ps`
4. 验证健康检查：
   - `GET http://localhost:3000/healthz`
   - `GET http://localhost:3001/health`
5. 初始化本地测试数据：
   - `docker compose exec backend npm run local:seed`
6. 执行 API 冒烟：
   - `docker compose exec backend npm run smoke:api`
7. 打开 MVP 前端：
   - `http://localhost:3000/`

容器组网络与环境变量：

- Backend 容器通过 Compose service name `postgres` 连接 PostgreSQL，容器内 `DATABASE_URL` 为 `postgresql://...@postgres:5432/...`。
- Frontend 浏览器端默认使用 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`，该值在 Docker build 时写入 Next.js 客户端 bundle。
- Backend CORS 默认允许 `http://localhost:3000`，对应宿主机浏览器访问 Frontend 的 origin。
- Backend 启动命令会先执行 `npm run db:deploy`，再执行 `npm run start`。
- MVP 邮件 provider 默认保持 `MAIL_PROVIDER=mock`，不会接入真实邮件服务。

常用操作：

- 仅启动 PostgreSQL，兼容宿主机直接启动前后端的开发方式：
  - `docker compose up -d postgres`
- 验证 PostgreSQL 可连接：
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`
- 查看日志：
  - `docker compose logs -f backend`
  - `docker compose logs -f frontend`
  - `docker compose logs -f postgres`
- 重建镜像：
  - `docker compose build --no-cache backend frontend`
- 停止容器组：
   - `docker compose down`
- 停止并清空本地数据库卷：
  - `docker compose down -v`

默认本地配置：

- 数据库名：`poolduck_mail`
- 用户：`poolduck_local`
- 示例密码：`poolduck_local_password`
- 本机端口：`5432`
- 宿主机后端连接串：`postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`
- 容器内后端连接串：`postgresql://poolduck_local:poolduck_local_password@postgres:5432/poolduck_mail`

### 4.2 后端宿主机开发入口（保留）

1. 安装依赖：
   - `cd backend`
   - `npm install`
2. 配置环境变量（可选）：
   - 新建 `backend/.env`（或使用系统环境变量）
   - 可配置 `APP_PORT`（默认 `3001`）
   - 可配置 `CORS_ORIGIN`（默认 `http://localhost:3000`）；认证 API 禁止使用 `*` 通配 origin
   - 使用 `.env.example` 中的 `DATABASE_URL` 连接 Local PostgreSQL
3. 启动开发服务：
   - `npm run start:dev`
4. 健康检查：
   - `GET http://localhost:3001/health`
5. 运行测试：
   - `npm test`

### 4.3 前端宿主机开发入口（保留）

1. 安装依赖：
   - `cd frontend`
   - `npm install`
2. 启动开发服务：
   - `npm run dev`
   - 前端默认请求 `NEXT_PUBLIC_API_BASE_URL`，未设置时使用 `http://localhost:3001`
3. 构建验证：
   - `npm run build`
4. 健康检查：
   - `GET http://localhost:3000/healthz`
5. 运行测试：
   - `npm test`

## 5. Staging 部署

- 使用独立数据库与邮件沙箱配置
- cloud-init 只负责安装 Docker/Compose、配置主机用户/目录和基础防火墙，不部署应用
- 当前由人工批准后，操作者或 Agent 通过 SSH 执行 Compose 部署命令；部署后执行 smoke test
- 已接受的目标方案是把命令链收敛为幂等部署脚本，触发仍保留人工审批；详见 ADR-005
- 验证订阅、权限、扫码链路
- Staging 已采用与 Local 相同的容器组基线部署到 OCI 服务器，并通过 override 增加 Nginx reverse proxy。
- Staging 仍需后续 Issue 补齐域名/TLS、备份、监控与正式 secrets store；当前 secrets 位于 VM 的仓库外 `.env`。
- Staging 环境变量必须替换为 staging 专用值，不能直接复用 `.env.example` 中的示例 secrets。

### 5.1 MVP public-IP deployment entry (Issue #58)

When no Staging domain exists, the MVP Staging deployment uses the OCI compute public IP over HTTP port `80`.
The deployment keeps PostgreSQL, Backend, and Frontend bound to VM localhost ports and exposes only the `reverse-proxy` service publicly.

Deployment files:

- `docker-compose.yml`: shared Local/Staging container baseline.
- `docker-compose.staging.yml`: Staging override that adds the Nginx reverse proxy.
- `deploy/staging/nginx.conf`: routes `/` to Frontend, `/api/*` and `/health` to Backend.

Required Staging `.env` shape on the VM:

```dotenv
APP_ENV=staging
APP_PORT=127.0.0.1:3001
FRONTEND_PORT=127.0.0.1:3000
POSTGRES_PORT=127.0.0.1:5432
API_BASE_URL=http://<staging-public-ip>
NEXT_PUBLIC_API_BASE_URL=http://<staging-public-ip>
CORS_ORIGIN=http://<staging-public-ip>
MAIL_PROVIDER=mock
MAIL_MOCK_SEND_RESULT=success
TENANT_CONTEXT_ENFORCED=true
```

`POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and
`AUTH_IDENTITY_HASH_SECRET` must be generated on the Staging host or another approved secret store. Do not
commit or paste those values into docs, issues, or PR descriptions.

Current approved deployment and recovery commands (to be wrapped by the future deployment script):

```bash
cd /opt/poolduck-mail/app
git fetch origin
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T -e API_BASE_URL=http://reverse-proxy backend npm run smoke:api
```

`npm run staging:seed` writes only synthetic `.example.local` data and is idempotent. It prepares fixed active, suspended, and expired tenants for Staging verification:

| Subscription | Tenant ID | Operator | Password | Location ID | Scan code |
|---|---|---|---|---|---|
| active | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | `staging-active-operator@example.local` | `PoolduckStaging123!` | `dddddddd-dddd-4ddd-8ddd-dddddddddddd` | `01K0ABC20001` |
| suspended | `11111112-1112-4112-8112-111111111112` | `staging-suspended-operator@example.local` | `PoolduckStaging123!` | `44444445-4445-4445-8445-444444444445` | `01K0ABC20002` |
| expired | `66666667-6667-4667-8667-666666666667` | `staging-expired-operator@example.local` | `PoolduckStaging123!` | `99999990-9990-4990-8990-999999999990` | `01K0ABC20003` |

The Staging seed must not be run against Production or any database containing real customer data.

For sandbox/mock failure-path verification, temporarily set `MAIL_MOCK_SEND_RESULT=failure`, recreate Backend, run the smoke test with `API_SMOKE_EXPECT_SEND_STATUS=failed`, then restore `MAIL_MOCK_SEND_RESULT=success`.

Issue #58 deployment result for 2026-07-07 is recorded in `docs/testing/staging-smoke-2026-07-07.md`.

## 6. Production 部署

- 必须经过 staging 验证
- 执行数据库 migration（先备份）
- 配置监控告警（登录失败率、邮件失败率）
- 逐步发布或低峰发布
- Production 不直接复用本地 `.env.example` 示例值；真实 secrets、TLS、反向代理、负载均衡、备份与回滚流程必须由后续发布/运维 Issue 明确。

## 7. OCI Always Free Staging IaC 实施入口（Issue #48）

Staging 基础设施准备代码位于 `infrastructure/oci-staging/`。该目录只提供 Terraform 计划与人工实施入口，默认不自动部署应用。

人工实施步骤：

1. 进入 IaC 目录：`cd infrastructure/oci-staging`
2. 复制变量示例：`cp terraform.tfvars.example terraform.tfvars`
3. 人工填写 `terraform.tfvars`：`compartment_ocid`、`region`、`admin_ssh_cidr`、`ssh_public_key`。
4. 初始化与检查：`terraform init && terraform fmt -check && terraform validate`
5. 生成计划：`terraform plan -out=tfplan`
6. 人工审核计划确认无 Production 资源、无真实 secret、无公网数据库端口后，才允许执行：`terraform apply tfplan`

实施约束：

- `region` 必须由人工确认是 OCI tenancy home region，以保持 Always Free 资源资格。
- `admin_ssh_cidr` 禁止使用 `0.0.0.0/0`。
- Staging 邮件 provider 仍必须使用 mock/sandbox，不得接入真实客户投递。
- `terraform.tfvars`、`tfplan`、Terraform state 文件不得提交到仓库。

### 7.1 Staging rebuild SSH key policy

For Staging rebuilds, generate the SSH key under the local repository in `.secrets/staging/`:

```powershell
New-Item -ItemType Directory -Force -Path .secrets\staging
ssh-keygen --% -t ed25519 -N "" -C poolduck-mail-staging-YYYY-MM-DD -f .secrets\staging\id_ed25519
```

`.secrets/` is ignored by Git and must not be committed or pushed. Only the public key from `.secrets/staging/id_ed25519.pub` may be copied into the local ignored `infrastructure/oci-staging/terraform.tfvars` as `ssh_public_key`.

Do not create weak password-login OS users for Staging. The Staging host should be maintained through SSH key login from the restricted `admin_ssh_cidr`.

To rebuild the Staging compute instance while keeping the existing VCN, subnet, NSG, and backup bucket:

```powershell
terraform -chdir=infrastructure\oci-staging init
terraform -chdir=infrastructure\oci-staging plan -replace=oci_core_instance.app -out=tfplan
terraform -chdir=infrastructure\oci-staging apply tfplan
terraform -chdir=infrastructure\oci-staging output compute_public_ip
```

After the new host is reachable:

```bash
ssh -i .secrets/staging/id_ed25519 ubuntu@<new-staging-public-ip>
docker --version
docker compose version
cd /opt/poolduck-mail/app
if [ ! -d .git ]; then git clone https://github.com/omajilmanbo/poolduck-mail.git .; fi
git fetch origin
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
  -e API_BASE_URL=http://reverse-proxy \
  -e API_SMOKE_TENANT_ID=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa \
  -e API_SMOKE_EMAIL=staging-active-operator@example.local \
  -e API_SMOKE_PASSWORD=PoolduckStaging123! \
  -e API_SMOKE_LOCATION_ID=dddddddd-dddd-4ddd-8ddd-dddddddddddd \
  -e 'API_SMOKE_SCAN_CODE=PD1|ENTRY|01K0ABC20001' \
  -e 'API_SMOKE_UNMAPPED_SCAN_CODE=PD1|ENTRY|01K0ABC29999' \
  backend npm run smoke:api
```

On OCI Ubuntu 22.04 arm64, cloud-init installs `docker.io` and `docker-compose-v2`. If an older host has Docker but `docker compose version` returns `unknown command`, repair it with:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

Do not generate the Staging `.env` through a nested SSH heredoc or an inline remote shell that expands secrets in multiple shells. Generate `.secrets/staging/staging.env` locally, confirm it is ignored by Git, then copy it to the VM:

```powershell
git check-ignore -v .secrets\staging\staging.env
scp -i .secrets\staging\id_ed25519 .secrets\staging\staging.env ubuntu@<new-staging-public-ip>:/opt/poolduck-mail/app/.env
ssh -i .secrets\staging\id_ed25519 ubuntu@<new-staging-public-ip> "chmod 600 /opt/poolduck-mail/app/.env"
```

The Staging `.env` must include:

```dotenv
APP_ENV=staging
APP_PORT=127.0.0.1:3001
FRONTEND_PORT=127.0.0.1:3000
POSTGRES_PORT=127.0.0.1:5432
POSTGRES_DB=poolduck_mail
POSTGRES_USER=poolduck_staging
POSTGRES_PASSWORD=<staging-only-random-secret>
DATABASE_URL=postgresql://poolduck_staging:<same-password>@postgres:5432/poolduck_mail
JWT_SECRET=<staging-only-random-secret>
JWT_ACCESS_TOKEN_TTL_SECONDS=900
JWT_REFRESH_TOKEN_TTL_SECONDS=604800
REFRESH_TOKEN_SECRET=<staging-only-random-secret>
AUTH_IDENTITY_HASH_SECRET=<staging-only-random-secret>
AUTH_LOGIN_RATE_WINDOW_MS=900000
AUTH_LOGIN_MAX_PER_IP=60
AUTH_LOGIN_MAX_PER_TENANT=100
AUTH_LOGIN_MAX_PER_IDENTIFIER=10
AUTH_LOGIN_MAX_PER_COMPOSITE=8
API_BASE_URL=http://<new-staging-public-ip>
NEXT_PUBLIC_API_BASE_URL=http://<new-staging-public-ip>
CORS_ORIGIN=http://<new-staging-public-ip>
MAIL_PROVIDER=mock
MAIL_MOCK_SEND_RESULT=success
MAIL_FROM_ADDRESS=no-reply@example.local
LOG_LEVEL=info
TENANT_CONTEXT_ENFORCED=true
```

If `docker compose` still reports Docker socket permission errors immediately after cloud-init, either open a new SSH session so the `ubuntu` group membership is refreshed, or use `sudo docker compose ...` for that deployment session.

## 8. Staging deployment design (Issue #37, historical baseline)

This section preserves the design baseline accepted in Issue #37. The current executable deployment entry is section 5 and `docs/staging-manual.md`; where commands or URLs differ, use those current sources. This historical section does not authorize cloud resource changes, GitHub secrets, DNS records, or production automation.

### 8.1 Hosting baseline

- Hosting platform: OCI Always Free, using the `infrastructure/oci-staging/` Terraform baseline.
- Runtime shape: one Staging compute instance that can run Frontend, Backend, and PostgreSQL 16 containers for MVP validation.
- Access before a domain exists: use the Terraform `compute_public_ip` output and HTTP for temporary internal validation.
- Domain and TLS: optional follow-up. If no Staging domain exists, use placeholders such as `http://<staging-public-ip>` and do not block Issue #37.
- Mail provider: `mock` or `sandbox` only. Staging must not send real customer email.
- Data policy: Staging uses synthetic/non-customer data only.

### 8.2 Manual deployment trigger

Until a separate CI/CD issue is approved, Staging deployment is manual:

1. Merge the reviewed infrastructure PR for Issue #48.
2. On the operator machine, prepare local-only OCI credentials and `infrastructure/oci-staging/terraform.tfvars`.
3. Run Terraform plan/apply manually and review the plan before apply.
4. SSH to the Staging compute public IP using the approved admin key.
5. Prepare an application release bundle or clone the repository on the Staging host.
6. Configure Staging environment variables from the approved secret/config sources.
7. Start or restart the Staging services.
8. Run the smoke test checklist in section 8.6.
9. Record test results in the PR or deployment notes.

Do not enable automatic deploy-on-main, tag deploy, or production deploy in this issue.

### 8.3 Staging configuration sources

Use separate storage for non-secret config and secrets:

| Config kind | Examples | Storage location | Commit to repo |
|---|---|---|---|
| Terraform local inputs | `compartment_ocid`, `region`, `admin_ssh_cidr`, `ssh_public_key` | Local `infrastructure/oci-staging/terraform.tfvars` | No |
| OCI credentials | tenancy/user OCID, fingerprint, private key path | Local OCI CLI config (`~/.oci/config`) | No |
| Application non-secret config | `APP_ENV`, ports, public base URLs, log level | Staging host env file or future platform config UI | No for real values |
| Application secrets | `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `AUTH_IDENTITY_HASH_SECRET`, mail sandbox credentials | Staging secrets store or restricted host env file | No |
| Documentation placeholders | variable names, example URLs, example secret labels | Docs and `.env.example` | Yes |

If GitHub Actions Environments are introduced later, use a dedicated `staging` environment and create secrets manually in the GitHub UI. Agents must not create or read real secret values.

### 8.4 Required Staging environment variables

Minimum application variables for Staging:

```dotenv
APP_ENV=staging
APP_PORT=127.0.0.1:3001
FRONTEND_PORT=127.0.0.1:3000
API_BASE_URL=http://<staging-public-ip>
NEXT_PUBLIC_API_BASE_URL=http://<staging-public-ip>
CORS_ORIGIN=http://<staging-public-ip>
DATABASE_URL=<secret:staging-postgres-url>
JWT_SECRET=<secret:staging-jwt-secret>
REFRESH_TOKEN_SECRET=<secret:staging-refresh-token-secret>
AUTH_IDENTITY_HASH_SECRET=<secret:staging-identity-hash-secret>
MAIL_PROVIDER=mock
MAIL_FROM_ADDRESS=<placeholder-or-secret:staging-from-address>
LOG_LEVEL=info
TENANT_CONTEXT_ENFORCED=true
```

If a Staging domain is added later, replace the public-IP URLs with HTTPS URLs, for example:

- `API_BASE_URL=https://api.staging.<domain>`
- `NEXT_PUBLIC_API_BASE_URL=https://api.staging.<domain>`
- `CORS_ORIGIN=https://staging.<domain>`

### 8.5 Database and mail strategy

- Database: Staging must use an isolated PostgreSQL 16 database. For the OCI Always Free MVP baseline, this may run as a container on the Staging compute instance until a later issue introduces a managed database.
- Database data: use seed/synthetic test data only. Do not import real customer PII.
- Mail: Staging must use `mock` or `sandbox`. Do not configure a production SMTP/API provider.
- Tenant safety: keep `TENANT_CONTEXT_ENFORCED=true` in Staging and Production.

### 8.6 Smoke test checklist

The smoke test list is intended to become later automated E2E coverage:

1. Infrastructure health: Staging host responds over SSH from the allowed admin CIDR.
2. Backend health: `GET /health` returns success.
3. Frontend health: `GET /healthz` returns success.
4. Login path: tenant-aware login accepts `tenant_id` + email/username + password for seeded Staging users.
5. Tenant isolation: a user from one tenant cannot access another tenant's data.
6. Subscription gate: `trial` / `active` allows the scan flow; `expired` / `suspended` blocks scan/mail-job creation.
7. Location query: seeded location/person mapping can be queried without crossing tenant boundaries.
8. Scan flow: submitting a scan creates a `mail_job` for the expected tenant and target address.
9. Sandbox mail: triggering send records a sandbox/mock result and does not deliver real email.
10. Logs: health checks, login failure, authorization denial, subscription denial, and sandbox send result are observable without logging secrets or PII.

### 8.7 Human preparation checklist

Before a Staging deploy attempt, a human must confirm:

- OCI compartment OCID and home region are known and stored only in local/private config.
- Terraform plan has been reviewed and targets Staging resources only.
- Admin SSH CIDR is restricted; `0.0.0.0/0` is not allowed for SSH.
- A Staging SSH public key is configured, and the private key is not in the repository.
- Staging database credentials and JWT secrets are generated outside the repository.
- Mail provider is `mock` or `sandbox`; no production mail credentials are used.
- If no domain exists, public-IP URLs are accepted as temporary Staging endpoints.
- If a domain exists, DNS/TLS is configured manually before switching URLs to HTTPS.
- GitHub `staging` environment/secrets, if used later, are created manually by a human.

### 8.8 Stop conditions for agents

Agents must stop and report blockers instead of guessing when any of the following is missing:

- OCI permissions or credentials needed to inspect/apply Staging infrastructure.
- `compartment_ocid`, `region`, SSH public key, or admin CIDR.
- Staging database connection details or secret storage location.
- JWT/refresh token secrets.
- Mail sandbox/mock provider decision or credentials.
- Domain/TLS decision when the requested workflow requires HTTPS.
- Permission to modify GitHub Actions workflows or GitHub Environments.

## 9. Database migration operations (Issue #21)

Backend database migrations are managed with Prisma.

Local development flow:

1. Start PostgreSQL 16, for example with `docker compose up -d postgres`.
2. Confirm `.env` or shell environment contains a local `DATABASE_URL`.
3. Run `cd backend`.
4. Validate the Prisma schema with `npm run db:validate`.
5. Apply local migrations with `npm run db:migrate`.
6. Generate the Prisma client with `npm run prisma:generate`.
7. Optionally run the synthetic model smoke test with `npm run test:db`.

Staging/Production-like deployment flow:

1. Confirm the target database is isolated for the environment.
2. Confirm `DATABASE_URL` comes from the approved secret store or restricted host environment.
3. Run `npm run db:deploy` from `backend/` to apply committed migrations.
4. Do not run `npm run db:reset` outside disposable local databases.

Safety rules:

- Never commit `DATABASE_URL`, migration state files, dumps, seed data with customer PII, or generated Prisma client output.
- Staging smoke data must be synthetic.
- Agents must stop if the target database or secret source is unclear.
- `20260724020000_add_operator_location_assignments` 是 fail-closed migration：不回填任何现有 operator。部署后先由 tenant_manager 使用 assignment API 授权合成/批准的地点，再执行 operator smoke；不得通过 SQL 批量默认授权全部地点。
- 回滚 #96 时先停止写入并回滚应用，再运行 `backend/prisma/rollback/20260724020000_add_operator_location_assignments.sql`。旧应用会恢复此前“operator 可访问 tenant 全部地点”的宽权限行为，执行前必须获得安全负责人确认。
