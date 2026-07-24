# 运维与故障排查手册（初版）

统一的事件、指标、脱敏、保留期和告警阈值见 `docs/observability.md`。Production 日志保留 90 天，初期告警发送到经批准的运维邮箱。

## 1. 登录失败

排查步骤：
1. 使用内部 user ID 确认账号状态（active/inactive），不要在工单或普通日志复制 username/完整邮箱
2. 检查 401 `LOGIN_FAILED` 与 429 `LOGIN_RATE_LIMITED` 聚合指标；不得根据对外响应判断 tenant 或账号是否存在
3. 检查 IP、tenant hash、identifier hash 与组合维度的限流配置是否符合当前流量
4. 检查 `JWT_SECRET`、`REFRESH_TOKEN_SECRET`、`AUTH_IDENTITY_HASH_SECRET` 或 session 配置是否异常

## 2. 邮件发送失败

排查步骤：
1. 查看 `mail_jobs` 中失败状态与错误信息
2. MVP 阶段优先检查 Sandbox/Mock provider 记录与返回错误
3. 检查 `MAIL_MOCK_SEND_RESULT`：`success` 表示模拟成功，`failure` / `failed` 表示模拟失败
4. 检查 `retry_count` 与 `scheduled_at` 是否符合 30 秒、2 分钟、10 分钟退避；三次重试耗尽后应为终态 `failed`
5. 检查是否有长期停留在 `processing` 的异常任务；原子领取应阻止同一任务并发重复发送
6. 重试期间订阅失效时，任务应安全终止为 `failed` / `SUBSCRIPTION_NOT_SENDABLE`
7. 检查收件箱地址格式与域名策略
8. 仅在非 MVP 阶段接入真实 provider 后，再排查 SMTP/provider 凭据与连接性

## 3. 订阅异常

排查步骤：
1. 查看 `subscriptions` 状态与有效期
2. 调用 `/api/license/check` 验证返回
3. 检查时区与过期判断逻辑
4. 确认订阅状态是否属于 `trial` / `active` / `expired` / `suspended` 之一，并核对门禁动作

## 4. 租户隔离异常（高优先级）

排查步骤：
1. 审查请求中的 tenant 上下文
2. 检查 SQL 查询是否包含 tenant_id 过滤
3. 核查审计日志中越权访问记录
4. 立即阻断可疑访问并升级处理

任意跨租户拒绝均按 P1 安全事件处理；确认发生数据读取或误发时升级为 P0。排障只使用 request ID、tenant/resource 内部 ID 和稳定错误码，不复制完整邮箱、姓名、token 或邮件正文。
