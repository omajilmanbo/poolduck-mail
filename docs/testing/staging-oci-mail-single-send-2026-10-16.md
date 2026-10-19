# Staging OCI 单封真实发信与回滚记录（2026-10-16）

本记录仅保留脱敏结果；不保存收件邮箱、邮件正文、动作码、凭据或 OCI 原始响应。此测试针对切换扫码码格式前的应用版本，不构成 #150 新格式的 Staging 验收。

## 范围与前提

- 用户批准日本时间 17:11 起最多 30 分钟的受控测试，并在 17:32 确认收件后要求结束。
- Staging 起点 commit：`45fbaf9`；测试前确认订阅、目标地点和唯一受控收件人，队列无待发送任务。
- 测试前数据库备份两次，均为 mode 600 且 `pg_restore -l` 可读取；测试窗口内不修改生产数据。

## 首轮停止与修复

- 首轮误选了两个地点，因此按停止条件在 OCI 调用前恢复 mock；两条任务最终均由 mock 完成，不作为真实投递证据。
- 发现 provider 限流事务使用返回 `void` 的 `SELECT pg_advisory_xact_lock(...)`，Prisma adapter 抛出 `UnsupportedNativeDataType`，导致 `STALE_BEFORE_PROVIDER`。改为 `SELECT 1::int AS acquired FROM pg_advisory_xact_lock(...)`，保持同一事务锁语义且返回可解码类型。
- 本地 Backend 30 suites / 247 tests 与构建通过；Staging 仅重建 Backend，在 mock/false 下健康后才重新申请受控发送。此热修复当时尚未提交。

## 重试与结束

- 08:26:48 UTC（17:26:48 JST）重新启用 OCI 真实模式；仅在批准的地点完成一次扫码。
- 本窗口数据库最终为 1 条 `sent` job、1 次 `succeeded` attempt；attempt 有 RFC Message-ID、OCI envelope ID 和 request ID。`sent` 仅表示 OCI 接受提交，不单独代表收件。
- OCI 同一邮件日志出现 `accept` 与 `relay`，未见错误事件；受控收件人确认收到。
- 用户要求提前结束后，于 08:32:13 UTC（17:32:13 JST）恢复 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`；Backend 为 `healthy`。没有将历史 attempt 改写或重排队。

## 未完成与跟踪

- 原 #145 的小批量连续真实发信未做，已拆至 #153；短时高并发合成测试见 #152，不得用本次单封结果推断容量。
- #141 的负面权限验证、#139 的有效 compartment quota 核查继续分别跟踪。
- 真实发信热修复、本记录及相关本地文档需经 PR/CI 审核合并；合并不自动授权再次开启真实模式。
