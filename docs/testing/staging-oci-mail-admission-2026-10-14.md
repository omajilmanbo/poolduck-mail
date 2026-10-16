# OCI Staging 不发信准入预检记录（2026-10-14）

核查时间：2026-10-14 08:30–08:40 UTC。范围仅为只读及本地测试；未更改 Staging 配置，未调用 `SubmitEmail`，未发送真实邮件。执行依据：[OCI Staging 执行卡](../oci-mail-staging-operator-runbook.md)。

| 项目 | 结果 | 脱敏证据 |
|---|---|---|
| 代码回归 | 通过 | 本地 Backend Jest：30 suites、247 tests 通过；邮件相关子集：7 suites、81 tests 通过。 |
| 部署版本与运行门禁 | 通过 | Staging commit `45fbaf9`；Backend healthy；`APP_ENV=staging`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`；Backend `127.0.0.1:3001/health` 与公网 `/health` 均为 HTTP 200。 |
| 迁移与现有备份 | 有条件通过 | Prisma：16 个迁移，数据库 schema up to date。现有备份约 33.7 MB，`pg_restore -l` 可解析；备份目录权限 700。此备份不是未来启用窗口的当次备份，启用前须重做。 |
| 队列与地址范围 | 部分通过 | `mail_jobs` 仅有历史终态：canceled 9、failed 1、sent 56,592；无 waiting/queued/claimed。active 人员记录 4,200 条，非占位邮箱 1 条。未导出地址；未来启用前仍须复核唯一受控目标。 |
| 发件域与 DNS | 通过 | OCI Email Domain `mail.poolducktest.com` 与 approved sender 均为 ACTIVE；公共 DNS：SPF 1 条并含 OCI AP include，DKIM CNAME 1 条指向 OCI，DMARC 1 条且 `p=none`。 |
| 实例身份与 IAM 结构 | 部分通过 | 目标 Backend 容器可取得 Instance Principal，未输出 token。Dynamic Group 为 ACTIVE 且规则仅匹配单一实例；发信 policy 为 ACTIVE，仅 1 条精确 sender/domain 条件的 `use approved-senders`，无 `manage email-family` 等宽泛管理授权。实际 HTTPS `SubmitEmail` 正向授权及无关身份／sender 负面效果仍未验证。 |
| OCI 日志与告警 | 部分通过 | `OutboundAccepted`、`OutboundRelayed` 两类日志均 ACTIVE、enabled、保留 90 天；9 条邮件告警均 ACTIVE、enabled。Notifications 邮箱订阅与合成通知送达已在此前确认；本次未重新触发通知，也未产生真实邮件事件。 |
| 有效配额 | 待核 | 既有 OCI Limits 查询有 service 级数值，但 Staging compartment 的 `resource-availability` 为空；不能宣称已证实有效分钟／每日／单封容量。应用 20 次/秒不代表 OCI 配额。 |
| 人工决策与真实发信 | 待核 | 用户已审阅并接受修订版 Runbook。用户选择今晚只备份并保持 `mock/false`，明天值守时再切换；具体启用与观察窗口、受控目标及当次回滚操作者仍须在切换前确认。 |

结论：不发信工程预检已完成上述可核项目，但**真实发信准入尚未通过**。继续保持 `mock/false`。下一阶段先补齐有效配额与人工决策、当次备份和实时复核；真实 `SubmitEmail`、accepted/relayed 事件及收件验证只能在另行批准的受控窗口内进行。

备注：OCI CLI 在本机打印 PowerShell `Get-Acl` 自动加载警告，但上述只读调用返回退出码 0 且有效 JSON；警告不应误判为 OCI 身份验证失败。对前端端口 3000 的 `/health` 探测为 404，使用部署文档所列 Backend 端口 3001 复核为 200。

## 2026-10-14 08:59 UTC 备份补充

用户要求备份并准备真实模式，但确认明天值守时才切换。Staging 在 `/opt/poolduck-mail/backups/` 新建 `poolduck_pre_real_20261014T085913Z.dump`：33,715,540 字节、文件权限 600、目录权限 700；`pg_restore -l` 可解析，SHA-256 为 `c58ad15f157ec02ea5bb188461e93e897912dba9d08abad89b14fd724220a525`。备份后实际 Backend 门禁仍为 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`；未切换、未发信。明天启用前须重新核查版本、待发队列、测试地址和健康状态，并建立当次备份；今晚备份只是当前检查点，不代替明天启用时的备份。
