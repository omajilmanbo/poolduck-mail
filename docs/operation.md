# 运维与故障排查手册（初版）

## 1. 登录失败

排查步骤：
1. 确认用户状态（active/suspended）
2. 检查密码错误次数与锁定策略
3. 检查认证服务日志（401/403）
4. 检查 JWT_SECRET 或 session 配置是否异常

## 2. 邮件发送失败

排查步骤：
1. 查看 `mail_jobs` 中失败状态与错误信息
2. MVP 阶段优先检查 Sandbox/Mock provider 记录与返回错误
3. 检查收件箱地址格式与域名策略
4. 仅在非 MVP 阶段接入真实 provider 后，再排查 SMTP/provider 凭据与连接性

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
