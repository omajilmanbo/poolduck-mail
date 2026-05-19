# 部署说明（Local / Staging / Production）

## 1. 环境划分

- Local：开发调试环境
- Staging：预发布验证环境
- Production：正式生产环境

## 2. 基础依赖

- 应用运行时（待技术栈 ADR 确认）
- PostgreSQL（建议）
- 邮件服务配置（SMTP 或第三方 provider）

## 3. 环境变量

参考 `.env.example`，至少包括：
- `APP_ENV`
- `APP_PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `MAIL_PROVIDER`
- `MAIL_SMTP_HOST` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`

## 4. Local 部署

- 复制 `.env.example` 为 `.env.local`
- 启动数据库与依赖服务
- 启动后端与前端开发服务

## 5. Staging 部署

- 使用独立数据库与邮件沙箱配置
- 自动化部署后执行 smoke test
- 验证订阅、权限、扫码链路

## 6. Production 部署

- 必须经过 staging 验证
- 执行数据库 migration（先备份）
- 配置监控告警（登录失败率、邮件失败率）
- 逐步发布或低峰发布
