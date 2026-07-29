# Cloud Resources Parameters（云资源参数表）

> 目的：记录云平台基础设施资源（如 EC2/RDS/VPC/LB 等）的**非敏感参数**与责任归属。
>
> 安全要求：仅记录资源名称、类型、用途、环境、规格与标识；**不记录访问密钥、密码、token、私钥、真实连接串**。

## 1. 资源参数台账

| 云资源类型 | 资源名称（可脱敏） | 用途 | Local | Staging | Production | 关键参数（非敏感） | 参数示例 | 保存位置 | 负责人 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| Compute（OCI VM） | `poolduck-mail-stg-app-01` | 承载 Staging Frontend / Backend API / PostgreSQL 16 容器 | N/A | Terraform 已实施；2026-07-09 完成重建验证 | TBD | shape / region / subnet / NSG | `VM.Standard.A1.Flex` / `home region` / `poolduck-mail-stg-public-subnet` / `web-nsg,db-nsg` | `docs/inventory/` + IaC | 人工指定 | 操作前实时复核 OCI/Terraform 状态与配额 |
| Container Service（ECS/K8s） | `tbd-api-cluster` | 容器编排与扩缩容 | N/A | TBD | TBD | cluster/service name / task cpu&memory / desired count | `api-service` / `512cpu-1024mb` / `2` | `docs/inventory/` + IaC | 人工指定 | 与 EC2 方案二选一或混合 |
| Load Balancer（ALB/NLB） | `tbd-public-alb` | 对外流量接入 | N/A | TBD | TBD | listener port / target group / health check path | `443` / `tg-api` / `/health` | `docs/inventory/` + IaC | 人工指定 | 仅记录规则，不记录证书私钥 |
| Database（PostgreSQL） | `poolduck-mail-stg-postgres` | Staging 结构化数据存储 | Local PostgreSQL | Staging VM 内 PostgreSQL 16 Compose 容器（已部署） | TBD | engine/version/network exposure/backup target | `PostgreSQL 16` / `5432 private only` / `Object Storage bucket` | `docs/inventory/` + IaC | 人工指定 | 备份恢复策略仍由 #38 跟进 |
| Network（OCI VCN/Subnet） | `poolduck-mail-stg-vcn` | Staging 网络隔离 | N/A | Terraform 已实施 | TBD | vcn cidr / subnet cidr / route policy | `10.48.0.0/16` / `10.48.10.0/24` / IGW default route | `docs/inventory/` + IaC | 人工指定 | Production 不得复用；操作前复核 state |
| Security（OCI NSG） | `poolduck-mail-stg-web-nsg` / `poolduck-mail-stg-db-nsg` | Staging 入站/出站访问控制 | Local firewall | Terraform 已实施 | TBD | ingress/egress rule summary | `22 admin CIDR` / `80,443 public` / `5432 staging subnet only` | `docs/inventory/` + IaC | 人工指定 | 2026-07-29 人工批准 Web 公网入口；SSH 与内部端口未扩大 |
| Storage（OCI Object Storage） | `poolduck-mail-stg-backups` | Staging 备份与日志归档 | Optional | 由 Terraform 管理；使用前复核实际 state | TBD | bucket/region/lifecycle/retention | `NoPublicAccess` / `home region` / `DELETE after 30d` | `docs/inventory/` + IaC | 人工指定 | #38 未完成前不得视为已具备可恢复备份 |
| DNS | `app.poolducktest.com` | Staging 域名解析 | N/A | A record 指向 Staging VM | TBD | record type / target / ttl | `A` / Staging public IP / provider-managed TTL | DNS 控制台 + `docs/inventory/` | 人工指定 | DNS provider 凭据不进入 VM 或仓库 |
| TLS Certificate | `app.poolducktest.com` | Staging HTTPS 证书 | N/A | Caddy + Let's Encrypt ACME HTTP-01 | TBD | cert provider / domain / lifecycle owner | `Let's Encrypt` / single host / Caddy automatic renewal | Caddy `/data` volume + container logs | 人工指定 | 私钥与 ACME 状态不落库 |
| Observability（CloudWatch/3rd） | `tbd-monitoring` | 监控、告警、日志聚合 | Local logs | TBD | TBD | log group / metrics / alert channel | `api-prod-log` / `5xx alarm` | 监控平台 + `docs/inventory/` | 人工指定 | webhook/token 仅存 Secrets |

## 2. 维护规则

- 云资源新增、变更规格、迁移区域、删除时，必须同步更新本表。
- 关键参数变更必须在 PR 中标注影响环境、风险与回滚方案。
- 任何敏感值（密钥、口令、连接串、私钥）仅记录在 `docs/inventory/secrets-inventory.md` 的“名称/位置”维度，不写真实值。
