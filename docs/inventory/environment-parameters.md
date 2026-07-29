# Environment Parameters（环境参数表）

> 目的：集中记录环境变量参数定义及环境差异。
>
> 安全要求：**不写入真实 secret 值**。如为敏感参数，只记录“Secret / Placeholder / 示例值”。

## 1. 参数表

| 变量名 | 用途 | Local | Staging | Production | 是否 Secret | 备注 |
|---|---|---|---|---|---|---|
| APP_ENV | 运行环境标识 | `local` | `staging` | `production` | No | 与部署环境一致 |
| APP_PORT | Backend 监听端口 | `3001` | `127.0.0.1:3001`（宿主机绑定） | `TBD` | No | Staging 由反向代理访问 |
| FRONTEND_PORT | Frontend 本地端口 | `3000` | `127.0.0.1:3000`（宿主机绑定） | `TBD` | No | Staging 由反向代理访问 |
| API_BASE_URL | 前端访问 API 地址 | `http://localhost:3001` | `https://app.poolducktest.com` | `TBD` | No | Staging 使用同源 HTTPS |
| POSTGRES_DB | PostgreSQL 数据库名 | `poolduck_mail` | `poolduck_mail_staging` | `TBD` | No | 与环境隔离 |
| POSTGRES_USER | Local PostgreSQL 用户名 | `poolduck_local` | `Secret/Placeholder` | `Secret/Placeholder` | Yes | Local 为示例值，不用于真实环境 |
| POSTGRES_PASSWORD | Local PostgreSQL 密码 | `poolduck_local_password` | `Secret` | `Secret` | Yes | Local 为示例值，不用于真实环境 |
| POSTGRES_PORT | PostgreSQL 端口 | `5432` | `5432`（Compose 内部，不公网暴露） | `TBD` | No | Local 冲突时可映射为 `5433` |
| DATABASE_URL | 数据库连接串 | `postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail` | `Secret` | `Secret` | Yes | Local 为 compose 示例值；不写真实环境值 |
| JWT_SECRET | JWT 签名密钥 | `local-placeholder` | `Secret` | `Secret` | Yes | 不写真实值 |
| REFRESH_TOKEN_SECRET | 刷新令牌签名密钥 | `local-placeholder` | `Secret` | `Secret` | Yes | 不写真实值 |
| MAIL_PROVIDER | 邮件 provider 类型 | `mock` | `sandbox` | `TBD` | No | MVP 优先 sandbox/mock |
| MAIL_FROM_ADDRESS | 发件地址标识 | `no-reply@example.local` | `Secret/Placeholder` | `Secret/Placeholder` | Yes | 不写真实邮箱账号凭据 |
| LOG_LEVEL | 日志级别 | `debug` | `info` | `info` | No | 按环境调整 |
| CORS_ORIGIN | CORS 白名单 | `http://localhost:3000` | `https://app.poolducktest.com` | `TBD` | No | 禁止通配 origin |
| TENANT_CONTEXT_ENFORCED | 租户上下文强制开关 | `true` | `true` | `true` | No | 避免跨租户访问 |

## 2. 维护规则

- 新增环境变量时，必须同步更新本表。
- 参数含义变化、默认值变化、是否 Secret 变化时，必须同步更新本表。
- 环境变量删除时，需标注移除日期并从部署配置中清理。

## 3. Staging baseline for Issue #37

This section refines the Staging column for the current OCI Always Free MVP design. Do not record real secret values here.

| Variable | Staging baseline | Secret | Required before deploy | Notes |
|---|---|---|---|---|
| `APP_ENV` | `staging` | No | Yes | Fixed value. |
| `APP_PORT` | `3001` | No | Yes | May change only if a reverse proxy/container mapping requires it. |
| `FRONTEND_PORT` | `3000` | No | Yes | May change only if a reverse proxy/container mapping requires it. |
| `API_BASE_URL` | `https://app.poolducktest.com` | No | Yes | Caddy routes public traffic on the same origin. |
| `NEXT_PUBLIC_API_BASE_URL` | Same public base URL as `API_BASE_URL` | No | Yes | Current frontend code reads this variable. |
| `CORS_ORIGIN` | `https://app.poolducktest.com` | No | Yes | Wildcard CORS is not allowed. |
| `POSTGRES_DB` | `poolduck_mail_staging` or implementation-specific Staging DB name | No | Yes | Real DB name may be local-only if it exposes tenant/account details. |
| `POSTGRES_USER` | `Secret/Placeholder` | Yes | Yes | Do not commit real user names if considered sensitive. |
| `POSTGRES_PASSWORD` | `Secret` | Yes | Yes | Store outside the repo. |
| `POSTGRES_PORT` | `5432` internal/default | No | Yes | Public DB ingress is prohibited. |
| `DATABASE_URL` | `Secret` | Yes | Yes | Staging PostgreSQL only; do not reuse Production. |
| `JWT_SECRET` | `Secret` | Yes | Yes | Staging-only generated value. |
| `REFRESH_TOKEN_SECRET` | `Secret` | Yes | Yes | Staging-only generated value. |
| `MAIL_PROVIDER` | `sandbox` or `mock` | No | Yes | Real provider is out of scope. |
| `MAIL_SMTP_HOST` | `Placeholder` if sandbox SMTP is used | Yes/Placeholder | Conditional | Omit if the mock provider does not need SMTP. |
| `MAIL_SMTP_PORT` | Sandbox SMTP port if used | No | Conditional | Omit if the mock provider does not need SMTP. |
| `MAIL_SMTP_USER` | `Secret` if sandbox SMTP is used | Yes | Conditional | Do not commit. |
| `MAIL_SMTP_PASS` | `Secret` if sandbox SMTP is used | Yes | Conditional | Do not commit. |
| `MAIL_FROM_ADDRESS` | `Secret/Placeholder` | Yes | Yes | Must not be a production sender. |
| `LOG_LEVEL` | `info` | No | Yes | Use `debug` only temporarily. |
| `TENANT_CONTEXT_ENFORCED` | `true` | No | Yes | Mandatory for Staging. |

Human operators must provide or confirm the required values before Staging deployment. If any required value is missing, agents must stop and report the missing item instead of inventing a default.
