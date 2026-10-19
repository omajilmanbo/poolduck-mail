# OCI Staging 真实邮件执行卡

本页是值守时使用的短清单；设计解释、证据格式和排障方法见
[详细准入参考](oci-mail-staging-readiness.md)。**未取得新的真实发信窗口批准前，保持
`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`；不得调用 `SubmitEmail`。**

## A. 不发信的工程预检

| 检查 | 通过条件 | 不通过时 |
|---|---|---|
| 版本与容器 | 目标 commit 已记录；Backend healthy；当前仍为 mock/false | 停止，不切换 |
| 代码与数据 | #136–#140 测试通过；迁移已审核；当次数据库备份可读取；待发任务及 Staging 人员地址范围已由操作者核查 | 停止，修复并重查；不在记录中列出邮箱 |
| 发件身份 | 预定 region 的 Email Domain、DKIM、approved sender 为 ACTIVE；SPF 唯一，DKIM CNAME 与 DMARC 可解析 | 停止，不更换发件身份绕过问题 |
| IAM | Dynamic Group 仅匹配目标 VM；policy 仅覆盖预定 sender/domain/compartment；容器能取得 Instance Principal；无宽泛邮件管理权限 | 停止，不临时授予 `manage email-family` |
| 配额 | 已核实该 compartment 的有效分钟、每日及单封大小限制；应用 20 次/秒只是阶段性上限 | 有效配额未知则不宣称容量准入通过 |
| 观测 | 两类 OCI 邮件日志、9 条告警、Notifications 订阅及应用指标心跳可用；告警接收人可值守 | 停止，恢复告警链路 |
| 人工决策 | 用途/投诉责任人、启用与观察窗口、测试数据、回滚操作者和停止阈值已确认 | 停止，向用户取得决定 |

记录每项的时间、通过/未通过、脱敏证据位置。OCI 控制面与容器状态应当次复核；
Terraform state 中存在资源**不等于**云端资源当前 ACTIVE。若任何项未知，标记“待核”，不可写成“通过”。

## B. 独立批准后的验证

1. 仅在用户批准新的窗口后，按 [Staging 部署手册](staging-manual.md) 备份当前环境、核对 Compose
   配置并切换 Backend 为 `MAIL_PROVIDER=oci_email_delivery_https`、`REAL_MAIL_SEND_ENABLED=true`。
   两个值缺一不可；不得仅凭已部署代码或本执行卡启动真实发送。
2. 先验证一个经同意的受控任务：核对应用 attempt 与 OCI `OutboundAccepted`、
   `OutboundRelayed`，再核对收件结果。`sent` 只表示 OCI accepted，不表示进入收件箱。
3. 人工确认无异常后，另按批准范围做小批量连续发送与回滚演练。#141 的 HTTPS 正向效果在
   受控提交中验证；有潜在误发风险的负面数据面调用须单独设计和批准，不默认执行。

## C. 停止与回滚

任意误收件、complaint、hard bounce、suppressed、`delivery_unknown`、认证失败、日志缺失、
跨租户或收件快照不符时立即停止；连续 3 次配额拒绝也停止。告警**不会自动停发**。
操作者按 [Staging 部署手册](staging-manual.md) 恢复 `MAIL_PROVIDER=mock`、
`REAL_MAIL_SEND_ENABLED=false` 并重建 Backend，确认健康与实际运行参数。
保留 attempt 和 OCI 日志；`delivery_unknown` 不自动重发，不改写历史终态。
