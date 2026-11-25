# Staging 部署与恢复手册

本手册用于 Staging 部署前人工确认、操作者/Agent 触发的应用部署、恢复与阻塞项报告。cloud-init 只负责主机 bootstrap，不负责应用部署。部署控制边界以 ADR-005 为准。

## 1. 使用边界

- 当前默认平台：OCI Always Free 单 VM + Docker Compose。
- 人工批准维护窗口、目标主机、专用数据库和完整提交后，操作者或 Agent 通过 SSH 在准备好的 checkout 根目录运行 [部署脚本](../deploy/staging/deploy.py)。第 3 章同时保留底层命令供人工接管。
- 当前默认数据库：Staging VM 内 PostgreSQL 16。
- 常规部署与 smoke 使用 `mock`。`sandbox` 不是有效的 selector。
- 当前禁止事项：真实客户数据、生产数据库快照、生产密钥、真实 Gmail/Workspace/SMTP 凭据、OAuth refresh token。

如果本手册中的任何确认项无法完成，停止部署或 CI/CD 实施，并按“阻塞项报告模板”记录。

2026-10-16 的 Staging OCI HTTPS 单封和回滚仅覆盖当次获批窗口。常规部署和 smoke 前核对目标环境生效的 `MAIL_PROVIDER=mock` 与 `REAL_MAIL_SEND_ENABLED=false`。真实切换须按 [OCI Staging 执行卡](oci-mail-staging-operator-runbook.md) 完成当次预检并另获批准。历史依据见 [准入参考](oci-mail-staging-readiness.md)，排障与重试规则见 [运维手册](operation.md#2-邮件发送失败)。

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

#116 扩容前先按 [OCI Staging 参数准备说明](../infrastructure/oci-staging/README.md) 核对当前免费额度。
2026-09-08 已将 A1 调整为 2 OCPU / 12 GB，启动盘 100 GB；完整 plan 无变更，见 [执行记录](testing/staging-resize-2026-09-08.md)。
规格变更需维护窗口、备份和新的完整 plan；发现实例替换或无关漂移时停止。
实例创建后的 `metadata["user_data"]` 不随模板修改更新；新模板只用于新实例。
既有主机的包、权限及安全修复必须通过本 Runbook 单独核验和实施，不能用重跑 cloud-init 代替部署。
2026-09-08 差异及原地更新计划见 [处理记录](testing/staging-cloud-init-drift-2026-09-08.md)。

### 2.3 Issue #116 容量测试

Staging 扩容本身不代表扫码发信容量。正式压测统一使用
[`docs/testing/staging-capacity-runbook.md`](testing/staging-capacity-runbook.md)，从 VM 外生成负载，
仅使用专用合成 tenant 与 mock/sandbox provider。每次执行必须先批准窗口、备份、记录精确 commit 和
实际规格，并同时采集宿主机、容器、API、mail queue 与 PostgreSQL 指标；达到停止条件立即停止加压。

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

当前 Staging 域名与 TLS 确认方法：

1. 确认 `app.poolducktest.com` 的 A record 指向当前 Staging VM public IP。
2. 确认 OCI NSG 和主机防火墙按 2026-07-29 人工批准允许公网访问 TCP `80`/`443`；SSH 仍仅允许管理员 CIDR。
3. 等待 DNS 生效。
4. 从批准来源验证 DNS、HTTP 跳转、HTTPS 证书和健康端点。

示例命令：

```bash
nslookup app.poolducktest.com
curl -I http://app.poolducktest.com
curl -I https://app.poolducktest.com
curl -fsS https://app.poolducktest.com/health
```

通过标准：

- DNS 指向当前 Staging VM public IP。
- Caddy 使用 Let's Encrypt ACME HTTP-01 取得有效的单域名证书；不使用 wildcard 或 DNS provider 凭据。
- HTTP 业务请求跳转到 HTTPS；`/healthz`、`/health` 和 `/api/*` 路由保持可用。
- 证书、私钥和 ACME 状态只保存在 Caddy named volume，不写入仓库或部署日志。

### 2.5 Secrets 存放位置

可选位置：

- GitHub Actions Environment Secrets：用于后续自动部署。
- 平台 UI：如果托管平台提供 secret store。
- VM 本地 `.env`：当前 Compose 部署使用的配置来源。

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

部署或人工恢复前，应先在操作者本机生成 gitignored 的 `.secrets/staging/staging.env`，再通过受控方式提供给 VM 的 `<staging-app-dir>/.env`。不要通过嵌套 SSH heredoc 或多层 shell inline 命令生成 `.env`，避免 `$POSTGRES_PASSWORD`、`DATABASE_URL` 等值在错误的 shell 层展开后写坏。

示例：

```powershell
git check-ignore -v .secrets\staging\staging.env
scp -i .secrets\staging\id_ed25519 .secrets\staging\staging.env ubuntu@<staging-public-ip>:<staging-app-dir>/.env
ssh -i .secrets\staging\id_ed25519 ubuntu@<staging-public-ip> "chmod 600 <staging-app-dir>/.env"
```

通过标准：

- Staging secrets 与 Production secrets 完全独立。
- `DATABASE_URL`、`JWT_SECRET`、`REFRESH_TOKEN_SECRET`、`POSTGRES_PASSWORD` 不进仓库；OCI HTTPS 不使用 SMTP 密码或 OCI API 私钥。
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

1. 确认 `MAIL_PROVIDER=mock`；`sandbox` 不是有效的 selector。
2. 如果使用 Mailpit/Mailhog，确认服务只用于 Staging 内部验证。
3. 执行 smoke test 时只检查 sandbox 记录或 mock provider result。

示例命令：

```bash
# 在第 3.3 节准备好批准参数后执行
python3 deploy/staging/deploy.py "${approval[@]}" --check
```

通过标准：

- 不配置真实 SMTP/Gmail/Workspace/OAuth refresh token。
- 不向真实客户邮箱投递。
- 日志中不打印完整邮件凭据或真实收件人列表。

### 2.8 GitHub Actions 与发布触发方式

确认方法：

1. 人工确认当前发布触发方式为操作者/Agent 执行、未来 `workflow_dispatch` 或其他已批准方式。
2. 人工决定 Agent 是否可以读取或修改 `.github/workflows/`。
3. 如选择自动部署，先确认 GitHub `staging` environment 和 secrets 权限。
4. 在未确认前，不创建或修改自动发布 workflow。

通过标准：

- 当前默认由人工批准后，操作者或 Agent 触发部署。
- cloud-init 只完成主机 bootstrap，不运行应用 Compose。
- 自动发布只在单独 Issue 或明确授权下实施。
- GitHub secrets 只由人工在 UI 中创建，不由 Agent 实际创建。

## 3. 当前部署与人工恢复步骤

在批准的单主机、单 checkout 上执行。第 3.1–3.3 节准备部署，脚本成功或失败都报告阶段。第 3.4–3.7 节用于人工分步执行、排障和回滚。

### 3.1 部署前检查

1. 完成第 2 章所有确认项。
2. 在维护窗口记录已批准的完整 40 位 commit SHA、主机、Compose 项目 `poolduck-mail-staging` 和专用库名。与负责人确认数据均为合成数据，检查备份及恢复可用性。
3. 确认没有未授权 Production 资源、Production secrets 或真实客户数据。
4. 确认当前应用代码支持本次 smoke test 所需 endpoint；尚未实现的 endpoint 记录为实现阻塞项。

### 3.2 准备应用目录

示例命令：

```bash
sudo mkdir -p /opt/poolduck-mail-staging
sudo chown <staging-user>:<staging-user> /opt/poolduck-mail-staging
cd /opt/poolduck-mail-staging
```

首次部署先执行 `git clone <repo-url> .`。已有旧栈首次采用本模板时，先在**仍运行旧版本**的工作树完成下面的首次切换预检。常规发布直接从已通过 CI 的候选选择完整提交 SHA。

#### 首次切换预检（仅限已有旧格式部署）

在改 checkout、配置或运行迁移之前，对照最近一次实际部署记录，确认旧提交、Compose 项目、文件顺序、环境来源及运行中的前后端、Postgres 和代理。保留 Staging 数据库的可恢复备份。比较候选与旧提交的 schema、迁移及数据语义，确认旧应用可读取候选迁移后的数据库；有差异时先在隔离副本演练。核对存量队列和发送开关，避免重放待处理任务。任一项无法确认，或旧镜像无法导出、复载，停在旧栈。

以下 Bash 数组按旧部署实际启动参数填写。额外覆盖文件、非 Git 配置、外部 secret 和临时环境覆盖须在受限备份中保留对应版本，记录取回方法。示例复制旧栈的 `.env`；只将摘要与工件位置写入部署记录。

```bash
set -euo pipefail
: "${STAGING_PROJECT:?set the existing Compose project name}"
old_dc=(docker compose --env-file .env -p "$STAGING_PROJECT" -f docker-compose.yml -f docker-compose.staging.yml)
pg_volume() {
  docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/var/lib/postgresql/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$("${old_dc[@]}" ps -q postgres)"
}
```

```bash
: "${LEGACY:?set an unused absolute private backup directory outside the checkout}"
umask 077
mkdir -m 700 "$LEGACY"
git diff --quiet HEAD
git rev-parse HEAD > "$LEGACY/commit"
install -m 600 .env "$LEGACY/staging.env"
"${old_dc[@]}" config --format json | sha256sum > "$LEGACY/model.sha256"
pg_volume > "$LEGACY/postgres.volume"
test -n "$(cat "$LEGACY/postgres.volume")"
echo 'services:' > "$LEGACY/images.compose.yml"
for svc in backend frontend; do
  cid=$("${old_dc[@]}" ps -q "$svc")
  test "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" = healthy
  id=$(docker inspect --format '{{.Image}}' "$cid")
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]]
  echo "$id" > "$LEGACY/$svc.id"
  printf '  %s:\n    image: %s\n    build: !reset null\n    pull_policy: never\n' "$svc" "$id" >> "$LEGACY/images.compose.yml"
done
docker image save -o "$LEGACY/images.tar" "$(cat "$LEGACY/backend.id")" "$(cat "$LEGACY/frontend.id")"
docker image load -i "$LEGACY/images.tar"
for svc in backend frontend; do
  docker run --rm --network none --read-only --pull=never --entrypoint node "$(cat "$LEGACY/$svc.id")" --version
done
"${old_dc[@]}" -f "$LEGACY/images.compose.yml" config --quiet
(cd "$LEGACY" && sha256sum commit staging.env model.sha256 postgres.volume backend.id frontend.id images.compose.yml images.tar > SHA256SUMS && sha256sum SHA256SUMS)
```

独立保存最后输出的摘要。确认旧项目和两端镜像 ID 仍匹配正在运行的栈，备份与回退路径均可用后，方可开始下列候选检出。

#### 检出候选

```bash
set -eu
: "${CANDIDATE:?set the approved full commit SHA}"
git fetch origin main
git checkout --detach "$CANDIDATE"
test "$(git rev-parse HEAD)" = "$CANDIDATE"
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
- `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`
- `MAIL_MOCK_SEND_RESULT=success`
- `STAGING_TENANT_DELETE_ENABLED=true`（仅在已批准的 Staging 主机启用；删除时重新验平台管理员密码，直接物理清理且不可恢复）
- `LOG_LEVEL=info`
- `API_BASE_URL=https://app.poolducktest.com`
- `NEXT_PUBLIC_API_BASE_URL=/`
- `CORS_ORIGIN=https://app.poolducktest.com`
- `TENANT_CONTEXT_ENFORCED=true`

显式设置 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`AUTH_IDENTITY_HASH_SECRET` 和第 3.9 节的三个独立平台密钥。使用 Compose 的单行 dotenv 赋值，每键一行。为兼容现有 Compose 拼接方式，数据库密码可用随机十六进制。连接串使用内部 `postgres:5432`，省略查询参数。保管真实值，记录中只写核对结果。

**人工部署入口**。首次切换前按 3.2 保存现有应用镜像对、配置和可恢复备份，核对队列与数据库兼容性。按 3.4 的准备步骤为获准提交和目标架构生成一次归档，将清单 SHA-256 存入独立发布记录。启动或重跑时，从该记录选取同一归档和摘要。目标机需要 Bash、Python 3、Git、curl、支持 `!reset` 和 `up --wait` 的 Compose，以及已有的 PG16 和 Caddy 镜像。

```bash
set -eu
: "${CANDIDATE:?set the approved full commit SHA}" "${STAGING_DB:?set the approved database name}"
approval=(--approved-synthetic-staging --commit "$CANDIDATE" --database "$STAGING_DB")
python3 deploy/staging/deploy.py "${approval[@]}" --check
: "${RELEASE:?select the prepared artifact directory}" "${LOCK_SHA256:?set the digest from the selected release record}"
pair=(--release "$RELEASE" --lock-sha256 "$LOCK_SHA256")
python3 deploy/staging/deploy.py "${approval[@]}" "${pair[@]}"
# 仅在需要初始化或修复合成夹具时，给上一条命令追加 --seed。
```

`--check` 只读检查源码与基础 Compose 模型。实际部署先做同一预检，再验证并载入发布归档。预检拒绝脏 checkout、缺项、示例密钥、Shell 的 Compose/应用覆盖和非本机 Docker endpoint。脚本在内存中核对 Compose 展开后的 backend、postgres 环境与批准的数据库，检查 mock、关闭真实投递、内部端口、后端 API/CORS origin 和前端同源路径 `/`。最终模型只允许用清单里的两个镜像 ID 取代构建定义；启动使用 `--no-build --pull never`，随后核对运行容器的 ID 和 Node 补丁版本。它无法从库名判断数据来源，数据与窗口仍由操作者确认。整个窗口固定 checkout 和 `.env`，只使用这一份目录；并行脚本会因目录锁返回非零。

release 或 start 失败时回到 3.4 核验同一份归档。Backend 启动时可能已应用迁移，保留原卷并检查迁移状态。首次切回旧格式时，按 3.7 恢复 3.2 保存的旧镜像、配置和校验记录。

退出码 0 表示所选流程通过，1 表示失败，2 表示参数错误，Ctrl-C 通常返回 130。记录首个失败阶段和手册节号，先检查当前服务和迁移状态。构建和下游命令的原始输出可能含敏感信息，脚本仅转述阶段、服务、结果与退出码。人工排查只在受控终端查看必要信息，禁止粘贴展开的 Compose 配置、容器完整 inspect、连接串或原始日志。

### 3.4 构建和启动服务

仓库当前已提供 `docker-compose.yml` 与 `docker-compose.staging.yml`。Staging 使用以下服务：

- `reverse-proxy`
- `frontend`
- `backend`
- `postgres`

当前 `MAIL_PROVIDER=mock` 时不需要独立 `mail-sandbox` 服务；只有后续明确引入 sandbox 容器时才新增该服务。
Caddy 使用固定版本镜像，`caddy-data` 保存证书私钥和 ACME 状态，`caddy-config` 保存运行时配置；不得使用 `docker compose down -v` 清理这些卷。

历史 Staging 记录为 OCI Ubuntu `linux/arm64`。每次发布先在当次获准的目标主机运行 `docker version --format '{{.Server.Os}}/{{.Server.Arch}}'` 并记录实测平台，再在该平台准备工件。需要 Python 3、Git、Docker 和支持 `!reset` 的 Compose。准备阶段从候选提交读取两个 Git 构建上下文；前端以同源路径访问 Caddy 转发的 `/api/`。工件目录放在工作树外，保留上一套通过验收的工件与记录。

```bash
set -eu
: "${RELEASE:?set a new absolute artifact directory}"
python3 deploy/staging/release.py prepare "$RELEASE"
```

保存输出的 `release.json` SHA-256 到独立的候选记录。启动、恢复或成对回退时从所选记录填写 `LOCK_SHA256`；将其对应的 `release.json` 和 `images.tar` 放入 `RELEASE`，按 3.2 检出对应提交，并完成数据库备份。验证程序检查归档、目标架构、两端提交标签、镜像 ID 和实际 Node 补丁，再生成仅引用两个 ID 的 Compose 覆盖文件。

```bash
set -eu
: "${LOCK_SHA256:?set the digest from the selected release record}"
python3 deploy/staging/release.py verify "$RELEASE" "$LOCK_SHA256"
dc() { docker compose -p "${STAGING_PROJECT:-poolduck-mail-staging}" -f docker-compose.yml -f docker-compose.staging.yml -f "$RELEASE/images.compose.yml" "$@"; }
dc config --quiet
docker run --rm --pull=never --network none -v "$PWD/deploy/staging/caddy:/etc/caddy:ro" caddy:2.11.4-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
dc up -d --no-build --pull never --wait
dc ps
for service in backend frontend; do
  docker inspect --format '{{.Image}}' "$(dc ps -q "$service")"
  dc exec -T "$service" node --version
done
```

将两端容器的实际 ID 与 `release.json` 逐项核对。保留本次验收的清单、归档及独立核对的摘要。将来生产只可晋级最新一次通过**实际 Staging** 完整验收的同一提交与归档，复用相同平台及同一对镜像 ID；补丁更新、架构变化或重建均须先重新通过 Staging。

### 3.5 数据库 migration 与 seed

执行原则：

- 只使用 Staging DB。
- 只使用 seed/dummy tenant、user、location、barcode、email。
- 不导入 Production dump。

示例命令：

```bash
dc exec -T backend npm run db:deploy
dc exec -T backend npm run staging:seed
```

`staging:seed` 仅写入 synthetic `.example.local` 测试数据，并准备 active、suspended、expired 三类订阅状态用于 Staging 验证。

### 3.6 Smoke test

脚本逐个检查四项服务的健康状态、Caddy 到 `/health` 与 `/healthz` 的路由，再在 backend 内通过回环地址调用现有 API smoke。人工接管可执行：

```bash
dc exec -T backend npm run smoke:api -- --staging >/dev/null 2>&1
```

成功的主动冒烟会登录合成 operator，产生新的 session、审计和幂等记录，以及 2 条扫码、2 个邮件任务（取消和 mock 成功各 1 个）、1 次 mock 调用。迁移重跑不新增已完成迁移，seed 按固定身份更新，可能刷新时间戳和密码哈希。失败或中断的 smoke 可能已写入部分记录，重跑前先核对；不要删除已有历史。仅需检查服务状态时使用 `dc ps` 和健康端点。

另在批准的真实 Staging 窗口完成人工入口检查：

```bash
curl -I http://app.poolducktest.com
curl -fsS https://app.poolducktest.com/health
curl -fsS https://app.poolducktest.com/healthz
echo | openssl s_client -connect app.poolducktest.com:443 -servername app.poolducktest.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

业务检查按 `docs/testing.md` 的 Staging smoke 清单执行；部署记录保存在 `docs/testing/staging-smoke-<date>.md`。同时确认响应包含已批准的安全头、登录 Cookie 带 `Secure`，并从外部验证 `3000`、`3001`、`5432` 不可访问。若后续清单新增尚未实现的 API，记录为“实现未完成”，不要改用真实数据绕过。

在已确认使用 mock 的 Staging 栈中，用 3.5 写入的 active 合成账号执行 API 冒烟。脚本从容器的 `API_BASE_URL` 经过 HTTPS 代理访问应用，并从同一数据库核对任务与发送尝试。合成账号密码见测试手册第 5 节。

```bash
: "${API_SMOKE_PASSWORD:?set the synthetic Staging seed password}"
dc exec -T -e API_SMOKE_TENANT_CODE=5A6E000001 \
  -e API_SMOKE_IDENTIFIER=staging-active-operator -e API_SMOKE_PASSWORD="$API_SMOKE_PASSWORD" \
  -e API_SMOKE_LOCATION_ID=5A6E0001 -e API_SMOKE_SCAN_CODE=E01K0ABC20001 \
  -e API_SMOKE_UNMAPPED_SCAN_CODE=E01K0ABC29999 backend npm run smoke:api
```

### 3.7 HTTPS 回滚

1. 停止外部测试并记录维护窗口。
2. 保留数据库备份与 Caddy named volumes，不执行 `down -v`。
3. 先确认旧应用与当前数据库结构兼容。若上一次是 3.2 保存的旧格式部署，执行下面的首次切换回退。若上一次已使用新模板，检出对应提交，恢复匹配配置并从 3.4 的 `verify` 开始成对恢复。
4. 复核迁移状态、健康、HTTPS 登录、现有历史与 mock 队列。数据库恢复遵循单独的备份恢复流程。
5. 若问题仅为证书签发，优先修复 DNS、80/443、ACME challenge 或 Caddy 数据卷，不回滚数据库。

**首次切换回退到旧格式。** 在原工作目录，根据受限备份还原旧配置来源、Compose 项目和参数，重新定义 3.2 的 `old_dc` 与 `pg_volume`。确认存量队列适合安全复启，比较旧应用与当前数据库兼容性。以下命令仅重建两个应用容器，使用切换前导出的镜像。旧 checkout 可完全没有 `release.py`、`.nvmrc` 和 `release.json`。

```bash
set -euo pipefail
: "${LEGACY_SUM:?set the checksums-file digest from the pre-cutover record}"
(cd "$LEGACY" && printf '%s  SHA256SUMS\n' "$LEGACY_SUM" | sha256sum -c - && sha256sum -c SHA256SUMS)
git diff --quiet HEAD
git checkout --detach "$(cat "$LEGACY/commit")"
install -m 600 "$LEGACY/staging.env" .env
test "$("${old_dc[@]}" config --format json | sha256sum)" = "$(cat "$LEGACY/model.sha256")"
test "$(pg_volume)" = "$(cat "$LEGACY/postgres.volume")"
docker image load -i "$LEGACY/images.tar"
locked_old=("${old_dc[@]}" -f "$LEGACY/images.compose.yml")
"${locked_old[@]}" config --quiet
"${locked_old[@]}" up -d --no-deps --no-build --pull never --wait backend frontend
for svc in backend frontend; do
  test "$(docker inspect --format '{{.Image}}' "$("${locked_old[@]}" ps -q "$svc")")" = "$(cat "$LEGACY/$svc.id")"
done
test "$(pg_volume)" = "$(cat "$LEGACY/postgres.volume")"
```

### 3.8 部署记录

每次部署、恢复或重新部署后记录：

| 项目 | 内容 |
|---|---|
| 日期 | `<yyyy-mm-dd>` |
| 执行人 | `<name>` |
| commit SHA / 完整 CI | `<full-sha>` / <run-url> |
| 工件 | 清单与归档 SHA-256、两端实际镜像 ID、平台、两端 Node 补丁、归档保管位置 |
| Staging URL | `<url-or-ip>` |
| DB | `Staging PostgreSQL only` |
| Mail provider | `mock` |
| 测试命令 | `<commands>` |
| 测试结果 | 退出码、四项服务状态、migration、seed（执行/跳过）、health、smoke 及人工待验项 |
| 阻塞项 | `<none-or-details>` |

### 3.9 Platform control plane 初始化、恢复与紧急关闭（ADR-013）

本节仅是受控 Runbook。每次 Staging 执行都需要单独人工批准目标、备份窗口、合成
`.example.local` 邮箱和 Secret 注入方式；不得将值粘贴到命令历史、Issue 或日志。

1. 先备份 Staging 数据库，保存完整 migration plan，并确认没有无关资源替换。
2. 在 Staging `.env` 通过受控流程注入不同于 tenant JWT 的
   `PLATFORM_JWT_SECRET`、`PLATFORM_REFRESH_TOKEN_SECRET` 和至少 32 字符的
   `PLATFORM_PROVISIONING_SECRET`；重建 Backend 后先确认 tenant 工作台回归正常。
3. 执行 `npm.cmd run db:deploy`，核对 tenant 行数、未 purged location 行数及
   `location_limit=max(1, current_count)` 的 backfill 统计。
4. 仅通过不会回显值的运行时环境注入 `PLATFORM_ADMIN_EMAIL` /
   `PLATFORM_ADMIN_PASSWORD`，执行 `npm.cmd run platform:admin -- bootstrap`。重复 bootstrap
   必须失败，数据库必须仍只有一个 active platform_admin。
5. 合成验证必须显式 opt-in：`PLATFORM_SYNTHETIC_SEED=true`、测试邮箱必须以
   `.example.local` 结尾、测试密码运行时注入；执行 `npm.cmd run platform:seed` 两次并核对幂等。
6. 执行平台 API smoke 和 Frontend E2E，验证独立 Cookie/audience、租户原子创建与重放、
   四种 subscription、额度拒绝、暂停/恢复、Session 撤销和脱敏审计。输出只记录通过/失败与内部
   request ID，不记录密码、token、完整邮箱或业务 PII。
7. 日常轮换执行 `platform:admin -- rotate`；紧急禁用执行 `-- disable`；受控恢复执行
   `-- recover`。三者都必须撤销全部既有平台 Session。
8. 紧急关闭平台 UI/API 时，先在 Caddy/入口层阻断 `/platform*` 与 `/api/platform/*`，再移除
   Backend 的平台 Secret 并重建 Backend；不要停止 tenant Frontend/Backend。确认现有 tenant
   工作台继续按原 subscription/权限运行。
9. 回滚顺序：先关闭平台入口，再回滚应用；数据库 guarded rollback 只有在不存在平台身份、
   平台审计、平台开通 tenant 和 `must_change_password=true` 状态时才允许执行。否则保留扩展表/
   字段或先导出归档，禁止用删表伪造回滚。

截至 Issues #110–#113 的本地完成范围，本 Runbook 尚未在 Staging 执行。

## 4. 本机复核与后续触发方式

本机隔离项目的命令、故障注入、恢复和留存核对见[演练说明](testing/staging-deploy-rehearsal.md)。后续若采用 `workflow_dispatch`，须另行批准触发与 GitHub Environment 权限，沿用相同部署入口。

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
- [ ] `app.poolducktest.com` 的 DNS、有效证书和 HTTP→HTTPS 跳转已确认。
- [ ] Secrets 存放位置已确认，且未写入仓库。
- [ ] Staging DB 独立，不含真实客户数据。
- [ ] 常规部署已核对目标环境实际生效的 `MAIL_PROVIDER=mock` 与 `REAL_MAIL_SEND_ENABLED=false`。真实 OCI 窗口须按 [执行卡](oci-mail-staging-operator-runbook.md) 独立批准。
- [ ] 发布触发方式已人工确认。
- [ ] Smoke test 已执行或明确记录为实现未完成。
- [ ] 公网仅可达 Caddy 的 TCP `80`/`443`；`3000`、`3001`、`5432` 不可达，SSH 仍限制为管理员 CIDR。
- [ ] Caddy `/data` 与 `/config` named volumes 存在且未被清理。
- [ ] 日志不含真实 PII、生产 secret 或完整邮件凭据。
