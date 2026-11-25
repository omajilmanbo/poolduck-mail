# 候选 a052518 的 A08／S10 订阅变化与扫码取消补验

2026-11-20（日本时间）。固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。本次补验正常扫码后、首次领取或重试领取前发生订阅变化的组合。已有发布门禁覆盖取消截止前后各 1 ms、取消与领取的先后结果，以及预置订阅状态下的 worker 阻断。既有候选 HTTP 证据覆盖有效订阅下的同地点另一操作员取消。[矩阵 A08](business-requirements-matrix.md#A08) · [矩阵 S10](business-requirements-matrix.md#S10) · [ADR-003](../decisions/ADR-003-tenant-context-and-subscription-gating.md) · [ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md) · [发布门禁](../../backend/scripts/adr017-release-validation.mjs) · [既有扫码补验](candidate-scan-dedup-2026-11-19.md)

## 执行方式

从候选 Git archive 构建 Backend runtime，在本机新建 PostgreSQL 16.16 专用库和卷。确认空库、专用库名、loopback 地址与无宿主端口映射。`npm run db:deploy` 退出 0，应用 21 项迁移，临时探针 `node a08s10-evidence.mjs` 退出 0。只读连接独立核对数据库时间、任务、取消字段和 attempt 行。

三个合成租户分别用于自然到期、暂停和排期重试。每组原扫码人通过正常 HTTP 登录，具备该唯一地点的明确 assignment。自然到期和暂停组各有另一名在同地点有独立 assignment 的操作员。五次真实 HTTP 扫码均返回 201 并生成 `waiting`。自然到期组的短 `end_at` 由夹具在扫码前设置，随后自然经过该时间，数据库原状态仍为 `active`，订阅检查返回 200、`expired` 和 `can_send=false`。两次暂停均走已授权平台 PATCH，返回 200，保留原订阅区间，租户订阅检查返回 `suspended` 和 `can_send=false`。[HTTP 契约](../api.md)

实验运行于 `APP_ENV=test`、`NODE_ENV=test`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。自动轮询关闭，探针等 PostgreSQL 实时达到已保存的截止点，再显式调用候选 `MailJobProcessorService.processDueJobs()`。领取、attempt 落库、订阅复核与阻断使用实际候选组件。排期重试的夹具只设置官方 `MAIL_MOCK_SEND_RESULT=failure`，由候选的真实 mock 失败生成 `scheduled_at`。未手工回拨任何任务时间，也未调整主机时钟或切换现有环境。[候选 worker](../../backend/src/mail-jobs/mail-job-processor.service.ts) · [订阅复核与阻断](../../backend/src/mail-jobs/mail-jobs.service.ts)

## 时间顺序与结果

时间均为相对该行扫码的数据库时间 `T0`，单位为毫秒。

| 场景 | 实测时序 | HTTP、任务终态与调用 |
| --- | --- | --- |
| 自然到期，另一操作员取消 | 到期 +4,986 → 取消 +5,059 → 截止 +10,001 | 首次取消、原扫码人重试和截止后再次重试均为 200，复用首次 `canceled_at`。任务 `canceled`，首次取消人及原动作保留，0 attempt，0 mock。 |
| 暂停，另一操作员取消 | 暂停审计 +48 → 取消 +64 → 截止 +10,001 | 三次取消均为 200，终态和原时间一致。首次取消人及原动作保留，0 attempt，0 mock。 |
| 自然到期，保留给 worker | 到期 +4,961 → 最早领取 +10,001 → 实际领取 +10,075 | 进入 `failed`，原因 `SUBSCRIPTION_NOT_SENDABLE`。1 条已完成的 `blocked` attempt，无 provider 调用时间，0 mock。终态后的取消返回 409 `SCAN_CANCEL_NOT_AVAILABLE`。 |
| 暂停，保留给 worker | 暂停审计 +34 → 最早领取 +10,000 → 实际领取 +10,067 | 进入 `failed`，原因 `SUBSCRIPTION_NOT_SENDABLE`。1 条已完成的 `blocked` attempt，无 provider 调用时间，0 mock。终态后的取消返回 409 `SCAN_CANCEL_NOT_AVAILABLE`。 |
| 已排期重试，暂停后再次领取 | 首次领取 +10,061 → 真实 mock 失败并排期 → 暂停审计 +10,109 → 排定重试 +40,066 → 实际重领 +40,117 | 首次进入 `queued`、`retry_count=1`，1 条 `retry_scheduled` attempt。重领后进入 `failed`，原因 `SUBSCRIPTION_NOT_SENDABLE`，排期清空。新增 1 条已完成的 `blocked` attempt，无 provider 调用时间。mock 总数为首次失败的 1 次，重领新增 0 次。 |

第一轮 worker 处理 3 项，第二轮处理 1 项，末轮无到期任务。独立对账为 5 条扫码、5 个任务、5 条幂等记录、4 条 attempt，其中 3 条 `blocked`、1 条 `retry_scheduled`。唯一 provider 入口调用是排期用的失败 mock，`sent` 为 0，实际外发为 0。临时容器、数据卷、自建镜像和探针已回收。
