# 首次部署候选的本机隔离演练（2026-11-19，日本时间）

**本机 Docker 演练通过，生产结论为暂不可部署。** 发布负责人可从[生产操作手册](../first-production-deployment.md)查看每个阻塞的解除条件。下列命令和数据仅用于本地。

## 实测记录

| 项目 | 本次观测 |
|---|---|
| 输入 | 独立 worktree 的 HEAD 与当时的 origin/main 均为 `a05251897d7fc11d96114606bcaa1807dd96af55`。以该提交的 Git archive 构建。回退选取 main 祖先 `29ce990d9cd16d934dab0d1a94d3bd0e2ab7a776`，前端实现不同，`git diff --exit-code` 确认两者的 `backend/prisma` 完全相同。 |
| 环境、构建 | Windows，既有 Docker Desktop Linux 引擎 29.7.2，Compose 5.5.1。命名管道在沙箱内拒绝访问，经授权使用本机 context。初始镜像列表为空；两份 Dockerfile 均从锁文件无缓存构建成功。Node 20.20.2、PostgreSQL 16.16。 |
| 配置与启动 | 独立项目、容器名、网络、卷、生成的临时密钥；运行前解析有效配置，运行后核对实际 DB、邮件开关和绑定。数据库无宿主端口；前端仅 `127.0.0.1:41870`，API 仅 `127.0.0.1:41871`。应用按 Postgres → Backend → Frontend 顺序 healthy，`/`、`/healthz`、`/health` 均为 200。 |
| 迁移 | 全新数据库 public 表数 0。第一次启动 Backend 前生成空库 custom dump 并通过清单检查。镜像入口应用 21 项迁移；重复 `npm run db:deploy` 返回无待应用项。最终未完成迁移数 0。 |
| 浏览器 | 候选镜像提供的 Playwright 与后台 Chrome 对实际构建产物执行 2 项仓库用例，15.2 秒，全部通过。合成 operator 登录、active 订阅、分配地点、拒绝未映射码、扫码、显示已发送、刷新后历史仍在；suspended 登录后扫码入口禁用。 |
| API 与数据库 | `npm run smoke:api` 验证登录 Cookie、订阅、地点、人员、未映射拒绝、等待与取消。取消的任务 0 次尝试/0 次 mock 调用；重扫为 sent，1 次尝试/1 次 mock 调用，提前认领 0。历史查询中有 3 条（2 sent、1 canceled），请求其他租户地点返回 404。 |
| CI 之外的验收 | 在候选已构建的 `dist` 上直接运行官方 `node scripts/tenant-deletion-acceptance-test.mjs`。使用数据库容器自身的 loopback 和脚本自建的临时数据库，退出 0，剩余匹配临时库 0。覆盖平台/租户鉴权、订阅与扫码/邮件门禁、恢复、到期终结和 Staging 立即删除的关联完整性。脚本内环境切换仅模拟业务分支。 |
| 业务备份与恢复 | 停止前后端，未终态任务 0。业务归档 83,457 字节，SHA-256 `889b887488225089ee0ac9ea72d4aea53d3922f6cc77f8d6678655aa19840fc4`。核验清单和传输校验和，单事务恢复到新 PG16 实例和新卷。19 张 public 表的行数及有序行内容摘要全部相同；含 2 租户、2 订阅、3 地点、3 扫码、3 任务、2 尝试、21 迁移。 |
| 数据库切换与应用回退 | 候选应用切换到恢复库，原有历史 3 条，跨地点仍为 404。实际替换成上述旧提交的两个镜像，两个健康端点和首页均为 200，3 条历史可读；旧版再次通过完整 API smoke。切回候选，恢复库有 5 条历史（3 sent、2 canceled），原库仍为 3 条。未执行 schema 降级。 |
| 资源与范围 | 项目标签下 4 个容器、2 个卷和 1 个网络已清理，临时应用镜像标签已删除。仅本机、合成数据、mock/false。未连接 Staging 或 Production，未创建云服务。 |

构建追溯（本机镜像 ID；Dockerfile 的远程标签可能移动）：

| 镜像 | 本次摘要（SHA-256） |
|---|---|
| Node 基础镜像 | `2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0` |
| PostgreSQL 16 | `3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f` |
| 候选 Backend / Frontend | `ddaf465bf040141dc912b2b7b195aafe978d3bd38ff4e5551726d5ee277b0712` / `d05833d67815e7f86325650c2f4a2ab95cd3cc6e8cb7475d17b98460422b6698` |
| 回退 Backend / Frontend | `35d0f2b3e67aacee5ca67f9a24f1facc9a1ed8e2a098611bcf88b921a0c7914a` / `8cb2be3420c66065aad2c6c81872c4f2643579114342b141deba6e7bcf00409b` |

精确候选的 main push CI 五项成功，含前后端、ADR-017 PostgreSQL release gate 和成功/失败两条 Critical E2E。[CI 44474610784](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784)

已有 Staging HTTPS、Caddy 与此前部署备份证据使用其他提交。此次覆盖本机 HTTP、Linux 容器、单实例小合成库；正式架构/容量、域名与 TLS、机密存储、告警路由、真实 provider 和灾备时限仍须在对应环境验收。[Staging HTTPS](staging-smoke-2026-07-29.md) · [2026-10-20 部署记录](staging-smoke-2026-10-20-issue168.md) · [ADR-024 验收清单](adr024-release-acceptance.md)

## 在另一个全新本地项目复现

下列 Bash 命令适用于本地 Linux/WSL 的 Docker CLI，给出与本次后台终端同一组仓库入口。需要 Git、Compose（支持 `!override`）、OpenSSL、Python 3 和两个空闲 loopback 端口。全程在同一 shell 执行。参数文件和 dump 放在仓库外的私有临时目录。

```bash
set -euo pipefail
umask 077
sha=a05251897d7fc11d96114606bcaa1807dd96af55
prior=29ce990d9cd16d934dab0d1a94d3bd0e2ab7a776
repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d /tmp/poolduck-drill.XXXXXXXX)
lab=pd-drill-$(openssl rand -hex 6)
ctx=default  # 本机 Linux socket；先核对对应的 context
clean=(env -i "PATH=$PATH" "HOME=$HOME")
d() { "${clean[@]}" docker --context "$ctx" "$@"; }
endpoint=$(d context inspect "$ctx" --format '{{.Endpoints.docker.Host}}')
case "$endpoint" in unix:///*|npipe:////./pipe/*) ;; *) exit 1;; esac
test "$(d info --format '{{.OSType}}')" = linux
test -z "$(d ps -aq --filter "label=com.docker.compose.project=$lab")"
test -z "$(d volume ls -q --filter "name=$lab")"
test -z "$(d network ls -q --filter "name=$lab")"
mkdir "$tmp/candidate" "$tmp/previous"
git -C "$repo" archive "$sha" | tar -x -C "$tmp/candidate"
git -C "$repo" archive "$prior" | tar -x -C "$tmp/previous"
git -C "$repo" diff --exit-code "$prior" "$sha" -- backend/prisma
cat >"$tmp/params" <<EOF
LAB=$lab
POSTGRES_DB=drill
POSTGRES_USER=drill
APP_ENV=local
API_BASE_URL=http://127.0.0.1:3001
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:41871
CORS_ORIGIN=http://127.0.0.1:41870
MAIL_PROVIDER=mock
REAL_MAIL_SEND_ENABLED=false
MAIL_MOCK_SEND_RESULT=success
OCI_MAIL_APP_ALERTS_ENABLED=false
STAGING_TENANT_DELETE_ENABLED=false
RECORD_RETENTION_PROCESSOR_ENABLED=false
EOF
for key in POSTGRES_PASSWORD JWT_SECRET REFRESH_TOKEN_SECRET PLATFORM_JWT_SECRET \
  PLATFORM_REFRESH_TOKEN_SECRET PLATFORM_PROVISIONING_SECRET AUTH_IDENTITY_HASH_SECRET; do
  echo "$key=$(openssl rand -hex 32)" >>"$tmp/params"
done
cat >"$tmp/isolated.yml" <<'YAML'
services:
  postgres:
    container_name: ${LAB:?}-db
    restart: "no"
    ports: !reset []
  backend:
    container_name: ${LAB:?}-api
    image: ${LAB:?}-api:candidate
    restart: "no"
    ports: !override ["127.0.0.1:41871:3001"]
  frontend:
    container_name: ${LAB:?}-web
    image: ${LAB:?}-web:candidate
    restart: "no"
    ports: !override ["127.0.0.1:41870:3000"]
YAML
base=(compose -p "$lab" --project-directory "$tmp/candidate" --env-file "$tmp/params"
      -f "$tmp/candidate/docker-compose.yml" -f "$tmp/isolated.yml")
dc() { d "${base[@]}" "$@"; }
dc config --format json | python3 -I -c '
import json, sys
m = json.load(sys.stdin)
lab = sys.argv[1]
s = m["services"]
assert m["name"] == lab and set(s) == {"backend", "frontend", "postgres"}
assert m["volumes"]["postgres-data"]["name"] == lab + "_postgres-data"
assert s["postgres"]["container_name"] == lab + "-db" and not s["postgres"].get("ports")
for name, suffix, port in [("backend", "-api", "41871"), ("frontend", "-web", "41870")]:
    p, = s[name]["ports"]
    assert (s[name]["container_name"], p["host_ip"], str(p["published"])) == (lab+suffix, "127.0.0.1", port)
e = s["backend"]["environment"]
assert (e["APP_ENV"], e["MAIL_PROVIDER"], e["REAL_MAIL_SEND_ENABLED"]) == ("local", "mock", "false")
assert e["DATABASE_URL"] == "postgresql://drill:" + s["postgres"]["environment"]["POSTGRES_PASSWORD"] + "@postgres:5432/drill"
' "$lab"
dc build --no-cache backend frontend
dc up -d --wait postgres
pg() { dc exec -T postgres "$@"; }
test "$(pg psql -XAt -U drill -d drill -c "select count(*) from pg_tables where schemaname='public'")" = 0
pg pg_dump -Fc -U drill drill >"$tmp/before-migration.dump"
pg pg_restore -l <"$tmp/before-migration.dump" >/dev/null
dc up -d --no-build --pull never --wait backend frontend
dc exec -T backend npm run db:deploy
curl --noproxy '*' -fsS http://127.0.0.1:41870/healthz >/dev/null
curl --noproxy '*' -fsS http://127.0.0.1:41871/health >/dev/null
dc exec -T backend node -e 'const e=process.env,u=new URL(e.DATABASE_URL);
  if(e.APP_ENV!=="local"||e.MAIL_PROVIDER!=="mock"||e.REAL_MAIL_SEND_ENABLED!=="false"||
     u.hostname!=="postgres"||u.pathname!=="/drill"||u.username!=="drill"||
     ["../.env",".env",".env.local"].some(p=>require("node:fs").existsSync(p))) process.exit(1)'
dc exec -T backend npm run local:seed >/dev/null
```

在空历史时先跑前端的 `mvp-workspace.spec.ts`。以下用例跟随页面配置定位 API；该文件另有用例写死 `localhost:3001`。在装有 Node 20 与 Chrome 的本地测试机上，从干净的候选副本运行：

```bash
("${clean[@]}" npm --prefix "$tmp/candidate/frontend" ci --no-audit --no-fund)
("${clean[@]}" PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_BASE_URL=http://127.0.0.1:41870 \
  npm --prefix "$tmp/candidate/frontend" run test:e2e -- mvp-workspace.spec.ts \
  -g 'MVP GUI: login|MVP GUI blocks scan' --workers=1 --trace off)
```

然后运行 API 和官方租户验收。后者使用临时容器共用 DB 的网络命名空间，保留其 localhost 守卫。

```bash
dc exec -T backend npm run smoke:api
dc exec -T backend node -e 'const u=new URL(process.env.DATABASE_URL);
  u.hostname="127.0.0.1"; process.stdout.write("DATABASE_URL="+u.href+"\n")' >"$tmp/accept.env"
d run --rm --network "container:$lab-db" --env-file "$tmp/accept.env" \
  -e APP_ENV=test -e MAIL_PROVIDER=mock -e REAL_MAIL_SEND_ENABLED=false \
  "$lab-api:candidate" node scripts/tenant-deletion-acceptance-test.mjs
```

### 还原并实际切换版本

```bash
dc stop frontend backend
test "$(pg psql -XAt -U drill -d drill -c "select count(*) from mail_jobs where status not in ('sent','canceled')")" = 0
pg pg_dump -Fc -U drill drill >"$tmp/business.dump"
pg pg_restore -l <"$tmp/business.dump" >/dev/null
sha256sum "$tmp/business.dump" >"$tmp/business.sha256"
cat >"$tmp/recover.yml" <<'YAML'
services:
  restoredb:
    image: postgres:16
    environment:
      POSTGRES_DB: drill
      POSTGRES_USER: drill
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
    volumes: ["recovered:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD","pg_isready","-U","drill","-d","drill"]
      interval: 3s
      timeout: 3s
      retries: 20
  backend:
    environment:
      DATABASE_URL: postgresql://drill:${POSTGRES_PASSWORD:?}@restoredb:5432/drill
    depends_on: !override
      restoredb:
        condition: service_healthy
volumes:
  recovered:
YAML
rc() { d "${base[@]}" -f "$tmp/recover.yml" "$@"; }
rc up -d --no-deps --wait restoredb
sql() { rc exec -T "$1" psql -XAt -v ON_ERROR_STOP=1 -U drill -d drill -c "$2"; }
test "$(sql restoredb "select count(*) from pg_tables where schemaname='public'")" = 0
sha256sum --check "$tmp/business.sha256"
rc exec -T restoredb pg_restore --single-transaction --exit-on-error --no-owner -U drill -d drill <"$tmp/business.dump"
for service in postgres restoredb; do
  sql "$service" "select tablename from pg_tables where schemaname='public' order by 1" |
  while read -r t; do
    [[ $t =~ ^[a-z_]+$ ]] || exit 1
    sql "$service" "select '$t', count(*), md5(coalesce(string_agg(to_jsonb(r)::text,'' order by to_jsonb(r)::text),'')) from $t r"
  done >"$tmp/$service.summary"
done
diff -u "$tmp/postgres.summary" "$tmp/restoredb.summary"
rc up -d --no-build --pull never --wait backend frontend
rc exec -T backend node -e 'if(new URL(process.env.DATABASE_URL).hostname!=="restoredb") process.exit(1)'
cat >"$tmp/previous.yml" <<EOF
services:
  backend:
    image: $lab-api:previous
    build: {context: "$tmp/previous/backend"}
  frontend:
    image: $lab-web:previous
    build: {context: "$tmp/previous/frontend"}
EOF
prev() { d "${base[@]}" -f "$tmp/recover.yml" -f "$tmp/previous.yml" "$@"; }
prev build backend frontend
prev up -d --no-deps --no-build --pull never --wait --force-recreate backend frontend
prev exec -T backend npm run smoke:api
rc up -d --no-deps --no-build --pull never --wait --force-recreate backend frontend
```

每次切换均检查首页和两个健康端点，用同一合成 operator 登录，在分配地点刷新历史。回退后新增记录应只出现在恢复库。核对项目标签、容器名、两个卷和网络均属于本轮后，执行 `rc down --volumes`，删除四个以本轮 `$lab` 命名的镜像标签以及该私有临时目录。仅发布汇总计数、状态和归档校验和。
