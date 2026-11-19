# S11 多应用节点取消倒计时验收

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。两个独立应用进程和两个浏览器上下文连接同一本机 PostgreSQL 16.16，使用合成操作员及 mock 投递。仅偏移应用进程的时钟，数据库和浏览器沿用真实时钟。[矩阵 S11](business-requirements-matrix.md#S11) · [ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md)

| PostgreSQL 相对截止时点 | 两端页面实测 | 慢节点操作后 |
| --- | --- | --- |
| 截止前 1.416–1.451 秒，3 笔 | +3 秒节点禁用按钮，提示窗口已结束。−3 秒节点仍可取消，显示约 5 秒。 | 3/3 返回 200，状态变为已取消，各有 0 次尝试及 mock 调用。 |
| 截止后 0.080–0.531 秒，4 笔，历史均为 waiting | +3 秒节点禁用按钮。−3 秒节点仍显示可以取消，约 3 秒。 | 4/4 返回 409 `SCAN_CANCEL_WINDOW_EXPIRED`。之后每笔各一次成功 mock 投递。 |

同钟对照另有两笔。两端在截止前约 1.4 秒均可取消，点击成功并且零投递。另一笔在截止后约 1.3 秒已发送，两端均无取消按钮，mock 调用一次。偏钟样本分别覆盖处理器暂停和恢复，最终共 9 个任务，4 笔取消均零尝试，5 笔已发送各有一条成功尝试。

历史的 `server_time` 与 `can_cancel` 使用应用进程时钟。取消和领取的 SQL 使用 PostgreSQL 时钟。数据库的接收时间至截止为 10.000–10.001 秒。创建响应中截止与 `server_time` 的差，快端约为 7 秒、慢端约为 13 秒。偏钟时创建响应与历史读取的提示偏差由 [#219](https://github.com/omajilmanbo/poolduck-mail/issues/219) 跟踪。[历史及创建响应](../../backend/src/scan-events/scan-events.service.ts) · [工作台](../../frontend/app/page.tsx) · [取消 SQL](../../backend/src/scan-events/scan-cancellation.sql.ts) · [领取 SQL](../../backend/src/mail-jobs/mail-job-claim.sql.ts)
