# 候选 a052518 扫码幂等与去重数据库补验

2026-11-19（日本时间）。候选为 `origin/main` 的 `a05251897d7fc11d96114606bcaa1807dd96af55`。本轮补齐 S06/S07 的并发扫码写入、取消后重扫、授权范围隔离及两种到期边界。候选 CI 已覆盖发送 worker 竞争领取和取消／领取截止边界，本轮沿用这些证据。[S06 请求键幂等](business-requirements-matrix.md#S06) · [S07 扫码去重](business-requirements-matrix.md#S07) · [#68](https://github.com/omajilmanbo/poolduck-mail/issues/68) · [#125](https://github.com/omajilmanbo/poolduck-mail/issues/125) · [候选 CI 数据库作业](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135392615224)

## 环境与命令

独立工作树从候选 Git archive 构建 Backend runtime。在新建专用卷上启动 PostgreSQL 16，数据库、Nest 与客户端均在仅有 loopback 的网络命名空间，无宿主端口映射。配置为 `APP_ENV=test`、`NODE_ENV=test`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。仅使用合成 operator、地点、人员和保留测试域地址。自动发送调度关闭，由探针确认 PostgreSQL 中的 `send_not_before` 到期后显式执行现有 worker。

| 当次运行的命令 | 退出码 | 实测 |
| --- | ---: | --- |
| `npm run db:deploy` | 0 | 空库应用 21 项迁移。 |
| `node s067-evidence.mjs` | 0 | 本轮临时探针启动候选 Nest AppModule，执行真实 HTTP、数据库计数和毫秒边界检查，14 项通过。 |

`npm run db:deploy` 是仓库的迁移命令。`s067-evidence.mjs` 是当次构建的临时探针，已随实验清理。仓库中的相关回归入口为在 `backend/` 运行 `npm test -- --runTestsByPath test/scan-events.spec.ts`。该套件的断言与本报告的双连接、SQL 计数及固定事务时钟实测分别记录。[仓库测试脚本](../../backend/package.json) · [扫码服务回归用例](../../backend/test/scan-events.spec.ts)

## 两个 HTTP 客户端与实际计数

两个 operator 正常登录并各用独立 HTTP 连接，均明确获授租户 A 的首个地点。另一个已登录的 operator 限定在租户 B 的地点。以下计数依次为扫码、邮件任务、投递尝试。

| 场景 | HTTP 与数据库结果 |
| --- | --- |
| 同一键并发提交两次，模拟连接重试 | 两次均返回 201，同一事件与任务各返回一次创建和一次重放。计数为 **1／1／0**，幂等记录 1 条。 |
| 同租户同键改为另一授权地点及其人员 | 返回 409 `IDEMPOTENCY_KEY_CONFLICT`，计数保持 **1／1／0**。 |
| 另一名同地点获权 operator 取消，再提交原键 | 取消返回 200，原键重放 201，返回原事件、任务及原取消时间，原动作仍为入室，状态为 `canceled`。计数保持 **1／1／0**。 |
| 取消后立即重扫，两个客户端各用新键提交同一离开动作 | 在原 10 秒窗口内，两次返回 201，只生成一套新的离开事件和等待任务，另一请求复用它。累计 **2／2／0**，幂等记录 3 条。新窗口内再提交相反动作返回 409 `SCAN_ACTION_CONFLICT`，累计计数不变。 |
| 两个其他授权范围各自正常扫码 | 租户 A 的另一地点及租户 B 的地点在同一 10 秒内各创建 **1／1／0**。租户 B 与 A 首地点复用公开地点码和一个请求键，两次仍各自创建。每个地点使用自己的合法人员映射。 |
| 到期领取、mock 完成及终态重放 | 显式运行现有 worker，三项仍有效的任务各一次 sandbox 调用、各留一条 `succeeded` 尝试和调用／完成时间。取消的任务为零调用、零尝试。投递后再重放已发送及已取消原键，分别回读 `sent`、`canceled`，再次运行 worker 领取 0 个任务。 |

最终独立 SQL 对账为 **4 条扫码、4 个邮件任务、3 次 sandbox 尝试、5 条幂等记录**。租户 A 首地点为 **2／2／1**，另一个地点为 **1／1／1**，租户 B 地点为 **1／1／1**。所有尝试均为 sandbox，实际外部投递为 0。[扫码写入与重放实现](../../backend/src/scan-events/scan-events.service.ts) · [mock provider](../../backend/src/mail-jobs/sandbox-mail.provider.ts)

## 固定数据库时间的边界

每个点使用独立 PostgreSQL 事务，取该事务固定的 `CURRENT_TIMESTAMP`，并核对与 `date_trunc('milliseconds', CURRENT_TIMESTAMP)` 转成 JavaScript `Date` 后的毫秒值一致。按该时间构造合成原记录，由候选扫码服务在同一事务使用真实查询读取和写入。这里测试的是 DB 固定时钟下的服务与数据库条件，HTTP 竞态在上节单独执行。各点结束后回滚合成边界数据，尝试均为 0。[ADR-008](../decisions/ADR-008-explicit-scan-entry-exit-action.md) · [ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md)

| 规则 | 边界前 1 ms | 恰好到界 | 边界后 1 ms |
| --- | --- | --- | --- |
| 10 秒，同动作、无请求键 | 9,999 ms，复用原结果，1／1／0 | 10,000 ms，创建，2／2／0 | 10,001 ms，创建，2／2／0 |
| 24 小时，原请求键及指纹相同 | 86,399,999 ms，原键仍指向原结果，1／1／0 | 86,400,000 ms，创建，原键指向新结果，2／2／0 | 86,400,001 ms，创建，原键指向新结果，2／2／0 |

运行结束回收本轮容器、数据库专用卷、临时镜像标签及探针文件，剩余容器、卷和镜像标签均为 0。
