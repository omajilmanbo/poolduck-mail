# Issue #116 Staging 容量测试 Runbook

本 Runbook 只适用于 OCI Staging 的合成数据与 mock/sandbox 邮件链路。结果表示单 VM 上应用、
PostgreSQL、等待队列和 mock provider 的容量，不表示真实邮件供应商投递能力，也不能外推到 Production。

## 1. 已批准边界与待批准窗口

- 目标环境必须为 `APP_ENV=staging`，邮件必须为 `MAIL_PROVIDER=mock` 或已批准的 sandbox。
- 当前单负载机上限为 50 个不同 operator session；这是默认登录 IP 限流 60 次/15 分钟下的安全上限。
- 不修改登录限流、10 秒业务去重、10 秒发送犹豫期、订阅门禁或 tenant/location 授权来取得更高数字。
- 正式运行前仍需人工确认：无人使用 Staging 的时间窗、三个场景的持续时间、停止条件以及
  provider failure 场景的临时环境切换。
- Production、真实邮件 provider、真实收件人和付费监控均不在范围内。

## 2. 工具与合成数据

| 入口 | 作用 | 输出边界 |
|---|---|---|
| `npm run capacity:seed` | 幂等创建专用 active/suspended tenant、50 个 operator 和合成人员 | 只打印数量和公共测试代码，不打印密码或内部 ID |
| `npm run capacity:plan` | 校验负载参数并显示执行计划 | 自动删除密码字段 |
| `npm run capacity:run` | 从 VM 外执行 steady/burst/mixed 负载 | 只输出聚合延迟、状态和吞吐 |
| `npm run capacity:report` | 从测试时间窗聚合 mail job、领取延迟、积压和数据库等待 | 不输出人员、邮箱、动作码、token 或内部资源 ID |
| `deploy/staging/capacity-monitor.sh` | 每 5 秒采样宿主机和容器资源 | TSV，仅含资源数值和容器名 |

容量账号密码必须通过 `CAPACITY_TEST_PASSWORD` 或 `CAPACITY_TEST_PASSWORD_FILE` 注入，长度至少 16；
不得进入 Git、命令输出、报告或 Issue。推荐把随机密码保存于仓库外、权限 `0600` 的临时文件，
在 seed 与外部负载机之间安全传递，测试结束后删除。

默认合成资源：

- active tenant `5A6E116001`，location `5A6E1161`，operator 前缀 `capacity-a-op-`；
- suspended tenant `5A6E116002`，location `5A6E1162`；
- active 人员池默认 4,096，确保同一人员再次出现前跨过 10 秒去重窗口；完整动作码不进入报告。

## 3. 测试场景

1. `steady`：阶梯 `1,5,10,20,40,50`，每个虚拟 operator 每秒最多提交一次有效扫码，每档 5 分钟。
2. `burst`：相同阶梯且不设置 think time，用于找到短时排队与超时拐点；每档建议 30–60 秒。
3. `mixed`：80% 有效扫码、10% unmapped、10% suspended 拒绝；在单独批准的子窗口将
   `MAIL_MOCK_SEND_RESULT` 临时设为 `failure`，验证 retry/积压后恢复 `success`。

每个场景单独记录 run start/end、应用 commit、实际规格、负载机位置和 provider result。
provider failure 与 success 结果不得混入同一容量数字。
负载器对同一合成人员强制至少 10 秒重用间隔；burst 不会通过快速循环人员池绕过业务去重。
每次运行最多预登录 50 个不同 operator，连续场景之间至少等待完整的 15 分钟登录限流窗口，
否则登录 429 属于预期安全门禁而不是容量退化。

## 4. 停止与通过条件

负载器自动停止当前阶梯：最近至少 20、至多 50 个请求中的 timeout/5xx 比率达到 5%。
每档满足以下条件才可继续增加并发：

- API 意外响应率 < 5%，p95 <= 2 秒；
- `claimed_at >= send_not_before`，提前领取数恒为 0；
- mail claim p95 <= 2 秒、p99 <= 5 秒，且稳态结束无持续增长的 waiting/queued/processing 积压；
- 无容器 restart/OOM，PostgreSQL 无持续 lock waiter/未授予锁；
- 主机可用内存不少于 1 GiB，根分区使用率低于 80%，负载机自身未饱和。

任一跨 tenant 读取、真实误发、提前 provider 调用、数据库异常、容器 OOM/restart 或磁盘逼近阈值时，
立即停止全部负载并执行恢复检查。最大可持续并发取“完整稳定时段内全部条件通过”的最高阶梯，
不是瞬时成功峰值。

## 5. 准备与 dry-run

1. 记录 Staging commit、`nproc`、内存、根盘、卷 VPU/GB、Compose 状态和容器 restart count。
2. 创建数据库备份并用 `pg_restore -l` 验证；确认无真实数据和外部测试冲突。
3. 在 backend 容器内执行 seed。密码文件先复制到容器临时路径，seed 后立即删除：

   ```bash
   sudo docker cp /path/outside/repo/capacity-password poolduck-mail-backend:/tmp/capacity-password
   sudo docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
     -e CAPACITY_TEST_PASSWORD_FILE=/tmp/capacity-password backend npm run capacity:seed
   sudo docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
     backend rm -f /tmp/capacity-password
   ```

4. 在 VM 外的负载机先运行计划模式和 1 用户、30 秒 dry-run：

   ```powershell
   cd backend
   npm.cmd run capacity:plan
   $env:CAPACITY_BASE_URL = "https://app.poolducktest.com"
   $env:CAPACITY_TEST_PASSWORD_FILE = "<repo 外密码文件>"
   $env:CAPACITY_STEPS = "1"
   $env:CAPACITY_STEP_SECONDS = "30"
   npm.cmd run capacity:run
   ```

5. dry-run 前后执行 `/health`、`/healthz`、登录、订阅拒绝、tenant/location isolation 和 mock mail smoke。

## 6. 正式采集

每个场景开始前在 VM 上启动 5 秒采样；默认 420 次覆盖约 35 分钟：

```bash
mkdir -p /opt/poolduck-mail/metrics/capacity
chmod 700 /opt/poolduck-mail/metrics/capacity
CAPACITY_MONITOR_SAMPLES=420 deploy/staging/capacity-monitor.sh \
  /opt/poolduck-mail/metrics/capacity/<run-id>-host.tsv
```

负载机按场景设置 `CAPACITY_SCENARIO`、`CAPACITY_STEPS`、`CAPACITY_STEP_SECONDS` 后运行
`npm run capacity:run`。保存 JSON 输出时权限设为 `0600`；先人工扫描敏感信息，再决定是否提交聚合摘要。

测试结束后把负载输出中的 `run_started_at/run_finished_at` 传给 backend 容器：

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
  -e CAPACITY_RUN_STARTED_AT=<UTC> -e CAPACITY_RUN_FINISHED_AT=<UTC> \
  backend npm run capacity:report
```

## 7. 恢复与结果模板

停止负载后恢复 `MAIL_MOCK_SEND_RESULT=success`，只重建 backend；等待 waiting/retry 队列达到终态，
然后重复 health、订阅、隔离和 mail smoke。不得手工把 canceled/delivery_unknown 改回 queued，
也不得为清理结果删除数据库历史。

容量报告使用 [`staging-capacity-result-template.md`](staging-capacity-result-template.md)，至少记录：

- 时间窗、commit、2 OCPU/12 GB/100 GB 与卷性能、Compose/Node/PostgreSQL 版本；
- 场景、数据规模、阶梯、持续时间、负载机位置和自身资源余量；
- 每档请求数、RPS、p50/p95/p99、timeout/5xx、预期 4xx 与意外错误；
- mail job/s、状态分布、claim p50/p95/p99、积压、early claim；
- 主机/容器 CPU、内存、磁盘、网络、block IO、restart/OOM、DB connection/lock waiter；
- 最大可持续并发、首要/次要瓶颈、置信边界、监控建议和后续 Issue。

原始指标默认只保留在 Staging 30 天；不得提交含密码、Cookie、完整邮箱、动作码、正文、数据库连接串、
OCI Secret 或内部对象映射的输出。
