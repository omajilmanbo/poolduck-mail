# External Services Inventory（外部服务台账）

> 目的：记录系统依赖的外部服务、用途、环境覆盖与管理责任。

## 1. 服务台账

| 服务类别 | 服务名称（可占位） | 用途 | Local | Staging | Production | 配置/凭据保存位置 | 负责人 | 备注 |
|---|---|---|---|---|---|---|---|---|
| CI/CD | GitHub Actions | 构建、测试、发布流程 | Yes | Yes | Yes | Repo workflow + Secrets | 人工指定 | 与 `docs/workflow.md` 对齐 |
| Database | PostgreSQL | 业务数据存储 | Yes（本地） | Yes（独立实例） | Yes（独立实例） | Infra config + Secrets | 人工指定 | 版本建议 16 |
| Mail Provider | Sandbox/Mock（MVP） | 邮件任务验证 | Yes | Yes | TBD | Secret Manager / Config | 人工指定 | 生产 provider 待决策 |
| DNS | Domain provider | `app.poolducktest.com` 解析 | No | Yes | TBD | DNS 控制台 | 人工指定 | 仅保存 A record，不把 provider 凭据放到 VM |
| TLS Certificate | Let's Encrypt | Staging HTTPS 证书 | No | Yes | TBD | Caddy `/data` volume | 人工指定 | Caddy 通过 HTTP-01 自动签发与续期 |
| Hosting Platform | OCI Always Free | 前后端托管 | Local machine | Yes | TBD | OCI Console + IaC | 人工指定 | Staging 单 VM + Docker Compose |
| Monitoring/Logging | TBD | 日志、指标、告警 | Local logs | TBD | TBD | 平台配置 + Secrets | 人工指定 | 生产需告警通道 |
| Backup Storage | TBD | 备份文件存储 | Optional | TBD | TBD | 存储控制台 + Secrets | 人工指定 | 不记录真实存储 key |

## 2. 维护规则

- 外部服务新增、替换、下线时，必须同步更新本台账。
- 若服务影响生产稳定性，需在 PR 中说明风险与回滚方案。
- 对外服务账号建议最小权限分配，并记录 owner 与交接人。
