# Staging 人工确认与部署手册

本手册用于 #37 的人工确认、Staging 应用部署和阻塞项报告。它只描述操作步骤，不要求 Agent 创建云账号、域名、DNS、GitHub secrets、数据库实例或真实邮件凭据。

## 1. 使用边界

- 当前默认平台：OCI Always Free 单 VM + Docker Compose。
- 当前默认发布触发：人工手动部署。
- 当前默认数据库：Staging VM 内 PostgreSQL 16。
- 当前默认邮件 provider：`mock` 或 `sandbox`。
- 当前禁止事项：真实客户数据、生产数据库快照、生产密钥、真实 Gmail/Workspace/SMTP 凭据、OAuth refresh token。

如果本手册中的任何确认项无法完成，停止部署或 CI/CD 实施，并按“阻塞项报告模板”记录。

## 2. 人工确认步骤

### 2.1 OCI 账号、区域与成本

确认方法：

1. 打开 OCI Console。
2. 确认当前 tenancy、home region 和 Staging compartment。
3. 确认 Staging compartment 名称与 Terraform 输入一致，例如 `Mail_project_stg`。
4. 打开 Billing / Cost Management，确认预算或告警已配置。
5. 确认目标成本为 0 JPY/月；如预计超过 1,000 JPY/月，停止并报告。

通过标准：

- 资源位于 Staging compartment，不在 Production compartment。
- 默认资源仍符合 Always Free 或已确认不会超过 1,000 JPY/月。
- 已有 500 JPY 预警和 1,000 JPY 停止排查阈值，或人工已记录暂未配置的原因。

### 2.2 Terraform state 与 OCI Console 对齐

本地确认方法：

```bash
terraform -chdir=infrastructure/oci-staging state list
terraform -chdir=infrastructure/oci-staging output compute_public_ip
terraform -chdir=infrastructure/oci-staging output backup_bucket_name
```

OCI Console 交叉核对：

1. Compute：确认 Staging VM 存在，并记录 public IP。
2. Networking：确认 VCN、Public Subnet、Internet Gateway、Route Table 存在。
3. Security：确认 Web/API NSG 允许 80/443，SSH 仅允许管理员 CIDR。
4. Database network：确认 PostgreSQL `5432` 未向公网开放。
5. Object Storage：确认 Staging backup bucket 存在，且生命周期规则用于清理旧备份。

通过标准：

- Terraform state、Terraform output 与 OCI Console 资源一致。
- 如果 state 中存在资源但 Console 中缺失，或 Console 中存在未记录资源，停止并报告 drift 风险。

### 2.3 SSH 与 VM 基础运行能力

确认方法：

1. 从 Terraform output 或 OCI Console 获取 VM public IP。
2. 使用 Staging 专用 SSH key 登录。
3. 登录后确认当前主机是 Staging VM。
4. 检查 Docker / Docker Compose 是否可用。

示例命令：

```bash
ssh <staging-user>@<staging-public-ip>
hostname
docker --version
docker compose version
```

通过标准：

- SSH 只能从管理员固定 IP/CIDR 登录。
- Docker 与 Docker Compose 可执行。
- 不使用密码登录；不把 SSH private key 写入仓库或 Issue。

如果 `docker --version` 可用但 `docker compose version` 返回 `unknown command`，说明 Docker Compose v2 未安装或未被当前 Docker CLI 发现。OCI Ubuntu 22.04 arm64 Staging VM 应优先使用 Ubuntu 源里的 `docker-compose-v2` 包；`docker-compose-plugin` 在该镜像的默认 apt 源中可能不可用。

现有 VM 可按以下步骤修复：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
docker --version
docker compose version
```

如果 VM 上已经有正在运行的应用容器，先安排维护窗口并备份 Staging DB；安装 `docker-compose-v2` 通常不需要替换 Docker Engine，但仍应在维护窗口内执行。

2026-07-09 Staging rebuild 结果表明，cloud-init 使用 `docker-compose-plugin` 会导致 package install 阶段失败；IaC 模板已更新为 `docker-compose-v2`。

### 2.4 域名、DNS 与 TLS

有域名时的确认方法：

1. 确认 Staging 子域名，例如 `stg.example.com`。
2. 在 DNS 管理界面添加或确认 A record 指向 VM public IP。
3. 等待 DNS 生效。
4. 从本地验证解析结果。

示例命令：

```bash
nslookup stg.example.com
curl -I http://stg.example.com
curl -I https://stg.example.com
```

无域名时的临时方法：

1. 记录 VM public IP。
2. 仅用于内部 HTTP 验证。
3. 不购买新域名，不创建付费 DNS zone。

通过标准：

- 有域名时，DNS 指向 Staging VM public IP。
- HTTPS 使用 Caddy 或 Nginx + certbot 取得证书。
- 无域名时，文档和部署记录必须标注“临时 IP 验证，未启用正式 HTTPS”。

### 2.5 Secrets 存放位置

可选位置：

- GitHub Actions Environment Secrets：用于后续自动部署。
- 平台 UI：如果托管平台提供 secret store。
- VM 本地 `.env`：当前手动部署默认方案。

GitHub UI 确认方法：

1. 打开 GitHub repository。
2. 进入 Settings → Environments。
3. 创建或确认 `staging` environment。
4. 只登记 secret 名称，不在 Issue、PR、文档正文中写 secret 值。

VM `.env` 确认方法：

```bash
cd <staging-app-dir>
test -f .env
chmod 600 .env
```

当前手动部署应先在操作者本机生成 gitignored 的 `.secrets/staging/staging.env`，再复制到 VM 的 `<staging-app-dir>/.env`。不要通过嵌套 SSH heredoc 或多层 shell inline 命令生成 `.env`，避免 `$POSTGRES_PASSWORD`、`DATABASE_URL` 等值在错误的 shell 层展开后写坏。

示例：

```powershell
git check-ignore -v .secrets\staging\staging.env
scp -i .secrets\staging\id_ed25519 .secrets\staging\staging.env ubuntu@<staging-public-ip>:<staging-app-dir>/.env
ssh -i .secrets\staging\id_ed25519 ubuntu@<staging-public-ip> "chmod 600 <staging-app-dir>/.env"
```

通过标准：

- Staging secrets 与 Production secrets 完全独立。
- `DATABASE_URL`、`JWT_SECRET`、`REFRESH_TOKEN_SECRET`、`POSTGRES_PASSWORD`、`MAIL_SMTP_PASS` 不进仓库。
- Agent 未被要求读取、打印或保存真实 secret 值。

### 2.6 Staging 数据库

确认方法：

1. 确认 PostgreSQL 运行在 VM 内或人工批准的 Staging 专用数据库中。
2. 确认 `DATABASE_URL` 指向 Staging DB。
3. 确认 `5432` 不向公网开放。
4. 初始化时只使用 seed/dummy 数据。

示例命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml ps postgres
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec postgres pg_isready -U <staging-db-user> -d <staging-db-name>
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec postgres psql -U <staging-db-user> -d <staging-db-name> -c "select 1 as ok;"
```

通过标准：

- Staging DB 独立于 Production DB。
- 未导入生产 dump、真实客户邮箱或真实客户 PII。
- 如果 migration 或 seed 尚未实现，记录为后续实现阻塞项，而不是临时导入真实数据。

### 2.7 Mail sandbox

确认方法：

1. 确认 `MAIL_PROVIDER=mock` 或 `MAIL_PROVIDER=sandbox`。
2. 如果使用 Mailpit/Mailhog，确认服务只用于 Staging 内部验证。
3. 执行 smoke test 时只检查 sandbox 记录或 mock provider result。

示例命令：

```bash
grep '^MAIL_PROVIDER=' .env
docker compose ps mail-sandbox
```

通过标准：

- 不配置真实 SMTP/Gmail/Workspace/OAuth refresh token。
- 不向真实客户邮箱投递。
- 日志中不打印完整邮件凭据或真实收件人列表。

### 2.8 GitHub Actions 与发布触发方式

确认方法：

1. 人工决定发布触发方式：手动部署、`main` 合并后部署、tag 部署。
2. 人工决定 Agent 是否可以读取或修改 `.github/workflows/`。
3. 如选择自动部署，先确认 GitHub `staging` environment 和 secrets 权限。
4. 在未确认前，不创建或修改自动发布 workflow。

通过标准：

- 当前默认仍是手动部署。
- 自动发布只在单独 Issue 或明确授权下实施。
- GitHub secrets 只由人工在 UI 中创建，不由 Agent 实际创建。

## 3. 手动部署步骤

### 3.1 部署前检查

1. 完成第 2 章所有确认项。
2. 确认本次部署 commit SHA。
3. 确认没有未授权 Production 资源、Production secrets 或真实客户数据。
4. 确认当前应用代码支持本次 smoke test 所需 endpoint；尚未实现的 endpoint 记录为实现阻塞项。

### 3.2 准备应用目录

示例命令：

```bash
sudo mkdir -p /opt/poolduck-mail-staging
sudo chown <staging-user>:<staging-user> /opt/poolduck-mail-staging
cd /opt/poolduck-mail-staging
```

首次部署：

```bash
git clone <repo-url> .
git checkout <commit-sha-or-branch>
```

后续部署：

```bash
git fetch --all --prune
git checkout <commit-sha-or-branch>
git pull --ff-only
```

### 3.3 准备 Staging `.env`

1. 在操作者本机准备 `.secrets/staging/staging.env`。
2. 只填 Staging 专用值。
3. 确认 `.secrets/` 已被 Git ignore。
4. 复制到 VM 的 `<staging-app-dir>/.env`。
5. 设置文件权限。

示例命令：

```powershell
git check-ignore -v .secrets\staging\staging.env
scp -i .secrets\staging\id_ed25519 .secrets\staging\staging.env ubuntu@<staging-public-ip>:<staging-app-dir>/.env
ssh -i .secrets\staging\id_ed25519 ubuntu@<staging-public-ip> "chmod 600 <staging-app-dir>/.env"
```

必须确认的关键值：

- `APP_ENV=staging`
- `APP_PORT=127.0.0.1:3001`
- `FRONTEND_PORT=127.0.0.1:3000`
- `POSTGRES_PORT=127.0.0.1:5432`
- `DATABASE_URL=postgresql://<staging-user>:<staging-password>@postgres:5432/<staging-db>`
- `JWT_SECRET=<staging-only-random-secret>`
- `REFRESH_TOKEN_SECRET=<staging-only-random-secret>`
- `MAIL_PROVIDER=mock` 或 `MAIL_PROVIDER=sandbox`
- `MAIL_MOCK_SEND_RESULT=success`
- `LOG_LEVEL=info`
- `CORS_ORIGIN=<staging-frontend-origin>`
- `TENANT_CONTEXT_ENFORCED=true`

### 3.4 构建和启动服务

当前 #37 只定义流程，不强制仓库已经存在完整 Staging Compose 文件。后续实现 Compose 时，建议服务名保持：

- `reverse-proxy`
- `frontend`
- `backend`
- `postgres`
- `mail-sandbox`

示例命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml config
docker compose -f docker-compose.yml -f docker-compose.staging.yml build
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
```

如果 `docker compose config` 失败，停止并记录具体配置错误。

### 3.5 数据库 migration 与 seed

执行原则：

- 只使用 Staging DB。
- 只使用 seed/dummy tenant、user、location、barcode、email。
- 不导入 Production dump。

示例命令：

```bash
docker compose exec backend npm run db:deploy
docker compose exec backend npm run staging:seed
```

`staging:seed` 仅写入 synthetic `.example.local` 测试数据，并准备 active、suspended、expired 三类订阅状态用于 Staging 验证。

### 3.6 Smoke test

基础检查：

```bash
curl -fsS <staging-backend-url>/health
curl -fsS <staging-frontend-url>/healthz
```

业务检查按 `docs/environments.md` 的 `STG-SMOKE-*` 清单执行。若当前 API 尚未实现，记录为“实现未完成”，不要改用真实数据绕过。

### 3.7 部署记录

每次手动部署后记录：

| 项目 | 内容 |
|---|---|
| 日期 | `<yyyy-mm-dd>` |
| 执行人 | `<name>` |
| commit SHA | `<sha>` |
| Staging URL | `<url-or-ip>` |
| DB | `Staging PostgreSQL only` |
| Mail provider | `mock` / `sandbox` |
| 测试命令 | `<commands>` |
| 测试结果 | `pass` / `blocked` / `failed` |
| 阻塞项 | `<none-or-details>` |

## 4. 自动部署候选步骤

自动部署不在当前默认范围内。人工批准后可按以下顺序单独实施：

1. 确认允许 Agent 修改 `.github/workflows/`。
2. 创建 GitHub `staging` environment。
3. 人工在 UI 中创建 Staging secrets。
4. 设计 workflow：build、test、SSH deploy、smoke test。
5. 确认 workflow 不打印 secrets。
6. 先以 `workflow_dispatch` 手动触发验证。
7. 人工再决定是否改为 `main` 合并后部署或 tag 部署。

## 5. 阻塞项报告模板

当部署、确认或 CI/CD 设计无法继续时，按以下模板报告：

```text
阻塞层级: OCI / DNS / TLS / Secrets / Database / GitHub Actions / App / Smoke test
阻塞内容:
影响范围:
已确认事实:
未确认事项:
需要人工执行:
是否涉及真实 secret 或客户数据: No
建议下一步:
```

报告时不要粘贴 secret 值、生产连接串、客户邮箱列表或 OAuth refresh token。

## 6. 最终放行检查

- [ ] Terraform state 与 OCI Console 对齐。
- [ ] Staging VM 可 SSH 登录。
- [ ] Docker / Docker Compose 可用。
- [ ] 域名或临时 IP 验证方式已确认。
- [ ] Secrets 存放位置已确认，且未写入仓库。
- [ ] Staging DB 独立，不含真实客户数据。
- [ ] `MAIL_PROVIDER` 为 `mock` 或 `sandbox`。
- [ ] 发布触发方式已人工确认。
- [ ] Smoke test 已执行或明确记录为实现未完成。
- [ ] 日志不含真实 PII、生产 secret 或完整邮件凭据。
