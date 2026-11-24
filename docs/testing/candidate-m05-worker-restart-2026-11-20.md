# M05 Worker 进程中断后的邮件恢复

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`，新建 PostgreSQL 16.16 库应用 21 项迁移。两笔任务通过正常扫码创建，由候选的 worker 在真实数据库中领取。分别在调用标记写入前和 sandbox 已被调用、结果还未持久化时暂停并实际终止进程。恢复进程按候选的正常调度运行。[矩阵 M05](business-requirements-matrix.md#M05) · [ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md) · [ADR-019](../decisions/ADR-019-oci-email-delivery-provider.md)

| 中断时点 | 从原领取到首次恢复状态 | 尝试与调用 |
| --- | --- | --- |
| 调用前，尝试为 `claimed` | 60.038 秒后回到 `waiting`，随后重领并发送 | 原尝试为 `abandoned / STALE_BEFORE_PROVIDER`。新尝试成功，只有重领后调用一次 mock。 |
| 已调用，结果尚未持久化 | 60.227 秒后进入 `delivery_unknown` | 原尝试为 `delivery_unknown / PROVIDER_OUTCOME_UNKNOWN`，无下次调度，累计一次 mock 调用。 |

操作员通过工作台看到“已发送”和“投递结果未知”。后者的详情返回 200，手动发送返回 409 `MAIL_JOB_STATUS_NOT_SENDABLE`。终态后继续观察 5 轮调度，两笔任务和三条尝试均保持原样，调用没有增加。实测使用合成数据和本机 sandbox，真实投递为零。
