# Environment Parameters（环境参数表）

> 目的：集中记录环境变量参数定义及环境差异。
>
> 安全要求：**不写入真实 secret 值**。如为敏感参数，只记录“Secret / Placeholder / 示例值”。

## 1. 参数表

| 变量名 | 用途 | Local | Staging | Production | 是否 Secret | 备注 |
|---|---|---|---|---|---|---|
| APP_ENV | 运行环境标识 | `development` | `staging` | `production` | No | 与部署环境一致 |
| APP_PORT | Backend 监听端口 | `3001` | `TBD` | `TBD` | No | 仅记录端口，不含访问凭据 |
| FRONTEND_PORT | Frontend 本地端口 | `3000` | `TBD` | `TBD` | No | 若非容器部署可保持 TBD |
| API_BASE_URL | 前端访问 API 地址 | `http://localhost:3001` | `TBD` | `TBD` | No | 仅写 URL，不写 token |
| DATABASE_URL | 数据库连接串 | `example://local-placeholder` | `Secret` | `Secret` | Yes | 不写真实值 |
| JWT_SECRET | JWT 签名密钥 | `local-placeholder` | `Secret` | `Secret` | Yes | 不写真实值 |
| REFRESH_TOKEN_SECRET | 刷新令牌签名密钥 | `local-placeholder` | `Secret` | `Secret` | Yes | 不写真实值 |
| MAIL_PROVIDER | 邮件 provider 类型 | `sandbox` | `sandbox` | `TBD` | No | MVP 优先 sandbox/mock |
| MAIL_FROM_ADDRESS | 发件地址标识 | `no-reply@example.local` | `Secret/Placeholder` | `Secret/Placeholder` | Yes | 不写真实邮箱账号凭据 |
| LOG_LEVEL | 日志级别 | `debug` | `info` | `info` | No | 按环境调整 |
| CORS_ORIGIN | CORS 白名单 | `http://localhost:3000` | `TBD` | `TBD` | No | 多域名时用逗号分隔（示例） |
| TENANT_CONTEXT_ENFORCED | 租户上下文强制开关 | `true` | `true` | `true` | No | 避免跨租户访问 |

## 2. 维护规则

- 新增环境变量时，必须同步更新本表。
- 参数含义变化、默认值变化、是否 Secret 变化时，必须同步更新本表。
- 环境变量删除时，需标注移除日期并从部署配置中清理。
