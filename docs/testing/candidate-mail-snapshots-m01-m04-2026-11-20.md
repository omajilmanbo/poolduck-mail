# M01 / M04 人员资料变更后的通知快照

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。A 表示同一人在建单时的姓名与地址，B 表示首次等待窗口内更新后的资料。正常 HTTP、真实 PostgreSQL、真实时钟和候选默认轮询 worker 负责建单、认领、排期、自动重试及历史查询。投递使用本机 sandbox provider，调用入参只在内存中比对，真实外发关闭。[矩阵 M01](business-requirements-matrix.md#M01) · [矩阵 M04](business-requirements-matrix.md#M04)

| 合成任务 | 本机 provider 调用 | 单一收件地址、主题及完整正文的比对结果 |
| --- | ---: | --- |
| 改资料前创建的旧任务 | 2 | 第一次模拟失败，自动重试成功。两次均逐字节匹配同一份 A 快照。 |
| 改资料后创建的新任务 | 1 | 投递成功，匹配 B。 |
| 对照租户自己的任务 | 1 | 投递成功，匹配该租户自己的快照。 |

更新资料时，旧任务仍在等待，认领和投递调用均为 0。旧任务在等待、排队重试和成功三个阶段的扫码及邮件历史都保留 A，新任务的历史显示 B。三笔任务的 v2 主题和正文均按数据库扫码时间换算东京时间、进出动作和人员资料独立核对，包含标点与换行。四次本机调用分别对应四条数据库投递尝试，三笔任务最终全部成功。[建单快照](../../backend/src/scan-events/scan-events.service.ts) · [投递与重试](../../backend/src/mail-jobs/mail-jobs.service.ts)

两租户各自使用对方的人员码，两次均被拒绝，新增任务为 0。主租户的扫码历史、邮件历史各有两条，对照租户各有一条。四次跨租户直接读取详情均被拒绝。

另在候选运行四套既有定向测试，84/84 项通过。历史 v1/v2 在模拟 429 后重试并复用原主题和正文由 fake client 契约测试验证。本轮真实 worker 的三笔新建任务使用 v2，收件端实际排版及外部 OCI 投递另有验收范围。[扫码测试](../../backend/test/scan-events.spec.ts) · [邮件任务测试](../../backend/test/mail-jobs.spec.ts) · [重试测试](../../backend/test/mail-job-retry.spec.ts) · [v1/v2 契约测试](../../backend/test/oci-mail-contract.spec.ts) · [M03 重试耗尽实测](candidate-mail-retry-exhaustion-2026-11-20.md)
