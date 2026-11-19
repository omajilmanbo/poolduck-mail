# M03 · 扫码邮件重试耗尽的本机候选实测

**通过。** 2026-11-20（日本时间），用固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55` 的工作台正常提交一笔合成扫码。worker 在真实时钟下调用 sandbox provider 四次（首次尝试及三次重试），从接收扫码到最后一次失败用时 760.778 秒。刷新工作台后，同一条扫码记录显示“发送失败”与允许公开的错误文本。

## 四次调用的时间线

下表为 2026-11-19 UTC，精确到毫秒。扫码接收时间为 16:16:18.342。`cancel_until` 和 `send_not_before` 均为 16:16:28.342，首次等待窗口为 10 秒。“到期后认领”以首次发送下限或上一次失败审计写入的 `scheduled_at` 为基准。

| 尝试 | worker 认领 | provider 调用 | 尝试完成 | 下次到期 | 到期后认领（ms） | 尝试结果 |
|---|---|---|---|---|---:|---|
| 首次尝试 | 16:16:28.411 | 16:16:28.416 | 16:16:28.418 | 16:16:58.418 | 69 | `retry_scheduled` |
| 第 1 次重试 | 16:16:58.437 | 16:16:58.441 | 16:16:58.442 | 16:18:58.442 | 19 | `retry_scheduled` |
| 第 2 次重试 | 16:18:58.549 | 16:18:58.552 | 16:18:58.554 | 16:28:58.554 | 107 | `retry_scheduled` |
| 第 3 次重试 | 16:28:59.115 | 16:28:59.118 | 16:28:59.120 | — | 561 | `failed` |

前三次失败所记录的“完成至下次到期”分别为 30.000、120.000、600.000 秒。实际从上一次完成到下一次认领分别为 30.019、120.107、600.561 秒。距第三次重试到期约 222 秒时，独立查询仍为 1 笔 `queued` 任务、3 笔尝试。四次认领均在各自到期时间之后。任务进入 `queued` 期间仍保留首次等待窗口的时间戳。

同一个租户、同一笔任务的 4 条投递尝试逐条关联到各自的审计。前三条审计为 `mail.retry.scheduled`，最后一条为 `mail.retry.exhausted`。四条均记录 `provider=sandbox`、`result=failure`、`reason=PROVIDER_FAILURE`，与各次尝试的 `error_code` 一致。候选在每次失败后递增 `retry_count`，因此终值为 4，实际重试次数为 3。[失败计数与排期实现](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/backend/src/mail-jobs/mail-jobs.service.ts#L398-L441)

## 数据库与操作员看到的结果

| 检查点 | 本次观测 |
|---|---|
| 环境与起点 | 从候选 Git archive 构建前后端，在独立 Compose 项目和全新 PG16 卷启动。后端实际配置为 `APP_ENV=local`、`MAIL_PROVIDER=mock`、`MAIL_MOCK_SEND_RESULT=failure`、`REAL_MAIL_SEND_ENABLED=false`，默认 worker 启用。前后端仅绑定 loopback，数据库仅在项目网络内。local seed 后扫码、任务、尝试数量均为 0。 |
| 扫码提交 | 无头 Chrome 登录 active operator，选择已分配地点，通过工作台提交一次已映射的入场码。浏览器记录 1 次扫码 POST，响应为 `201/waiting`。历史只有 1 行，先显示“可取消等待中”，随后显示“发送中”。 |
| 耗尽 | 1 条扫码、1 笔任务。任务为 `failed`，`retry_count=4`，`scheduled_at`、`sent_at`、`provider_message_id` 均为 NULL。4 笔尝试均有 provider 调用时间和完成时间。 |
| 页面刷新 | 数据库达到终态时，原页面仍显示“发送中”。普通刷新用该 operator 的现有会话请求历史，HTTP 200。唯一记录的扫码 ID、任务 ID 都与首次响应一致。`mail_status` 和 `mail_job.status` 均为 `failed`，`sent_at=null`，`can_cancel=false`。同一行显示“发送失败”及精确文本 `Sandbox provider simulated failure`，无取消按钮。 |
| 终态后继续运行 | 在最后一次尝试完成后、重启前，连续 12 次抽查，最晚在 +65.639 秒。再仅重启 backend，健康端点返回 200，核实 worker 仍启用，再等待 7 秒。最后在 +79.615 秒复查。扫码、任务、尝试、重试审计的行标识与任务和尝试时间戳均保持相同，provider 调用数仍为 4。 |

用户指南说明非终态只作有限轮询。候选每 2 秒读取一次当前页，最多 10 轮。长退避超出这一窗口后，操作员普通刷新可查看终态。这是当前工作台的使用条件。[用户指南](../user-guide.md) · [工作台验收要求 #67](https://github.com/omajilmanbo/poolduck-mail/issues/67)

邮件错误字段由候选的安全过滤器返回，精确允许此 sandbox 文本。本报告补充 [业务矩阵 M03](business-requirements-matrix.md#M03) 的本机 mock 证据。真实 OCI 投递与正式环境验收另有范围。[前端轮询](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/frontend/app/page.tsx#L18-L22) · [历史错误过滤](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/backend/src/scan-events/scan-events.service.ts#L1081-L1088) · [worker 到期条件](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/backend/src/mail-jobs/mail-job-processor.service.ts#L69-L98)

## 复现同一条链路

1. 用本机 Docker 的独立项目、空 PostgreSQL 16 卷和两个空闲的 loopback 端口，从候选 `a05251897d7fc11d96114606bcaa1807dd96af55` 的 Git archive 构建前后端。可直接采用[隔离演练的 Bash 启动命令](https://github.com/omajilmanbo/poolduck-mail/blob/42af8aa217ff12105b60c37029d844c9f326e007/docs/testing/first-deployment-rehearsal-2026-11-19.md#在另一个全新本地项目复现)。在首次启动前把参数文件的 `MAIL_MOCK_SEND_RESULT=success` 改为 `failure`。运行到 `npm run local:seed` 即可。下面沿用该命令块定义的 `dc`、`lab`、`d`，以及合成数据库用户名和库名 `drill`。
2. 在运行容器中验证开关，检查空样本。下列代码块预期输出为 `0|0|0`。保持 worker 启用和数据库时钟正常。

```bash
dc exec -T backend node -e '
  const e = process.env, db = new URL(e.DATABASE_URL)
  if (e.APP_ENV !== "local" || e.MAIL_PROVIDER !== "mock" ||
      e.REAL_MAIL_SEND_ENABLED !== "false" || e.MAIL_MOCK_SEND_RESULT !== "failure" ||
      e.NODE_ENV === "test" || e.MAIL_JOB_PROCESSOR_ENABLED === "false" ||
      db.hostname !== "postgres" || db.pathname !== "/drill") process.exit(1)'
q() { dc exec -T postgres psql -X -v ON_ERROR_STOP=1 -U drill -d drill "$@"; }
q -Atc 'select (select count(*) from scan_events), (select count(*) from mail_jobs),
               (select count(*) from mail_delivery_attempts)'
```

3. 在浏览器打开 `http://127.0.0.1:41870`。使用候选的合成 active operator 登录，选择其已分配地点，输入已映射的入场码并点击一次“提交扫码”。可从[本机 seed](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/backend/scripts/local-seed.mjs) 取登录与地点，从[工作台 E2E 的有效扫码步骤](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/frontend/e2e/mvp-workspace.spec.ts#L41-L51) 取入场码。检查唯一一次 `POST /api/scan-events` 返回 `201/waiting`，历史中的一行由“可取消等待中”变为“发送中”。保留这张页面和首次响应，以便最终比对两项 ID。
4. 让 worker 自行完成。预计从扫码到耗尽约 12 分 40 秒，另有轮询延迟。可在同一 shell 随时重复下面的只读查询。前三次失败均有独立的下一次到期时间，末次到期时间为空。记录每次认领、provider 调用、完成与对应审计，核对 `scheduled_wait_ms` 约为 30000、120000、600000，四个 `claim_lag_ms` 均大于等于 0。

```bash
q <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT j.status, j.retry_count, j.scheduled_at, j.updated_at, s.received_at,
       j.send_not_before, j.cancel_until, j.sent_at,
       j.provider_message_id IS NULL AS no_provider_message,
       (j.error_message = 'Sandbox provider simulated failure') AS safe_error,
       round(extract(epoch FROM j.send_not_before - s.received_at) * 1000)::int AS initial_wait_ms,
       (SELECT count(*) FROM scan_events) AS scans,
       (SELECT count(*) FROM mail_jobs) AS jobs,
       (SELECT count(*) FROM mail_delivery_attempts) AS attempts,
       (SELECT count(provider_invoked_at) FROM mail_delivery_attempts) AS invoked,
       (SELECT count(*) FROM audit_logs WHERE action = 'mail.retry.scheduled') AS scheduled,
       (SELECT count(*) FROM audit_logs WHERE action = 'mail.retry.exhausted') AS exhausted
FROM mail_jobs j JOIN scan_events s ON s.id=j.scan_event_id AND s.tenant_id=j.tenant_id;

WITH attempts AS (
  SELECT a.id, a.claimed_at, a.provider_invoked_at, a.completed_at,
         a.status AS attempt_status, a.error_code, j.send_not_before,
         l.action, l.result, l.metadata_json->>'provider' AS provider,
         l.metadata_json->>'reason' AS reason,
         (l.metadata_json->>'retry_count')::int AS retry_count,
         (l.metadata_json->>'scheduled_at')::timestamptz AT TIME ZONE 'UTC' AS next_due
  FROM mail_delivery_attempts a
  JOIN mail_jobs j ON j.id = a.mail_job_id AND j.tenant_id = a.tenant_id
  JOIN audit_logs l ON l.resource_id = j.id::text AND l.tenant_id = j.tenant_id
    AND l.resource_type = 'mail_job' AND l.metadata_json->>'attempt_id' = a.id::text
    AND l.action IN ('mail.retry.scheduled', 'mail.retry.exhausted')
), timing AS (
  SELECT *, row_number() OVER w AS n, lag(next_due) OVER w AS prior_due,
         lag(completed_at) OVER w AS prior_completion
  FROM attempts WINDOW w AS (ORDER BY claimed_at, id)
)
SELECT n, claimed_at, provider_invoked_at, completed_at, next_due, attempt_status,
       retry_count, action, result, provider, reason, error_code,
       round(extract(epoch FROM next_due - completed_at) * 1000)::int AS scheduled_wait_ms,
       round(extract(epoch FROM claimed_at - coalesce(prior_due, send_not_before)) * 1000)::int AS claim_lag_ms,
       round(extract(epoch FROM claimed_at - prior_completion) * 1000)::int AS actual_wait_ms
FROM timing ORDER BY n;
COMMIT;
SQL
```

5. 数据库出现 `failed` 后，先读当前页的状态，再普通刷新。浏览器网络面板中，当前地点的 `GET /api/scan-events` 应为 200，列表长度为 1。比较返回的 `scan_event_id`、`mail_job.mail_job_id` 与首次响应。检查同一行显示“发送失败”和精确的安全提示 `Sandbox provider simulated failure`，且无取消按钮。
6. 记录终态的查询结果，保持 worker 运行至少 65 秒后复查。如需复验重启，再运行下列命令，随后重跑第 4 步查询。两次查询应仍为 4 笔尝试、4 次 provider 调用、3 笔排期审计、1 笔耗尽审计，最后一次尝试的完成时间及任务更新时间相同。

```bash
dc restart backend
dc up -d --no-build --pull never --wait backend
sleep 7
```

核对本次专用项目标签后，用同一 shell 的 `dc down --volumes` 回收该项目，用 `d image rm "$lab-api:candidate" "$lab-web:candidate"` 删除该项目的两个本机镜像标签。移除本次临时目录中的参数和凭据。
