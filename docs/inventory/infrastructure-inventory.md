# Infrastructure Inventory（资源台账）

> 目的：记录 **实际使用** 的基础设施资源与关键参数归属，供 Local / Staging / Production 执行与审计。
>
> 安全要求：本台账仅记录资源名称、用途、环境、参数名、保存位置、负责人；**禁止记录真实密码、token、API key、refresh token、生产数据库连接串**。

## 1. 使用说明

- 本文件用于补充 `docs/infrastructure.md` 的蓝图设计，聚焦“最终落地参数”。
- 若当前环境尚未确定平台或资源，统一填写 `TBD`。
- 如真实资源名称不宜公开，允许使用脱敏名称或占位符（例如 `stg-db-01`、`prod-mail-provider`）。
- 任何基础设施变更（新增、下线、替换、迁移）必须同步更新本台账。

## 2. 资源台账（按环境）

| 资源类别 | 用途 | Local | Staging | Production | 关键参数/标识（非敏感） | 保存位置 | 负责人 | 备注 |
|---|---|---|---|---|---|---|---|---|
| Frontend Hosting | 前端页面托管 | Local process/Compose (`localhost:3000`) | OCI VM / Compose / Nginx reverse proxy | TBD | URL / 域名 / 部署平台 | `docs/inventory/` | 人工指定 | 当前 public-IP HTTP，仅内部验证 |
| Backend API Hosting | API 服务托管 | Local process/Compose (`localhost:3001`) | OCI VM / Compose / Nginx reverse proxy | TBD | Base URL / Runtime / Region | `docs/inventory/` | 人工指定 | 与 Frontend 同 VM、不同容器 |
| PostgreSQL | 业务数据存储 | Docker Compose / PostgreSQL 16 / `5432` | 同一 Staging VM 内独立 PostgreSQL 16 容器 | 独立实例（TBD） | engine/version/port/instance-id | `docs/inventory/` | 人工指定 | 禁止跨环境共用数据库或数据 |
| Mail Provider | 邮件发送能力 | sandbox/mock provider | mock provider（当前） | TBD（正式链路） | provider name / account alias | `docs/inventory/` | 人工指定 | Staging 禁止真实客户投递 |
| Log & Monitoring | 日志、指标、告警 | 本地日志 | 容器日志；集中日志与指标待补齐 | 集中日志、指标、告警（TBD） | service name / project id | `docs/inventory/` | 人工指定 | #39 已定义策略；实际集成另行实施 |
| Backup | 备份与恢复 | 可选（本地快照） | 备份策略（TBD） | 备份策略（TBD） | schedule / retention / storage | `docs/inventory/` | 人工指定 | 不记录真实存储凭据 |
| Deployment Method | 发布方式 | 手工启动（dev） | cloud-init 仅做 bootstrap；人工批准后由操作者/Agent 执行 Compose Runbook，目标为幂等部署脚本 | CI/CD（TBD） | workflow name / runner / approval | `docs/inventory/` | 人工指定 | ADR-005；`workflow_dispatch` 尚未实施 |
| DNS & TLS | 域名与证书 | N/A | 未配置；当前 public-IP HTTP | TBD | domain / cert source / expiry owner | `docs/inventory/` | 人工指定 | #86；扩大测试范围前补齐 |

## 3. 变更记录建议

建议每次变更补充以下信息（可在 PR 描述或变更日志中）：

- 变更日期
- 影响环境（Local/Staging/Production）
- 变更资源类别
- 风险说明与回滚点
- 对应 Issue/PR 链接
