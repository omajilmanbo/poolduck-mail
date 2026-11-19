# #85 固定候选的应用侧投递验收

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。本机 Chromium、真实前后端和新建 PostgreSQL 16.16 经过正常扫码及候选 worker。OCI adapter 的 SubmitEmail 和 Monitoring 使用本机替身。[验收 Issue #85](https://github.com/omajilmanbo/poolduck-mail/issues/85) · [M07](business-requirements-matrix.md#M07) · [H01](business-requirements-matrix.md#H01) · [O04](business-requirements-matrix.md#O04) · [O06](business-requirements-matrix.md#O06)

## AC2 三种结果的追踪

| 场景 | 任务、attempt 与调用 |
| --- | --- |
| 首次接受 | `sent`，一次成功尝试及对应的提交回执。 |
| 临时配额拒绝 | `queued`，有 `retry_scheduled` 及 `OCI_QUOTA_REJECTED`。同一任务约 30.16 秒后重试成功，共两次调用。 |
| 永久认证拒绝 | `failed`，一条 `OCI_AUTH_REJECTED` 尝试，无重试安排，共一次调用。 |

3 笔任务、4 次调用与 4 条尝试逐笔对应，同租户内对账任务、Message-ID 和审计。两笔成功尝试均核对了回执。已有的五套契约与相关回归测试通过 66 项。

内部原因保持可追溯。操作员读到的历史、详情和工作台却都用通用的“邮件发送失败”表示这两类拒绝。安全原因的展示由 [#217](https://github.com/omajilmanbo/poolduck-mail/issues/217) 跟踪。本轮永久失败样本为认证拒绝。

## AC3 应用侧脱敏样本

| 表面 | 样本 |
| --- | ---: |
| 浏览器实际收到的扫码及投递响应 | 25 |
| 同会话另行读取的扫码／邮件列表与详情响应 | 16 |
| 工作台观察时点 | 2 |
| 后端 stdout 行 | 72 |
| 应用审计行 | 12 |
| 本机 fake Monitoring 上报的聚合指标项 | 7 |

受检的完整合成收件地址、正文及原始错误标记在各样本中均为 0 命中。已授权人员编辑属于独立的资料维护契约。目标云端有效配额、日志与保留、真实指标及告警送达仍待单独验证。[配额 #139](https://github.com/omajilmanbo/poolduck-mail/issues/139) · [OCI 日志与告警 #142](https://github.com/omajilmanbo/poolduck-mail/issues/142)

<a id="safe-failure-branch"></a>

## #217 的样本校正与 #218 分支验收

#85 在 `a052518` 的永久失败样本为 `OCI_AUTH_REJECTED`。补充 Issue 已按原样本校正。停止投递是修复分支新增的覆盖场景。[更正后的 #217](https://github.com/omajilmanbo/poolduck-mail/issues/217) · [原始候选发布记录](https://github.com/omajilmanbo/poolduck-mail/blob/12bc4e1d2189525005eab19c99d9323ee0debbb5/docs/testing/candidate-issue85-application-acceptance-2026-11-20.md)

| 版本 | 应用侧结果 |
| --- | --- |
| 固定候选 `a052518` | 临时配额与永久发信认证拒绝可从内部 attempt 和审计分别追溯，普通操作员在界面只看到同一通用提示。 |
| #218 早期提交 `43ba025` | 可分别显示配额拒绝与停止投递。加入原始认证拒绝样本后，定向回归仍有一项失败。 |
| #218 提交 `d2375a7` | 四类 HTTP 读取及实际工作台均验证三种提示。配额拒绝显示等待自动重试，约 30.17 秒后同一任务成功。永久发信认证拒绝仅 1 次尝试、无排期，操作员会话继续有效。停止投递仅 1 次尝试、无排期，提示独立可区分。 |

`d2375a7` 本机后端 284 项、前端 73 项通过。验收使用本机 fake OCI 客户端，真实发送为零。该提交首轮 GitHub CI 四项通过。Critical E2E 的 mock 成功模式 9/10，取消后退出重登时等待租户码输入框超时。同一提交复跑后五项通过。分支待独立审查及合并。[修复提交](https://github.com/omajilmanbo/poolduck-mail/commit/d2375a77111ba8ab7e22b2d57a9e0ba54553cffb) · [#218 验收正文](https://github.com/omajilmanbo/poolduck-mail/pull/218) · [第二次 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44626762941/attempts/2) · [失败作业](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44626762941/job/135924670074)
