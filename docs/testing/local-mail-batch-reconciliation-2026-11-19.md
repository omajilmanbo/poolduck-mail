# #153 小批量逐封对账与回退的本机演练

2026-11-19 JST，应用版本 `a052518`。5 个虚构任务中，4 次提交到内存捕获器，2 次 fake accept、2 次 fake relay。响应丢失触发停止后，尾项只由 mock 处理。真实邮件、外部收件和云 API 调用均为 0。#153 的真实窗口验收仍开放。

[#145 单封记录](staging-oci-mail-single-send-2026-10-16.md) 已有当次 OCI accept、relay、人工收件及回滚证据。[Staging 执行卡](../oci-mail-staging-operator-runbook.md) 已有准入、停止及回滚步骤。本次补测同一小批内的 attempt 与事件关联、整批跳过，以及回到 mock 后未领取尾项的去向。

## 逐封结果

从空的内存 PostgreSQL 兼容库（PGlite，应用 21 个仓库迁移）开始。临时库和 Node 进程统一使用 UTC，按数据库截止时间实际等待。用扫码服务创建任务，核对持久化的租户、地点、人员与收件快照。应用服务和限流器按正常领取路径运行，OCI 适配器的提交客户端始终是内存 fake。每次捕获均核对唯一 To、无额外信封收件人、测试标题标记、已持久化的 attempt 与禁用 SDK 重试的配置。

| 任务 | 应用侧结果 | 实际 fake 调用 | fake accept / relay | 停止及回退后 |
|---|---|---:|---|---|
| A | 犹豫期内领取返回 409；到期后 `sent` | 1 | 1 / 1 | 原成功 attempt 保留 |
| B | 第一次明确返回 429，`retry_scheduled`；到期前再次领取返回 409。30 秒后用新 attempt 成功，`sent` | 2 | 第一次 0 / 0，第二次 1 / 1 | 两条 attempt 保留，仅第二次有成功回执 |
| C | 预检夹具中的历史待发任务，在独立取消步骤中于截止前转为 `canceled` | 0 | 0 / 0 | 无 attempt，再领取返回 409 |
| D | 调用后模拟响应丢失，`delivery_unknown`，无下次调度时间 | 1 | 两类事件均未观察到，接受情况未知 | 触发人工停止；回退后再领取返回 409 |
| E | 停止时仍为 `waiting`，无 attempt | 0 | 0 / 0 | 恢复后由 sandbox 调用 1 次，`sent` |

每次实际提交都有独立的 attempt 和 RFC Message-ID。A 与 B 的成功 attempt 均先取得应用成功回执，确认当时只有合成 accept，再注入对应 relay。按持久化 RFC Message-ID 与 envelope ID 逐条关联，两次 relay 各归到一条成功 attempt。B 的拒绝和 D 的 unknown 均未关联到其他任务的事件。收件箱结果在本次演练中不可观测。

## 整批跳过与停止

下面是值守决策的本机夹具。每个反例都将切入模拟批次的回调设为失败断言，实际均未进入。信封反例只改动最后一项，排在前面的有效任务也没有调用捕获器。

| 独立输入 | 跳过整批的次数 |
|---|---:|
| 队列已有历史 `waiting`；或有尚未到重试时间的 `queued` | 2 |
| 最终信封未知；或最终信封与核准快照不符 | 2 |
| 展开后的 To、Cc、Bcc 分别未知 | 3 |
| 组成员部分未知、组内多出目标、Bcc 多出目标 | 3 |
| 地点不匹配、人员不匹配 | 2 |

12 次预检合计 0 次提交、0 条 attempt。另一次以无分配地点请求扫码返回 404，任务数不变。历史重试由事务临时构造并回滚；独立的正常场景在全局待发计数为 0 时开始。上述判断只用于值守演练，产品收件逻辑沿用 ADR-019。

D 出现 unknown 时，演练控制器立即结束 fake 领取循环。用同一内存库重新初始化本机 Backend，读回 `mock` 配置，核实 `REAL_MAIL_SEND_ENABLED=false` 和实际注入的 `SandboxMailProvider`。两次 worker 轮询分别领取 1 项和 0 项，最终待发为 0。比较回退前后数据库记录，A–D 的任务和原有 4 条 attempt 逐字段相同，E 仅新增 1 条 mock attempt。本机 `GET /health` 返回 200。

## 原验收条件与重入点

| #153 原 AC | 本机已核实 | 当次 Staging 窗口仍缺 |
|---|---|---|
| 1. 批准前保持 mock | 本次仅用 mock/fake，真实提交为 0 | 新窗口与收件数据批准；切换前核实容器实际为 mock/false |
| 2. 逐封区分 accepted、relayed、失败或 unknown，无意外收件或重复发送 | 任务 A–E 的调用、重试和事件已逐封对账 | 本批每封真实 attempt、OCI 两类日志及受控收件人核对 |
| 3. 记录停止、回滚及 Backend 健康 | unknown 停止、尾项由 mock 处理、历史行比对及本机 HTTP 200 | 当次停止时间、实际容器重建后的模式、队列和健康记录 |
| 4. 报告脱敏 | 本报告只列任务代号、状态、计数与安全错误分类 | 基于真实批次证据形成并复核脱敏终报 |

**重入从执行卡 A 开始。** 人工须重新批准目标版本、受控收件数据及同意、封数、间隔、上限、观察窗口、停止条件和值守回滚人。随后按卡核对备份可读、IAM、DNS、有效配额、告警和队列，并在受控界面逐项确认最终信封及展开后的 To/Cc/Bcc/组成员精确匹配获准目标，合成标题有 `[POOLDUCK TEST]` 标记。存在历史待发、额外地址或任何收件范围未知，整批跳过真实环节并保留 mock。全部通过后，按执行卡 B 从第一封对账重入，窗口结束按 C 留证。[执行卡](../oci-mail-staging-operator-runbook.md) · [准入与日志对账参考](../oci-mail-staging-readiness.md)

本机另外运行仓库既有的 5 组合成回归，81 项通过。以下命令从 `backend` 执行，覆盖扫码与取消、provider 选择、提交契约、限流及健康接口。上表的逐封与回退记录来自独立的一次性捕获演练。

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/scan-events.spec.ts test/mail-provider-config.spec.ts test/oci-mail-contract.spec.ts test/oci-mail-rate-limiter.spec.ts test/health.spec.ts
```
