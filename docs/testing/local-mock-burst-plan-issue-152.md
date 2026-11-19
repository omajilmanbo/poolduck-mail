# #152 本地 mock 扫码与邮件队列 burst 计划

状态 **待人工批准**。被测应用为 `a05251897d7fc11d96114606bcaa1807dd96af55`。本轮仅验证负载器计划和离线单测。批准须在 [#152](https://github.com/omajilmanbo/poolduck-mail/issues/152) 记录操作者、监控与叫停负责人、日期与 JST 起止时间、候选 SHA、Local Docker 环境、下列参数和剩余验收缺口。实际读写数据库、启动服务、发 HTTP 及施加负载均在批准后执行。变更窗口、目标、并发或停止线须重新批准。全程使用合成数据和 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，范围仅限本地，预算为零云费用、零真实投递。

## D04 待批准参数

| 窗口内分钟 | 阶段 | 拟批准负载和推进条件 |
|---|---|---|
| 0–25 | 准备与低负载回归 | 核对隔离、seed、备份并验证恢复，执行 API smoke，再跑 1 并发 × 30 秒 |
| 25–45 | steady 对照 | 5、10、20 并发各 120 秒，每用户间隔至少 1,000 ms，分别运行，计划上界约 5/10/20 请求/秒 |
| 45–65 | 短时 burst | 10、20 并发各 30 秒，闭环无 think time，每档单独启动和排空，最大 20 个在途请求 |
| 65–80 | mixed-success 与隔离探针 | 10 并发 × 60 秒，1,000 ms 间隔，约 10 请求/秒，目标 80% 有效、10% unmapped、10% suspended。隔离探针使用独立子窗口 |
| 80–100 | mock failure 与重启恢复 | 1 并发 × 5 秒，1,000 ms 间隔，至多 5 次请求。观察首次通用失败后停负载，重建后端恢复 mock success，观察计划重试。受控重启仅在此子窗口 |
| 100–120 | 低负载回归与撤销 | 重跑同一 smoke 和 1 并发 × 30 秒阶段，排空并导出脱敏结果，停止专用服务 |

推荐窗口 2 小时，含准备、采样、降温和撤销。时间不足时跳过剩余档位并记录缺测。每档开始前 backlog 必须为 0，采样正常，上一档达到推进条件。每 15 分钟滚动窗口最多 50 次登录尝试，包含重跑与人工探针；接近预算则等待，登录 429 时停止当前档并检查计数。请求超时 5 秒，人员复用至少 10.5 秒。闭环 burst 的到达率随响应时间变化，审批口径为并发/时长上限和每 5 秒 **500 个数据库新 job** 的采样停止线。报告另列实际完成 RPS、每秒入队及处理速率。若审批要求硬性开放环 RPS 上限或逐秒 HTTP 到达证明，需先补负载器或入口采集。

## 批准后的本地环境准备

使用独占的本地 Linux Docker 引擎与独立候选 checkout。确认 Docker context 的端点属于本机、无共享工作负载，准备已缓存的 PostgreSQL 16 和候选镜像构建依赖。记录镜像/工具版本、CPU/内存/磁盘和 Docker 资源限制。使用下面的独立 Compose 配置，确保出口隔离、零发布端口、零外部挂载凭据。负载容器与后端共享网络命名空间并单独计量 CPU 和内存。镜像构建可在批准的本地准备期完成，运行期保持隔离。

在候选 checkout 根目录的专用 Bash 会话中执行。`TEST_CONTEXT` 必须预先设为审核通过的本地 Docker context。以下生成的密码和签名仅用于本次本地实例。

```bash
test "$(git rev-parse HEAD)" = a05251897d7fc11d96114606bcaa1807dd96af55 || exit 1
umask 077
export RUN_DIR="$(mktemp -d)"
export RUN_ID="issue152-$(date -u +%Y%m%d%H%M%S)"
export CAPACITY_DB_PASSWORD="$(openssl rand -hex 24)"
export CAPACITY_JWT_SECRET="$(openssl rand -hex 32)"
export CAPACITY_DB_NAME=capacity152
export BURST_MOCK_RESULT=success
openssl rand -hex 24 > "$RUN_DIR/capacity-password"
C=(docker --context "${TEST_CONTEXT:?choose the approved local context}" compose
   --project-directory "$PWD" --env-file /dev/null -f "$RUN_DIR/compose.yaml" -p "$RUN_ID")
```

将以下配置保存为 `$RUN_DIR/compose.yaml`。启动前用 `"${C[@]}" config --quiet` 检查，使用 `config --no-interpolate` 核对拓扑，避免输出展开后的凭据。确认项目名和 volume 全新。[仓库 Compose](../../docker-compose.yml) 有固定容器名和端口映射，隔离运行使用下列配置。

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: capacity152
      POSTGRES_DB: capacity152
      POSTGRES_PASSWORD: ${CAPACITY_DB_PASSWORD:?required}
    volumes:
      - db:/var/lib/postgresql/data
    healthcheck:
      test: [CMD, pg_isready, -U, capacity152, -d, capacity152]
      interval: 2s
      timeout: 2s
      retries: 20
  backend:
    build: ./backend
    image: poolduck-issue152:${RUN_ID:?required}
    environment:
      APP_ENV: local
      APP_PORT: '3001'
      API_BASE_URL: http://127.0.0.1:3001
      DATABASE_URL: postgresql://capacity152:${CAPACITY_DB_PASSWORD:?required}@postgres:5432/${CAPACITY_DB_NAME:?required}
      JWT_SECRET: ${CAPACITY_JWT_SECRET:?required}
      TENANT_CONTEXT_ENFORCED: 'true'
      MAIL_PROVIDER: mock
      REAL_MAIL_SEND_ENABLED: 'false'
      MAIL_JOB_PROCESSOR_ENABLED: 'true'
      MAIL_MOCK_SEND_RESULT: ${BURST_MOCK_RESULT:-success}
      OCI_MAIL_APP_ALERTS_ENABLED: 'false'
      RECORD_RETENTION_PROCESSOR_ENABLED: 'false'
      CAPACITY_TEST_PASSWORD_FILE: /run/secrets/capacity_password
    secrets: [capacity_password]
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 24
  loadgen:
    image: poolduck-issue152:${RUN_ID:?required}
    pull_policy: never
    network_mode: service:backend
    command: [sleep, infinity]
    secrets: [capacity_password]
volumes:
  db:
secrets:
  capacity_password:
    file: ${RUN_DIR:?required}/capacity-password
networks:
  default:
    internal: true
```

1. 运行 `"${C[@]}" up -d --build --wait backend`，再运行 `"${C[@]}" up -d loadgen`。检查运行容器的非敏感环境键、网络归属、无端口发布与健康状态。确认后端只连接本项目的 `postgres`。样本来自 [容量 seed](../../backend/scripts/staging-capacity-seed.mjs) 与 [本地 seed](../../backend/scripts/local-seed.mjs)。

   ```bash
   "${C[@]}" exec -T -e CAPACITY_OPERATOR_COUNT=50 -e CAPACITY_PERSON_COUNT=4096 backend npm run capacity:seed
   "${C[@]}" exec -T backend npm run local:seed
   "${C[@]}" exec -T postgres pg_dump -U capacity152 -Fc capacity152 > "$RUN_DIR/preload.dump"
   "${C[@]}" exec -T postgres pg_restore -l < "$RUN_DIR/preload.dump" > /dev/null
   "${C[@]}" exec -T postgres createdb -U capacity152 capacity152_restore
   "${C[@]}" exec -T postgres pg_restore -U capacity152 --exit-on-error -d capacity152_restore < "$RUN_DIR/preload.dump"
   ```

2. 每条命令须成功。对照主库与恢复库的 tenant、location、person、scan event、mail job 行数和迁移版本。保留 dump 与已验证的恢复库直至回归结束。测试前核对容量样本为 active 50 operators、4,096 persons、1 location；suspended 1 operator、100 persons、1 location。核对邮箱均属于 `example.local`，记录计数。额外的 local seed 含第二个可发信 tenant、独立地点和收件人、未分配给其 operator 的地点，以及 suspended 探针账号。基准期内只允许本计划操作，涉及同一个人时保留至少 10.5 秒冷却。生成的 `E`/`X` 动作符合 ADR-022，负载器逐池切换动作；低负载单档可能只覆盖 `E`，另用探针覆盖 `X`。
3. 先完成下文的第二会话无 HTTP 核验。随后执行 `"${C[@]}" exec -T backend npm run smoke:api`，确认登录、历史、取消后无 attempt、重扫后 `sent`，并记录空队列起点。用两个 active tenant 的不同 operator session 分别向各自授权地点发请求，交叉提交对方地点和未分配地点（均为 `404 LOCATION_NOT_FOUND`），无 session 预期 401。同一授权地点提交其他 tenant 的合法人员码，预期 `404 SCAN_CODE_NOT_MAPPED`。混合档的 suspended 请求预期 `403 SUBSCRIPTION_NOT_SENDABLE`。可用 [API 契约](../api.md) 及 [现有 smoke 请求](../../backend/scripts/api-smoke-test.mjs) 编写该子窗口的命令，只记录断言计数。当前 `person_code` 全局唯一，使用独立映射、目标互换和错误地点测试隔离。

## 第二会话监控与停机核验

在同一台本机打开独立 Bash 会话。操作者只提供 `TEST_CONTEXT` 和 `RUN_ID` 两个值。值守人用自己的本地 Docker 权限执行以下命令。容器 ID 在每次操作前按项目和服务标签重新查询，候选同时包含运行中和已停止的容器。找不到或多于一个便停止核验并通知操作者。

```bash
# 在第二会话将两个占位符替换为本次值
TEST_CONTEXT='<已批准的本地 Docker context>'
RUN_ID='<本次 issue152-YYYYMMDDhhmmss>'
endpoint=$(docker context inspect "$TEST_CONTEXT" --format '{{.Endpoints.docker.Host}}') || exit 1
[[ "$endpoint" == unix:///* && "$RUN_ID" =~ ^issue152-[0-9]{14}$ ]] || exit 1
D=(docker --context "$TEST_CONTEXT")

container_id() {
  local service="$1" id
  case "$service" in postgres|backend|loadgen) ;; *) return 2 ;; esac
  id=$("${D[@]}" ps --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$RUN_ID" \
    --filter "label=com.docker.compose.service=$service") || return 1
  if [[ ! "$id" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'Expected one container for %s/%s\n' "$RUN_ID" "$service" >&2
    return 1
  fi
  printf '%s\n' "$id"
}

project_stats() {
  local postgres_id backend_id loadgen_id
  postgres_id=$(container_id postgres) && backend_id=$(container_id backend) &&
    loadgen_id=$(container_id loadgen) || return 1
  "${D[@]}" stats --no-stream "$postgres_id" "$backend_id" "$loadgen_id"
}

project_stop() {
  local service="$1" id
  case "$service" in backend|loadgen) ;; *) return 2 ;; esac
  id=$(container_id "$service") || return 1
  "${D[@]}" stop -t 1 "$id"
}

start_queue_watch() {
  local id
  id=$(container_id postgres) || return 1
  "${D[@]}" exec -it "$id" psql -X -U capacity152 -d capacity152
}
```

第一笔手动 HTTP 请求之前完成以下核验。此时 loadgen 容器只运行 `sleep`，回归、预登录和负载器尚未启动。

1. 执行 `project_stats`，确认三个容器均能采样。单独执行 `start_queue_watch`，运行下文查询至少两次并确认空队列及采样时间递增，使用 `Ctrl+C` 结束采样，再输入 `\q` 退出。
2. 记录 `container_id loadgen`，执行 `project_stop loadgen`。重新查询 ID，并执行 `id=$(container_id loadgen) && "${D[@]}" inspect --format '{{.State.Status}}' "$id"`，预期 `exited`。保持 PostgreSQL 和 backend 运行。
3. 操作者在准备会话用 `"${C[@]}" up -d --no-deps --force-recreate loadgen` 重建。值守人复查 `container_id loadgen` 与 `project_stats`，确认新 ID 唯一、可采样，且旧 ID 已退出项目。本轮后端在 failure 阶段计划重建，每次恢复后重新运行 `project_stats` 获取当前容器。若任何核验失败，保持 loadgen 停止，查明原因后重做核验再进入 smoke。

## 单档执行与停止

开启独立监控会话后逐次调用下面的函数。`capacity:plan` 先检查同一组参数。`capacity:run` 直接启动负载，操作者须停在人工确认点等监控负责人发出放行信号。示例分别对应 steady、burst、mixed 和通用 failure 档。每次只运行当前档，切换场景前完成采样和排空。

```bash
run_step() {
  local scenario="$1" concurrency="$2" seconds="$3" action="$4"
  "${C[@]}" exec -T \
    -e APP_ENV=local -e CAPACITY_BASE_URL=http://127.0.0.1:3001 \
    -e CAPACITY_TEST_PASSWORD_FILE=/run/secrets/capacity_password \
    -e CAPACITY_SCENARIO="$scenario" -e CAPACITY_STEPS="$concurrency" \
    -e CAPACITY_STEP_SECONDS="$seconds" -e CAPACITY_REQUEST_TIMEOUT_MS=5000 \
    -e CAPACITY_MAX_UNEXPECTED_RATE=0.05 -e CAPACITY_P95_LIMIT_MS=2000 \
    -e CAPACITY_PERSON_COUNT=4096 -e CAPACITY_PERSON_REUSE_MS=10500 \
    loadgen timeout --kill-after=5s "$((seconds + 90))s" npm run "capacity:$action"
}

# 审批后预览，记录参数，等待放行信号
run_step burst 10 30 plan
# 放行后一次只执行表中的一个档位，再检查报告和排空
run_step burst 10 30 run
```

steady/mixed 使用默认 1,000 ms，burst 使用默认 0 ms。切换 failure 前停止 loadgen，并确认无在途请求和 backlog。设置 `export BURST_MOCK_RESULT=failure` 后运行 `"${C[@]}" up -d --wait --no-deps --force-recreate backend`，随后用 `"${C[@]}" up -d --no-deps --force-recreate loadgen` 重新接入后端命名空间。核对实际配置，再执行 `run_step steady 1 5 plan` / `run_step steady 1 5 run`。观察 `queued`、`PROVIDER_FAILURE` 和首次约 30 秒的退避。停止 loadgen，设置 `export BURST_MOCK_RESULT=success`，重跑两条重建命令并核对配置。记录恢复前后各次 attempt、终态与恢复秒数。现有退避间隔为 30/120/600 秒，恢复到 `success` 仍遵循已排定的重试时间。

| 门槛 | 操作 |
|---|---|
| 任何越权访问、收件快照错误、重复 job、提前 claim/调用、已取消 job 的 attempt、配置或样本偏离、非计划重启/OOM | 立即停止全部负载，保留脱敏证据，禁止升档 |
| 最近 20–50 个请求的 timeout/5xx/网络失败 ≥5% | 负载器自动停止当前档；操作者同时阻止下一档。即使进程退出码为 0，也要求 `stopped_early=false` 且 `slo_pass=true` |
| 档位意外响应 ≥5%、API p95 >2 秒、无有效样本或报告不完整 | 停止升档，核对错误分类与服务状态。预期的 mixed 404/403 单列 |
| 任一采样 backlog ≥2,500、最老已到期 job 等待 >120 秒、5 秒内新 job >500，或最后一个请求结束后 180 秒未排空 | 停止负载并进入恢复。baseline/mixed 要求 claim p95 ≤2 秒、p99 ≤5 秒，且无持续增长积压；burst 单列延迟和清空秒数，按峰值及恢复上限判断 |
| DB lock waiter 或未授予锁连续两次采样非零，连接达到 `max_connections` 的 80%，主机可用内存 <1 GiB、运行盘 ≥80%，或主机/负载器 CPU ≥90% 持续 30 秒 | 停止负载并检查饱和位置；采样中断亦停止升档 |

紧急停止在第二会话执行 `project_stop loadgen`，确认在途 HTTP 结束。健康的 worker 可继续处理合成积压。若发现隔离或安全断言失败，另执行 `project_stop backend` 并保留数据库，复核后才能恢复。若第二会话无法唯一定位，立即通知操作者在准备会话使用本项目 Compose 执行停机。故障窗口的预期 `queued` 单独计时，180 秒恢复要求从最后一次计划重试成为 due 起算；窗口截止仍未清空则记失败。

需要回退数据时，停止 loadgen 与 backend，保留原库供脱敏诊断。核对已还原的 `capacity152_restore` 仍符合备份行数，设置 `CAPACITY_DB_NAME=capacity152_restore`（导出给 Compose）和 `BURST_MOCK_RESULT=success`，用相同候选重建 backend，在恢复库运行 health 和低负载 smoke。回退后停止本轮升档；恢复库 smoke 记在恢复栏，原窗口的结果仍按原库证据判定。禁止重排或改写 job/attempt，并保持 `delivery_unknown` 的人工处置规则。正常回归或故障处置结束后执行 `"${C[@]}" down`。操作者核对本次项目/卷标识后再撤销本次卷，仅保留脱敏汇总并按 Local 保留期处理临时数据和密码。

## 指标、对账与验收边界

在第二会话执行 `start_queue_watch`，粘贴以下只读查询。每秒刷新，`new_jobs_5s` 为滚动窗口，`backlog` 与 `oldest_due_seconds` 用于判停。该专用库内只有测试流量，只读结果仅含时间和聚合计数。监控窗口运行中可以按 `Ctrl+C` 结束采样，输入 `\q` 后执行停机。也可用相同的两个值在另一个 Bash 中提前备好停机命令。

```sql
WITH sample AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS utc_now),
jobs AS (
  SELECT created_at, status,
    CASE
      WHEN status = 'waiting' THEN send_not_before
      WHEN status = 'queued' THEN COALESCE(scheduled_at,
        CASE WHEN send_not_before IS NULL THEN created_at END)
    END AS due_at
  FROM mail_jobs
)
SELECT utc_now,
  (SELECT count(*) FROM jobs WHERE created_at >= utc_now - interval '5 seconds') AS new_jobs_5s,
  (SELECT count(*) FROM jobs WHERE status IN ('waiting', 'queued', 'processing')) AS backlog,
  (SELECT coalesce(extract(epoch FROM utc_now - min(due_at)), 0)
    FROM jobs WHERE due_at <= utc_now) AS oldest_due_seconds,
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend') AS connections,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS lock_waiters,
  (SELECT count(*) FROM pg_locks WHERE NOT granted) AS ungranted_locks
FROM sample;
\watch 1
```

- 每 5 秒记录 UTC、容器 CPU/内存/IO、宿主 CPU/可用内存/磁盘、PostgreSQL 活跃连接与等待（`pg_stat_activity` 按 `wait_event_type` 聚合，`pg_locks` 统计未授予，不导出 SQL 文本），阶段前后核对 restart/OOM。容器使用 `project_stats` 采集当前项目，可参考 [#116 采样脚本](../../deploy/staging/capacity-monitor.sh) 的 Linux 宿主指标。它读取默认 Docker context 的所有容器。负载启动前至排空后持续采样。
- 记录每档 HTTP 请求数、完成 RPS、预期/意外比例、P50/P95/P99、状态和超时/断线/5xx。用同一连接按 DB 时间读取 `mail_jobs`：每 5 秒统计新建数、`waiting/queued/processing` 总数与最老已到期年龄；按 `mail_delivery_attempts.completed_at/status/error_code` 聚合完成和失败分类；记录从最后一次请求结束至首次 backlog 为 0 的耗时。建议队列安全采样 1 秒，资源趋势采样 5 秒。结果注明队列峰值为观测峰值，等待时间从 `send_not_before` 或本次重试 `scheduled_at` 到领取计算。用 [容量报告脚本](../../backend/scripts/capacity-db-report.mjs) 在 `backend` 容器内设置 `CAPACITY_RUN_STARTED_AT` 和 `CAPACITY_RUN_FINISHED_AT` 运行 `npm run capacity:report`，分别在停止和排空后读同一阶段、每个涉及的 tenant。报告 `mail_jobs_per_second` 是创建率。脚本给出查询时积压、最终 `claimed_at` 与初始 `send_not_before` 的差值和瞬时 DB 等待；重试后的单次等待应从 attempt 时序另查。
- 对账使用隔离的子窗口，在放行前与排空后一致地取 DB 快照，用 `scan_events`、`mail_jobs` 和 `mail_delivery_attempts` 的计数差，加 DB 时钟记录阶段边界。对每个新 event 断言恰有一个 job，核对 event、job、person、location 与 attempt 的 tenant/location 归属，以及不可变 `to_email` 是否等于对应合成映射（阶段中禁止修改映射）。对所有 attempt 核查 `provider_invoked_at >= send_not_before`，已取消 job 必须零 attempt。检查新 job 总数等于各终态数与 backlog 之和。对定向探针在内存中核对响应 ID、`deduplicated` 与 job 归属，只输出计数。任何缺行或多行需解释到具体原因，阶段聚合相等仍需核对逐请求结果。
- 批准后在采样窗口外执行 `"${C[@]}" exec -T backend node scripts/adr017-release-validation.mjs`。镜像已有编译产物，[ADR-017 验证脚本](../../backend/scripts/adr017-release-validation.mjs) 会连接项目 PostgreSQL 并创建自己的临时库来验证截止边界、争抢、订阅状态矩阵和 stale claim 恢复。另在低负载扫描同一合成人员，在 10 秒内同动作换 key 应返回同一 event/job，换动作应为 `409 SCAN_ACTION_CONFLICT`，跨过边界用新 key 应建新 job；相同 key / 相同请求重放须保持原 ID。截止前取消必须成功且零 attempt，截止后应拒绝取消。数据库脚本模拟尚未调用的 stale claim 恢复和已调用未确认的 `delivery_unknown`，后者无自动重发。failure 子窗口重建后端以验证进程重启后的 `queued` 恢复。

| 验收 | 候选现有证据与剩余缺口 |
|---|---|
| 逐项 fake 429、timeout、5xx | [OCI fake 契约](../../backend/test/oci-mail-contract.spec.ts) 与 [队列重试测试](../../backend/test/mail-job-retry.spec.ts) 已在当前候选离线通过。运行中 [mock provider](../../backend/src/mail-jobs/sandbox-mail.provider.ts) 只支持统一成功/失败。逐项错误与 burst/队列同跑须补本地测试注入，再由人工复核 |
| Burst 逐请求、排队和收件人对账 | [负载器](../../backend/scripts/capacity-load-test.mjs) 只汇总 `kind:HTTP status`，把 `valid:201` 都计为预期，未记录 deduplicated、event/job ID 或已提交但客户端超时的请求。数据库报告只查单 tenant 的半开 UTC 时间窗及即时聚合。上面的快照及探针可验证队列与关系一致性，无法证明 burst 每个响应都对应唯一 job；完整验收须补仅在内存关联请求、响应和入队的测试记录，以及实时多 tenant 定向探针；对外保留聚合计数 |

### 逐请求内存对账

最小补充是为每个逻辑请求在内存保留预期 tenant/location、幂等键哈希、去重标记和响应中的 event/job ID。对 timeout 或 5xx 等无可用回执的请求，在清理前按 tenant、扫码路由及幂等键哈希查询 `scan_request_idempotency`，核实是否已入队。已去重的请求也要核对原 event/job，计数时只计一次创建。数据库侧按 event/job ID 核对 tenant/location、收件快照和 attempt。报告只保留计数，找不到可关联证据的请求记为缺证据。现有容量报告的时间窗和 `valid:201` 总数无法区分下列等量情况。

复制以下 JS 到临时文件并运行 `node <临时文件>.mjs`。样本固定为两个新扫码和一个重复响应。报告示例在内存核对新建响应对应的 job，仅输出断言结果。

```js
import assert from 'node:assert/strict';

const north = { tenant: 'a', location: 'north', eventId: 'event-1', jobId: 'job-1' };
const south = { tenant: 'a', location: 'south', eventId: 'event-2', jobId: 'job-2' };
const responses = [north, south, { ...north, deduplicated: true }];

function report(responses, jobs) {
  const created = responses.filter((response) => !response.deduplicated);
  const counts = { created: created.length, missing: 0, duplicate: 0, wrongJob: 0, wrongContext: 0 };
  for (const response of created) {
    const matches = jobs.filter((job) => job.eventId === response.eventId);
    if (matches.length === 0) counts.missing += 1;
    if (matches.length > 1) counts.duplicate += 1;
    if (matches.length > 0 && !matches.some((job) => job.jobId === response.jobId)) counts.wrongJob += 1;
    if (matches.some((job) => job.tenant !== response.tenant || job.location !== response.location)) {
      counts.wrongContext += 1;
    }
  }
  return counts;
}

const clean = { created: 2, missing: 0, duplicate: 0, wrongJob: 0, wrongContext: 0 };
assert.deepEqual(report(responses, [north, south]), clean);
assert.deepEqual(report(responses, [north, { ...north, jobId: 'extra' }]),
  { ...clean, missing: 1, duplicate: 1 });
assert.deepEqual(report(responses, [{ ...north, location: south.location }, { ...south, location: north.location }]),
  { ...clean, wrongContext: 2 });
assert.deepEqual(report(responses, [north, { ...south, jobId: 'other' }]), { ...clean, wrongJob: 1 });
assert.deepEqual(report(responses, [north, { ...south, tenant: 'b' }]), { ...clean, wrongContext: 1 });
console.log('reconciliation fixtures: 5/5');
```

记录 `通过 / 失败 / 缺证据 / 未执行`，缺证据项保留在 #152。结果按阶段填入 [#116 结果模板](staging-capacity-result-template.md) 的对应指标，附审批引用、实际 SHA/窗口、场景参数、每项对账计数、停止与低负载回归结果。导出前删除配置中的动作码和标识，禁止附原始响应、凭据、邮箱、正文、姓名、内部 ID 或请求明细。记录未执行档位和测量开销。建议根据证据定位下一步，若 HTTP p95 平稳而队列增长，优先检查 worker 领取速率；若 API 与 DB 等待共同上升，先分解 SQL 和 DB 资源消耗。

## 与 #116 对比

[历史结果](staging-capacity-result-2026-09-24.md) 使用 `734a42294691bc28a1033c117a62b142a1d9fac6`，OCI A1 单机 2 OCPU/12 GB/100 GB，公网 TLS/Caddy，mock success。steady 20 并发 × 300 秒获得 19.211 RPS、API p95 50 ms、claim p95 964 ms、档位报告积压 0；40/50 并发队列 SLO 失败。burst 20 并发为 91.277 RPS，50 并发为 93.220 RPS，整段即时报告有 12,182 waiting，约 10 分钟排空。历史 burst 的 HTTP 与 job 窗口相差 5 条，历史 provider-failure 未执行。对齐 API 与队列口径逐档比较 10/20 并发与 30 秒 burst，同时附候选、硬件、本地直连与公网路径、稳态时长和样本差异。本计划的工作量用于观察本机短时恢复，无法认证最大持续容量或 OCI TPS、配额、计费及真实投递结果。

## 审批前验证记录

- 在 `backend/` 运行 `npm.cmd run capacity:test`，4/4 通过。覆盖参数阶梯、百分位、动作码轮换与目标/并发配置边界。
- `npm.cmd run capacity:plan` 使用 `127.0.0.1:3001`。steady 5/10/20 × 120 秒、burst 10/20 × 30 秒、mixed 10 × 60 秒，以及 steady 1 × 30 秒和 1 × 5 秒均返回 `planOnly: true`。本地服务、备份恢复和负载结果待后续核实。
- `docker compose config` 离线解析通过，确认内部网络、无发布端口、loadgen 共享 backend 网络命名空间，以及 Local mock / false 配置。
- 第二会话 Bash 示例使用内存 fake Docker CLI 离线验证，覆盖按标签唯一定位、采样与只读 SQL 入口、仅停止 backend/loadgen、拒绝零匹配/多匹配/查询失败及重建后的 ID 刷新。实际容器核验仍须在批准窗口内、任何手动 HTTP 前完成。
- 在 `backend/` 直接使用已有依赖运行 `node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath test/oci-mail-contract.spec.ts test/mail-job-retry.spec.ts`，两套 38/38 通过。实际运行使用临时 Node 预加载器阻断 socket、HTTP 和 fetch。契约测试断言 fake 429 单次提交返回 `queued / OCI_QUOTA_REJECTED`。另以 fake claim 验证 `retry_count=1` 后可用不同 attempt 再提交，两次 SDK retry 均关闭。重试策略用冻结时钟和预置次数验证 30/120/600 秒退避及第四次失败后终止。Fake timeout（408）和 server error（500）各仅调用一次，进入 `delivery_unknown / PROVIDER_OUTCOME_UNKNOWN`，再处理返回 409 且仍为一次调用。重试策略单独断言 unknown 的 `retry_count=0` 且无调度。双 worker 争抢用例只创建一个 attempt、只调用一次 provider。
- 上述内存报告示例 5/5 通过。等量样本可识别漏建与重复同时出现、地点互换、错误 job 关联和跨 tenant。验证只使用固定记录，尚缺实际负载器的逐请求采集和持续队列中的逐项故障注入。
