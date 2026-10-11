# Staging OCI 邮件发布记录（2026-10-11）

- 目标 commit：`5ca587d78073099e04f880122762802090b88680`；仅 Backend 容器以既有 `MAIL_PROVIDER=mock` 环境重建，真实发送未启用。
- 本地验证：Backend typecheck、lint、29 个 Jest suite / 243 项测试、ADR-017 release validation 均通过；`git diff --cached --check` 通过。
- 变更前 Staging 邮件任务状态：`canceled=9`、`failed=1`、`sent=56592`，无 `waiting`、`queued` 或 `processing`；非合成收件人仅 1 条，已由用户确认控制权和接收同意，记录不包含地址。
- 备份：VM `/opt/poolduck-mail/backups/pre-oci-mail-20261011.sql.gz`（33,698,931 字节）；`gzip -t` 和 PostgreSQL dump 完成标志检查通过。升级前已有一个旧的 0 字节备份文件，未作为本次回滚依据，未删除。
- 增量迁移：`20260929000000_add_oci_submission_identifiers`、`20260929001000_index_mail_attempt_provider_invoked_at` 均已应用。Backend `healthy`，本机 `/health` 返回 `status=ok`。
- Backend 容器内 `InstancePrincipalsAuthenticationDetailsProviderBuilder.build()` 成功；未输出 token、未调用 SubmitEmail。此结果仅证明身份获取，不证明 sender policy 的正向或负向提交权限。
- 未完成门禁：#141 的 HTTPS 提交权限效果及无关身份/其他 sender 拒绝验证；#142 的应用级异常自动告警和真实 accepted/relayed 事件验收；#143 真实发信 Runbook 人工复核；compartment 有效 quota 未取得。当前不得把 mock 部署视为真实发信已上线。
- 回滚：先保持或恢复 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，再按 Staging Runbook 重建 Backend；保留已应用增量列与索引、邮件历史、attempt 和 OCI 日志。旧 commit 为 `734a422`，但只有完成兼容性检查后才可回退代码。未向客户发送通知，因为本次仅为 Staging mock 更新。
