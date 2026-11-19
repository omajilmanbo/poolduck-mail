# S11 多应用节点取消倒计时验收

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。两个独立应用进程和两个浏览器上下文连接同一本机 PostgreSQL 16.16，使用合成操作员及 mock 投递。仅偏移应用进程的时钟，数据库和浏览器沿用真实时钟。[矩阵 S11](business-requirements-matrix.md#S11) · [ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md)

| PostgreSQL 相对截止时点 | 两端页面实测 | 慢节点操作后 |
| --- | --- | --- |
| 截止前 1.416–1.451 秒，3 笔 | +3 秒节点禁用按钮，提示窗口已结束。−3 秒节点仍可取消，显示约 5 秒。 | 3/3 返回 200，状态变为已取消，各有 0 次尝试及 mock 调用。 |
| 截止后 0.080–0.531 秒，4 笔，历史均为 waiting | +3 秒节点禁用按钮。−3 秒节点仍显示可以取消，约 3 秒。 | 4/4 返回 409 `SCAN_CANCEL_WINDOW_EXPIRED`。之后每笔各一次成功 mock 投递。 |

同钟对照另有两笔。两端在截止前约 1.4 秒均可取消，点击成功并且零投递。另一笔在截止后约 1.3 秒已发送，两端均无取消按钮，mock 调用一次。偏钟样本分别覆盖处理器暂停和恢复，最终共 9 个任务，4 笔取消均零尝试，5 笔已发送各有一条成功尝试。

历史的 `server_time` 与 `can_cancel` 使用应用进程时钟。取消和领取的 SQL 使用 PostgreSQL 时钟。数据库的接收时间至截止为 10.000–10.001 秒。创建响应中截止与 `server_time` 的差，快端约为 7 秒、慢端约为 13 秒。偏钟时创建响应与历史读取的提示偏差由 [#219](https://github.com/omajilmanbo/poolduck-mail/issues/219) 跟踪。[历史及创建响应](../../backend/src/scan-events/scan-events.service.ts) · [工作台](../../frontend/app/page.tsx) · [取消 SQL](../../backend/src/scan-events/scan-cancellation.sql.ts) · [领取 SQL](../../backend/src/mail-jobs/mail-job-claim.sql.ts)

<a id="branch-220"></a>

## 独立修复分支的八笔复核

[#220](https://github.com/omajilmanbo/poolduck-mail/pull/220) 的固定提交 `45da26c644cdec104b5961587d6454d99a683110` 使用两个独立应用进程、两份浏览器会话和真实 PostgreSQL 16.16。初次创建响应使用数据库接收时间，逐笔窗口为 10.000–10.001 秒。历史列表用一次数据库采样作为整页的时间依据，详情也按数据库采样。另一节点用同一键重读时，原事件和任务不变，并返回最新状态。

| 样本 | 分支实际结果 |
| --- | --- |
| 同钟，2 笔 | 一笔成功取消且零调用，一笔到期处理后无取消按钮并投递一次。 |
| 应用时钟 +3／−3 秒，暂停领取，4 笔 | 两节点在截止前一致显示可取消，两笔均取消成功。另两笔过截止时任务仍为 waiting，两端同时禁用按钮，直接请求均为 409。恢复领取后各投递一次。 |
| 应用时钟 +3／−3 秒，处理器运行，2 笔 | 一笔成功取消且零调用，另一笔到期后两端均无取消按钮并投递一次。 |

这 8 笔共 4 笔取消、零调用，4 笔发送、各一次 mock。原 `a052518` 的九笔基线结果仍见上节。分支后端全套 276 项、前端 72 项通过，总控另运行原 Jest 命令覆盖扫码、历史和导出三个套件，51/51 通过。首次受本机沙箱回环限制，同一命令获准使用 Supertest 回环连接后通过。GitHub 五项均通过，独立审查待完成。[提交 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44630478256) · [分支及测试依据](https://github.com/omajilmanbo/poolduck-mail/pull/220)
