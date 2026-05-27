# Secrets Inventory（Secrets 台账）

> 本文件只记录 Secret **名称、用途、保存位置、使用环境、负责人**，不记录 Secret 内容。
>
> 严禁写入：真实密码、token、refresh token、API key、生产数据库连接串、客户数据。

## 1. Secrets 台账

| Secret 名称 | 用途 | 保存位置 | 使用环境 | 负责人 | 备注 |
|---|---|---|---|---|---|
| DATABASE_URL | 数据库连接串 | GitHub Secrets / Secret Manager（TBD） | Staging / Production | 人工管理 | 不写真实值 |
| JWT_SECRET | Access Token 签名 | GitHub Secrets / Secret Manager（TBD） | Staging / Production | 人工管理 | 定期轮换 |
| REFRESH_TOKEN_SECRET | Refresh Token 签名 | GitHub Secrets / Secret Manager（TBD） | Staging / Production | 人工管理 | 定期轮换 |
| MAIL_PROVIDER_API_KEY | 邮件服务认证 | GitHub Secrets / Secret Manager（TBD） | Staging / Production | 人工管理 | MVP 阶段优先 sandbox |
| MAIL_FROM_ADDRESS | 发件地址标识 | GitHub Secrets / Config Store（TBD） | Staging / Production | 人工管理 | 仅记录名称 |
| DB_BACKUP_STORAGE_CREDENTIAL | 备份存储访问凭据 | Secret Manager（TBD） | Production | 人工管理 | 仅记录名称 |
| MONITORING_DSN | 监控/告警接入参数 | GitHub Secrets / Secret Manager（TBD） | Staging / Production | 人工管理 | 不写真实值 |

## 2. 轮换与审计建议

- 至少每季度检查一次 Secret 是否需要轮换。
- 权限变更（人员离职/角色变更）后应触发专项轮换。
- PR 与文档审查时，重点检查是否误提交真实 Secret。
