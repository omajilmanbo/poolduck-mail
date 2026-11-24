# #139 全局预约本机验收

候选版本 `main@a052518`，PostgreSQL 16.16。两个合成租户共三条已到期的 `queued` 任务，初始 `retryCount=1`。两个独立 Prisma 连接分别走 worker 使用的 `MailJobsService.processQueuedMailJob` 入口。领取、预约、审计和完成都写入真实数据库。内存 fake 单独按 job 记录实际进入 `send` 的 attempt。运行环境为 `mock/false`，只在服务构造时注入预约分支和 fake。

| 步骤 | PG16 中的结果 | 本步 fake 调用 |
| --- | --- | --- |
| 两个 worker 同时处理不同租户的任务 | 一条 `sent/succeeded`，另一条 `queued/deferred`。延期任务的 `scheduledAt` 等于获准预约的 `providerInvokedAt + 50 ms` | 获准任务 1，延期任务 0 |
| 断开两个连接，在新连接上到期后重领延期任务 | 同一 job 变为 `sent`，清空 `scheduledAt`。原 `deferred` 行逐字段保留，新增一条 `succeeded`，预约时间达到原 `scheduledAt` | 1 |
| 上一步提交并断开写入连接后，在另一个重建的连接上新建服务和限流器，处理第三条任务 | 读到上一租户的预约，第三条回到 `queued/deferred`，`scheduledAt` 等于上一笔预约时间加 50 ms | 0 |

两次延期均清除 job 的领取标记，保留 `retryCount=1`。attempt 有 `completedAt` 和 `PROVIDER_RATE_LIMITED`，`providerInvokedAt`、RFC Message-ID 和 provider message ID 均为空。每次延期写入一条对应租户及任务的 `mail.rate.deferred` 审计。最终共 4 条 attempt 行（2 条 `succeeded`、2 条 `deferred`），实际进入 fake 的只有 2 次，调用的 attempt ID 与两条成功记录逐一匹配。

## 对照原始验收条件

| 原 AC | 结论及依据 |
| --- | --- |
| AC1 配置不超过获批 OCI 配额，缺配额配置时真实 provider fail closed | **待运维。** 9 月 29 日批准的是跨实例预约最少间隔 50 ms 的应用上限（最多 20 次/秒），暂不设应用侧日上限。候选 selector 校验环境、显式开关及发件配置，未实现按有效配额配置比较或缺该配置拒绝启动。窗口查询失败时拒绝预约已有单测，不能据此勾选 AC1。[ADR-019 §6 及 #139 修订](../decisions/ADR-019-oci-email-delivery-provider.md) |
| AC2 延期可追踪，不消耗 provider attempt，并遵守 10 秒取消边界 | **阶段规则通过。** 上表核对了持久化的延期、retry 次数和独立调用计数。复用 ADR-017 的 PG16 截止前 1 ms、恰好截止、截止后 1 ms 以及取消成功后零调用的证据。[取消门禁记录](local-adr-017-2026-08-19.md) |
| AC3 明确的 429 不会无限自动重发 | **已有契约通过。** fake client 将明确 429 映射为 transient 并记录 `OCI_QUOTA_REJECTED`，SDK 自动重试关闭。worker 依次退避 30 秒、2 分钟、10 分钟，第四次明确拒绝终止为 `failed`，清空 `scheduledAt`。[OCI 契约](../../backend/test/oci-mail-contract.spec.ts) · [重试边界](../../backend/test/mail-job-retry.spec.ts) |

原 Issue 还要求每分钟、每日边界及配额耗尽验证。准入记录中区域 Limits API 返回 18,000/分钟、50,000/24 小时和 2,008,192 字节/封，目标 compartment 的三项有效值均为空。运维仍须提供目标 compartment 的有效分钟、每日和单封大小额度；应用阈值或每日策略的调整须依据额度及人工决定。已有东京时间午夜、跨年用例验证邮件日期，10 月 16 日的受控单封验证投递。两者都无法给出额度或容量结论。#144 已关闭，#139 继续开放。[原始 #139](https://github.com/omajilmanbo/poolduck-mail/issues/139) · [#144](https://github.com/omajilmanbo/poolduck-mail/issues/144) · [准入与有效额度记录](../oci-mail-staging-readiness.md) · [单封记录](staging-oci-mail-single-send-2026-10-16.md) · [日期用例](../../backend/test/scan-events.spec.ts)

## 复核

在 `backend/` 使用一次性本机 PG16。设置 `APP_ENV=test` 和指向回环地址的 `DATABASE_URL`，账号可创建数据库。脚本校验 PG 主版本，在随机命名的新库应用候选迁移，结束时删除该库。本轮使用本机缓存的 `postgres:16`、随机回环端口和临时数据卷（tmpfs），容器已移除。[验收脚本](../../backend/scripts/oci-pacing-pg16-test.mjs)

```sh
npm run test:oci-pacing-pg16
npm test -- --runTestsByPath test/oci-mail-rate-limiter.spec.ts test/oci-mail-contract.spec.ts test/mail-job-retry.spec.ts test/mail-job-processor.spec.ts test/oci-mail-app-metrics.spec.ts
npm run lint
npm run typecheck
```

PG16 验收及其 build、5 组 50 个定向测试、lint、typecheck 均通过。定向测试也覆盖滚动一秒预约上限、mock 重试，以及无收件人或租户标签的积压、延期和配额拒绝聚合。脚本使用 PG 实际时间；若本机调度使两笔获准预约已相隔至少 50 ms，会报告 `Inconclusive`，该次不可用作延期证据。
