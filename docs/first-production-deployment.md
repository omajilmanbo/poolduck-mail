# 首次生产部署操作手册

**发布判断（2026-11-19）为暂不可部署。** 候选 `a05251897d7fc11d96114606bcaa1807dd96af55` 已通过本机 Docker 演练。现行环境规范禁止 Production 使用 mock，候选中唯一的真实 provider 只在 Staging 可选。两条路径在 Production 均无法满足上线要求。当前停止点在生产变更之前。[环境规范](environments.md) · [候选的 provider 判定](../backend/src/mail-jobs/mail-provider.config.ts) · [ADR-019](decisions/ADR-019-oci-email-delivery-provider.md) · [首次邮件准入 #180](https://github.com/omajilmanbo/poolduck-mail/issues/180)

## 开窗前由发布负责人填写

| 需交付的输入 | 缺失时的影响 | 解除条件和验证方法 |
|---|---|---|
| 首发邮件方案、停止发送与未知投递处置 | 无可用的合规生产通知路径 | #180 经人工决策，所需实现进入候选。用合成验收核对 provider 选择、停发、恢复和防重发，并取得正式发布授权。 |
| 客户扫码限流、聚合告警与值班响应 | 已认证用户的快速无效输入可能持续占用资源，拒绝率和降级行为尚无批准基线 | 安全与运维按 [ADR-018](decisions/ADR-018-unmapped-scan-rejection-and-observability.md) 和 [#126](https://github.com/omajilmanbo/poolduck-mail/issues/126) 批准维度、阈值、降级方式与通知责任人。使用合成输入核对限流及告警，确认拒绝不会创建任务，也不会泄露跨地点或跨租户映射。 |
| 平台控制台的 Production 访问范围与 MFA 强制时点 | 最高权限账号的暴露面和设备丢失恢复责任会随正式接入改变 | 产品与安全负责人按 [ADR-013](decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md) 和 [#114](https://github.com/omajilmanbo/poolduck-mail/issues/114) 在正式接入或扩大范围前评审，记录可访问对象、恢复责任以及是否须先完成 TOTP。按评审结论验收相应控制后放行。 |
| 正式主机或平台、独立 PostgreSQL 16、域名、TLS、入口和网络边界 | 未知流量会进入哪个服务或数据库 | 按 ADR-005 的边界完成独立 Production 发布决策。留存批准的主机、DB 标识、配置清单和负责人。在目标核对 TLS、CORS、健康路由与数据库/应用端口的外部不可达性。 |
| Secrets 来源、最小权限、监控与值班联系人 | 登录、隔离、故障发现和停发无法验收 | 在正式 secrets store 登记引用；分别确认数据库、租户认证、平台认证、provider 和备份权限。对日志脱敏、登录与邮件失败率、队列积压/未知结果做无邮件告警演习，由值班人确认收到。详见[可观测性](observability.md)。 |
| 备份和故障恢复责任、恢复点、恢复时间、窗口与存储 | 恢复目标和可能损失的写入量未经确认 | 由 [#38](https://github.com/omajilmanbo/poolduck-mail/issues/38) 负责政策参数。按批准的政策把备份恢复到新实例，通过完整性核对，记录实际时长、可恢复时点和批准切换的人。 |
| 候选和回退镜像、演练环境、CI、审查、变更通知 | 既有 Staging 记录属于较早提交，正式入口的 TLS、网络与身份仍待验收 | 有获批 Staging 窗口时优先复验同一候选；本次独立本机演练已满足本轮演练形式。在发布窗口核对正式入口差异及[现行生产发布清单](deployment.md#6-production-部署)中的 Staging 验证项，登记候选 SHA、架构、镜像 digest、五项 CI、release notes、已审 PR、回退镜像和联系人，完成[发布检查](release.md)。 |

手册沿用仓库的 Dockerfile、Compose 与 Prisma。可在[本地演练记录](testing/first-deployment-rehearsal-2026-11-19.md)复现 mock 验证。下列生产步骤供准入完成、目标与变更窗口获批后使用。当前仓库只提供 Local 基础 Compose 和 Staging overlay，正式清单、DNS、TLS、数据库和凭据须来自批准的生产交付物。

## 1. 固定版本和配置

1. 在干净检出中核对 `git rev-parse HEAD`、`git status --porcelain`、候选 CI。两个 Dockerfile 均使用 Node 20 和各自的 `package-lock.json` 执行 `npm ci`。登记基础镜像 digest、目标架构和最终应用镜像 digest。候选镜像进入正式入口前应已构建并固定。
2. Backend 需要 `APP_ENV=production`、`APP_PORT`、`DATABASE_URL`、`TENANT_CONTEXT_ENFORCED=true`、`CORS_ORIGIN`、`JWT_SECRET`、`REFRESH_TOKEN_SECRET`、`AUTH_IDENTITY_HASH_SECRET`、`PLATFORM_JWT_SECRET`、`PLATFORM_REFRESH_TOKEN_SECRET`、`PLATFORM_PROVISIONING_SECRET`。逐项核对注入来源、环境归属和轮换责任，租户与平台使用各自的密钥。浏览器使用的 `NEXT_PUBLIC_API_BASE_URL` 在前端**构建时**写入产物，须与正式 HTTPS 入口匹配。邮件变量按获批方案检查。Staging 删除、到期清理等开关单独审核。
3. 给**完整的生产 Compose 配置**指定本次批准的 context、项目名、配置文件和 secrets 注入方式。仓库基础文件自行拼接 `@postgres:5432` 的连接，固定容器名并默认发布端口；仅在宿主机设置 `DATABASE_URL` 或仅更改项目名，均不足以切换目标。核对合并后实际数据库 host/库名、容器名、镜像 digest、卷、监听地址、依赖关系及 provider。配置中的密码和 token 只在进程内比较，记录匹配结果。禁用 shell 跟踪，避免完整打印 `compose config`、容器环境或连接串。

以下以 Bash 数组 `dc` 表示操作者已核准的完整命令。例如，若批准交付物是单个自包含清单和私有 env 文件，可在干净的操作会话中定义：

```bash
set -euo pipefail
: "${RELEASE_CONTEXT:?}" "${RELEASE_PROJECT:?}" "${RELEASE_MANIFEST:?}" "${RELEASE_ENV_FILE:?}"
dc=(docker --context "$RELEASE_CONTEXT" compose -p "$RELEASE_PROJECT"
    --env-file "$RELEASE_ENV_FILE" -f "$RELEASE_MANIFEST")
"${dc[@]}" config --quiet
"${dc[@]}" config --services
"${dc[@]}" config --images
```

确认实际目标是批准的数据库和入口。遇到占位密钥、目标不符、共享测试卷、未批准的监听地址、未固定的镜像或邮件准入缺失，结束本次窗口。

## 2. 先备份，再迁移与启动

1. 暂停接入和写入，停止后台 worker 与自动重试。记录在途任务和未知投递数，等待在途事务收束。首次空库记录库标识、版本和空表计数；已有数据则核对上次成功迁移、队列终态与迁移差异。检查 `backend/prisma/migrations/` 的有序 SQL、潜在回填、锁与约束。候选从空库应用 21 项；已有库的待应用数以该库为准。
2. 在受控的运维机用 PostgreSQL 16 工具创建迁移前备份。以下服务名由私有 libpq service 定义，密码通过受限 passfile 或获批机制注入。路径必须在批准的备份存储内。归档含业务和认证数据，只登记引用、校验和、权限和时间。

```bash
umask 077
: "${SOURCE_PG_SERVICE:?}" "${PRIVATE_BACKUP_DIR:?}"
archive=$(mktemp "$PRIVATE_BACKUP_DIR/pre-release-XXXXXXXX.dump")
pg_dump --dbname="service=$SOURCE_PG_SERVICE" --format=custom --file="$archive"
pg_restore --list "$archive" >/dev/null
sha256sum "$archive" > "$archive.sha256"
sha256sum --check "$archive.sha256"
```

3. 把归档恢复到新建空实例，按第 4 节比对数据、角色与授权。确认还原点有效后再继续。托管数据库的全局角色、授权和服务级配置需按目标交付物另行核对。
4. **只执行迁移。** 关闭业务入口及直连写入路径，停止所有旧 Backend 和其他消费进程。核对迁移连接与已批准的目标实例、库、备份点一致。只运行一次性迁移命令，不在这一步启动应用。迁移失败时保留原库、备份和 `_prisma_migrations`，记录脱敏错误，在副本验证修复或恢复方案。

```bash
"${dc[@]}" run --no-deps --rm backend npm run db:deploy
```

5. **首个 Backend 启动前核对队列。** 在已核准的目标连接上，用同一只读快照盘点任务和尝试。记录库标识、快照时间和汇总数。若目标或结果无法确认，保持入口关闭、应用停止。

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), CURRENT_TIMESTAMP;
SELECT count(*) AS scans FROM scan_events;
SELECT status, count(*) AS jobs,
       count(*) FILTER (WHERE (status = 'waiting' AND send_not_before <= CURRENT_TIMESTAMP)
                           OR (status = 'queued' AND scheduled_at <= CURRENT_TIMESTAMP)
                           OR (status = 'queued' AND scheduled_at IS NULL AND send_not_before IS NULL)) AS eligible_now
FROM mail_jobs GROUP BY status ORDER BY status;
SELECT count(*) AS attempts,
       count(*) FILTER (WHERE completed_at IS NULL) AS unfinished,
       count(*) FILTER (WHERE provider_invoked_at IS NOT NULL
                          AND completed_at IS NULL) AS invoked_unfinished,
       count(*) FILTER (WHERE status = 'delivery_unknown'
                          AND provider_call_closed_at IS NULL) AS unknown_unclosed
FROM mail_delivery_attempts;
COMMIT;
```

   - **首次空库。** 核对迁移前已记录的空库标识，确认迁移后扫码、任务、尝试均为零。负责人确认窗口允许的处理范围及后续接流条件。只获准验证健康时，按下一步暂停自动处理。
   - **已有或还原的库。** 在受控记录中按任务核对 `waiting.send_not_before`、`queued.scheduled_at`（含可立即领取的任务）、重试次数、`processing`、`delivery_unknown` 及关联尝试。还原库须与快照之后的发送记录、在途结果对账，以免再次提交已投递的任务。负责人明确哪些积压、新任务及重试可处理。自动领取对整个 Backend 生效。只批准部分任务、仍有未核实的调用或缺少对账依据时，维持暂停。

6. **先验证容器，再启动。** 只做健康验收时，在生效清单的 `services.backend.environment` 中显式配置 `MAIL_JOB_PROCESSOR_ENABLED: "false"`。候选基础 Compose 未透传此变量，单改宿主环境或 env 文件不足以暂停。保持所有业务入口、直连和人工发送路径关闭，其他有副作用的定时任务也应按窗口独立核准。该开关只在进程启动时控制自动轮询，不会改写任务状态或禁用手动发送 API。[自动处理器](../backend/src/mail-jobs/mail-job-processor.service.ts) · [手动发送入口](../backend/src/mail-jobs/mail-jobs.controller.ts)

以下 Bash 使用第 1 节的 `dc` 和已核准的 Docker context。先创建容器但保持停止，核对副本数与清单一致，在每个容器上检查开关，再启动同一批容器。运行后从容器内复核环境与健康响应。命令须在 `set -euo pipefail` 下执行。若实际配置或副本状态不符，保持维护并停下全部 Backend。

```bash
expected=false
"${dc[@]}" up --no-start --no-deps --force-recreate --no-build --pull never backend
ids=$("${dc[@]}" ps --all --quiet backend)
test -n "$ids"
d=(docker --context "$RELEASE_CONTEXT")
flag='{{range .Config.Env}}{{if eq . "MAIL_JOB_PROCESSOR_ENABLED=false"}}false{{else if eq . "MAIL_JOB_PROCESSOR_ENABLED=true"}}true{{end}}{{end}}'
for id in $ids; do
  test "$("${d[@]}" inspect --format '{{.State.Status}}' "$id")" = created
  test "$("${d[@]}" inspect --format "$flag" "$id")" = "$expected"
done
"${dc[@]}" start --wait backend
for id in $ids; do
  "${d[@]}" exec "$id" node -e '
    if (process.env.MAIL_JOB_PROCESSOR_ENABLED !== process.argv[1]) process.exit(1);
    fetch("http://127.0.0.1:" + process.env.APP_PORT + "/health")
      .then(async r => { if (r.status !== 200 || (await r.json()).service !== "poolduck-mail-backend") process.exit(1) })
      .catch(() => process.exit(1))' "$expected"
done
"${dc[@]}" exec -T backend ./node_modules/.bin/prisma migrate status
```

7. **处理放行与接流分别批准。** 在暂停状态复查原任务状态和尝试数。发送准入、目标库及完整队列范围均获批后，才将清单中的开关改为 `"true"`，把上段 `expected` 改为 `true`，重新执行创建、核对和启动步骤。Backend 可能在首次健康响应之前领取到期任务。对照原任务和尝试记录后，可在入口仍关闭时启动 Frontend，再按第 3 节验收、决定接流。发生异常时按[第 4 节](#4-停止应用回退与数据库恢复)撤回。

**候选首启实测（2026-11-20，日本时间）。** 从固定版本 `a052518` 的合成扫码 201 生成一笔 `waiting` 任务，恢复到另一台全新的本机 PG16 容器。目标后端启动前，任务已到期 1.117 秒、尝试为 0。核实待启动容器和运行中进程的开关均为 `false`，业务入口关闭，容器内部 `/health` 两次返回 200。两次数据库读数相隔 **5.575 秒**，覆盖超过五个默认轮询间隔（每秒一次）。同一扫码和任务内容未变，尝试和调用标记均为 0。单独放行这笔 mock 任务后，用相同镜像重建并核实 `true`，原任务转为 `sent`，有且仅有 1 笔已完成尝试、1 个调用标记，幂等关联仍指向原扫码和任务。两阶段均为 `APP_ENV=local`、mock、真实发送关闭。此前后台完全停机时的两个到期窗口见[首发撤回实测](testing/first-release-withdrawal-2026-11-20.md)。

### 2.1 首个独立平台管理员

**停止点。** 发布负责人先确认迁移完成、备份可恢复、后端所连库和镜像摘要与变更单一致。安全负责人须先批准正式控制面的访问范围、MFA 强制时点和账号保管人。决定待定，或决定要求先实施 MFA 而候选尚未具备时，停在初始化之前，保持平台入口关闭。平台身份属于独立的 `platform_admins` 表。[ADR-013](decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md) · [访问评审 #114](https://github.com/omajilmanbo/poolduck-mail/issues/114)

获准的部署运维人员使用第 2 节已核对的数据库连接，只读取账号总数与 active 数：

```bash
psql -XAt -v ON_ERROR_STOP=1 --dbname="service=$SOURCE_PG_SERVICE" \
  -c "SELECT count(*), count(*) FILTER (WHERE status='active') FROM platform_admins"
```

| 总数 / active 数 | 运维操作 |
|---|---|
| 0 / 0 | 首次空账号初始化。指定一名执行者，使用下列容器命令执行一次。 |
| ≥1 / 1 | 跳过 bootstrap，由现有账号保管人登录。若失去访问权，走单独批准的轮换或恢复流程。 |
| ≥1 / 0、active 多于 1，或结果无法核实 | 停止初始化，核对目标库、历史变更及备份。禁用账号的恢复、密码轮换和会话撤销按[管理员手册 §2](admin-guide.md#2-平台控制面)办理。 |

使用第 1 节已核准的 `dc`，在运行中的 Backend 容器执行。先检查镜像内 CLI 存在，确认工作目录没有会覆盖运行环境的 dotenv 文件。由获准操作者从正式 secrets store 取得平台身份和专用高熵密码（至少 16 字符，单行），在受控终端的隐藏输入提示中输入。以下命令通过标准输入传两行，只在 CLI 子进程中导出 `PLATFORM_ADMIN_EMAIL` 和 `PLATFORM_ADMIN_PASSWORD`；数据库连接沿用已核对的服务配置。运行前关闭终端录制和 shell 跟踪。

```bash
"${dc[@]}" exec -T backend sh -ec \
  'test -r scripts/platform-admin.mjs && test ! -e ../.env && test ! -e .env && test ! -e .env.local'
(
  set +x
  IFS= read -rs -p '平台管理员标识: ' admin_identity </dev/tty
  printf '\n' >/dev/tty
  IFS= read -rs -p '平台管理员密码: ' admin_pass </dev/tty
  printf '\n' >/dev/tty
  printf '%s\n' "$admin_identity" "$admin_pass"
) | "${dc[@]}" exec -T backend sh -eu -c '
  IFS= read -r PLATFORM_ADMIN_EMAIL
  IFS= read -r PLATFORM_ADMIN_PASSWORD
  export PLATFORM_ADMIN_EMAIL PLATFORM_ADMIN_PASSWORD
  exec npm run platform:admin -- bootstrap'
```

成功时 CLI 退出 0。再查 `platform_admins` 应为 1 / 1，核对同一时间、同一管理员内部 ID 的 `platform.admin.bootstrap` 成功审计。候选的 CLI 成功审计缺少 `request_id`，在受控变更记录登记操作人、时间、目标环境和结果。若 CLI 拒绝、退出不明或审计不符，先复核库内状态，勿重复提交或自行轮换。[候选 CLI](../backend/scripts/platform-admin.mjs) · [审计关联 #192](https://github.com/omajilmanbo/poolduck-mail/issues/192)

### 2.2 首次平台登录、人工开通与经理交接

1. **平台账号保管人验证登录。** 经批准的 HTTPS 入口访问 `/platform/login`，使用独立平台身份登录，进入 `/platform`。核对目标环境、访问范围和平台审计；平台会话只用于控制面。获得首个租户的开通授权后才进行下一步。
2. **平台管理员开通。** 在 `/platform` 核对获批的租户名称、首位 `tenant_manager` 邮箱、初始 `trial` 或 `active`、起止时间（结束晚于开始）及正整数地点额度，提交并确认。系统原子创建租户、订阅及首位经理，生成 `tenant_code` 和临时密码。遇到超时或结果不明，先查租户摘要和平台审计；页面重新提交会生成新幂等键。
3. **获授权的交付人核验接收人。** 成功区域显示租户名称、`tenant_code`、经理邮箱及临时密码。核对接收人和获批交付渠道后，由专人转交。若使用“下载创建信息 CSV”，按明文凭据受控保管；安全保存后点击“我已安全保存，清除显示”，交付确认后删除临时副本。发布记录只记交接时间、结果和受控工单引用。接收人或渠道未获准时暂停交付。[管理员手册 §2](admin-guide.md#2-平台控制面)
4. **经理本人完成首登。** 从租户入口 `/` 输入 `tenant_code`、经理邮箱及临时密码，进入 `/change-password` 自行设置新密码，再用新密码登录并核对本租户工作台。由经理确认完成改密和接收，平台运维无需获知新密码。[合成浏览器与 CLI 验收（#186，固定证据版本）](https://github.com/omajilmanbo/poolduck-mail/blob/2eb10e17e58a78797b6bc56e7985fd81dcdaa198/docs/testing/candidate-platform-smoke-2026-11-19.md)

## 3. 验收与开放流量

1. 在内部确认 PostgreSQL 可用、前后端 healthy。从获批的外部网络检查 HTTP 跳转保留正式主机、路径和查询串，按目标信任链校验证书和域名。通过同一 HTTPS 入口确认首页可用，`/health` 和 `/healthz` 分别返回后端和前端的服务名。核对 CORS 允许的来源，再用获批验收账号确认 `/api/auth/me` 从无会话的 401 变为登录后的 200。只记录两枚 Cookie 的名称、路径及 `Secure`、`HttpOnly`、`SameSite` 属性。按批准的网络边界核对入口和内部端口的可达性。[固定候选的本机 HTTPS 验收](testing/candidate-local-https-2026-11-20.md)
2. 上线前在**隔离合成环境**按演练记录执行登录、订阅、地点、扫码、取消、mock 任务与历史检查。仓库的 `local:seed`、`staging:seed` 和 `smoke:api` 属于合成演练。正式环境使用经批准的账号/数据和该窗口批准的只读验收步骤。任何涉及投递的生产验收由正式邮件准入另行定义。
3. 发布负责人逐项核对备份可恢复、迁移成功、权限和历史正确、告警接收有效、无未知投递被自动重发。记录 release notes、观察窗口和负责回退的人。只有人工批准后才切流，按已批准观察窗口跟踪错误、拒绝率、任务积压、失败率与数据库状态。

## 4. 停止、应用回退与数据库恢复

入口、健康、租户隔离或邮件状态异常时，先关闭业务入口、停止收写和发送，记录最后正常时刻并保全原库、卷和日志。故障时已经发出的请求可能在停机后才有结果。值班人核对在途事务及投递结果后，再选择下列路径。

### 首发没有获批的上一生产镜像

1. **切流前中止。** 保持所有业务入口关闭或返回静态 503，在独立客户端验证首页和写入路径。停下已启动的应用，核实原库的扫码、任务、尝试及在途事务。迁移、初始化或其他已提交写入也须保留。若发现已接收业务，按下一步处理。
2. **已接收业务后撤回。** 将全部业务流量切到持久的维护响应或关闭入口，使既有会话也无法提交写入，并封住直连和旁路。尽快停止所有 Backend 副本，再停 Frontend。候选的首次发送、重试和手动发送 API 都在 Backend 内。仅切换入口仍会处理到期任务。分别记录入口开始拒绝写入及所有处理进程退出的时刻，核对两者之间的提交、在途调用和最终事务结果。[候选后台处理器](../backend/src/mail-jobs/mail-job-processor.service.ts) · [发送 API](../backend/src/mail-jobs/mail-jobs.controller.ts)

以下示例适用于第 1 节已核准的 Compose 服务名。使用 Caddy 时，先把可在重启后生效的维护配置放到挂载位置，保留获批域名和 TLS，将业务代理规则替换为 `respond "maintenance" 503`，并加 `header Cache-Control "no-store"`。其他入口使用目标平台的等价维护操作。停止等待时长由当次窗口指定。

```bash
: "${APP_STOP_GRACE_SECONDS:?}"
if ! ( "${dc[@]}" exec -T reverse-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile &&
       "${dc[@]}" exec -T reverse-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ); then
  "${dc[@]}" stop -t "$APP_STOP_GRACE_SECONDS" reverse-proxy || echo '入口仍待确认，立即阻断上游并停 Backend' >&2
fi
"${dc[@]}" stop -t "$APP_STOP_GRACE_SECONDS" backend
"${dc[@]}" stop -t "$APP_STOP_GRACE_SECONDS" frontend
"${dc[@]}" ps --all
```

3. **确认冻结。** 从入口外侧验证首页及写入路径均返回维护状态或连接已关闭。正式验收的写入探针应使用即使误达应用也无法创建业务记录的请求。确认所有 Backend 已退出、编排器不会补起副本，保持原数据库、卷和日志。经受控只读连接按原任务 ID 比对扫码、任务、幂等记录及尝试。用数据库时钟跨过相应的 `send_not_before` 或 `scheduled_at` 再核对尝试数和 `provider_invoked_at` 计数。已有调用、`processing`、`delivery_unknown` 或中断时结果不明的任务，由值班人与 provider 对账后逐项决定，禁止自动重发。禁止用上线前空库覆盖已接收的记录。
4. **审批恢复。** 先确认故障处置、获批镜像和原库、在途结果、积压清单及可恢复的投递范围。仅需验证健康时，按[第 2 节](#2-先备份再迁移与启动)保持入口关闭并核实自动处理已暂停。以自动处理开启的配置启动 Backend 前，必须取得恢复处理的批准。先保持入口维护，核对旧任务及尝试的变化，再经批准恢复入口、用获批账号复核原历史。若仍无获批的可运行版本，继续维护并保全数据。演练用历史提交不作为首发回退镜像。[本机首次撤回验收](testing/first-release-withdrawal-2026-11-20.md)

### 有获批回退镜像或需要恢复数据库

- **应用故障、schema 兼容。** 把生产清单中的前后端镜像切为已批准的上一生产 digest，保留当前数据库。启动前完成在途投递对账和恢复处理审批，复核健康、认证、订阅、地点与只读历史，再决定是否恢复入口。演练的两个提交具有完全相同的 Prisma 目录；更早版本须重新验证。

```bash
"${dc[@]}" config --images
"${dc[@]}" up -d --no-deps --no-build --pull never --force-recreate --wait backend frontend
```

- **schema 不兼容或数据受损。** 保持写入与发信冻结。记录备份时间之后的写入及潜在丢失窗口，取得数据负责人同意。选择迁移前归档、验证校验和，确认新的隔离数据库为空且标识区别于原库，然后执行单事务恢复。使用批准的恢复角色和所有权映射。保留原库供核对。

```bash
: "${NEW_EMPTY_PG_SERVICE:?}"
test "$SOURCE_PG_SERVICE" != "$NEW_EMPTY_PG_SERVICE"
sha256sum --check "$archive.sha256"
pg_restore --single-transaction --exit-on-error --dbname="service=$NEW_EMPTY_PG_SERVICE" "$archive"
```

- **切换连接。** 在启动 worker 前核对迁移记录、表/索引/约束、租户数、订阅、扫码→任务→尝试的关联与状态、未知投递及审计完整性。在备份点快照上比较计数；仅合成小库可直接做全表内容比对。确认恢复后重放历史任务的风险已处置。更新生产 secrets 中的数据库目标，重建应用连接，复核运行时所连库和只读历史，再按批准顺序恢复写入、发送与流量。记录恢复时刻及实际丢失窗口，交值班人签收。

11 月 19 日演练验证了应用从 `a052518` 回退到 `29ce990` 再切回。11 月 20 日计时仅覆盖 `a052518` 同版本恢复、本机合成小库和 mock 投递，生产 RPO/RTO 与 D01 目标仍待单独验证或决策。[应用版本回退记录](testing/first-deployment-rehearsal-2026-11-19.md) · [同版本恢复计时报告](testing/timed-candidate-restore-2026-11-20.md)
