# Cloud Resources Parameters（云资源参数表）

> 目的：记录云平台基础设施资源（如 EC2/RDS/VPC/LB 等）的**非敏感参数**与责任归属。
>
> 安全要求：仅记录资源名称、类型、用途、环境、规格与标识；**不记录访问密钥、密码、token、私钥、真实连接串**。

## 1. 资源参数台账

| 云资源类型 | 资源名称（可脱敏） | 用途 | Local | Staging | Production | 关键参数（非敏感） | 参数示例 | 保存位置 | 负责人 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| Compute（EC2/VM） | `tbd-backend-ec2` | 承载 Backend API | N/A | TBD | TBD | instance type / region / subnet / security group | `t3.small` / `ap-southeast-1` / `subnet-***` | `docs/inventory/` + IaC | 人工指定 | 未定云平台可保留 TBD |
| Container Service（ECS/K8s） | `tbd-api-cluster` | 容器编排与扩缩容 | N/A | TBD | TBD | cluster/service name / task cpu&memory / desired count | `api-service` / `512cpu-1024mb` / `2` | `docs/inventory/` + IaC | 人工指定 | 与 EC2 方案二选一或混合 |
| Load Balancer（ALB/NLB） | `tbd-public-alb` | 对外流量接入 | N/A | TBD | TBD | listener port / target group / health check path | `443` / `tg-api` / `/health` | `docs/inventory/` + IaC | 人工指定 | 仅记录规则，不记录证书私钥 |
| Database（RDS/PostgreSQL） | `tbd-rds-postgres` | 结构化数据存储 | Local PostgreSQL | TBD | TBD | engine/version/instance class/storage/multi-AZ | `postgres16` / `db.t4g.medium` / `100GB` / `true` | `docs/inventory/` + IaC | 人工指定 | 密码与连接串写入 Secrets 台账 |
| Network（VPC/Subnet） | `tbd-vpc-main` | 网络隔离 | N/A | TBD | TBD | vpc cidr / subnet cidr / route policy | `10.0.0.0/16` | `docs/inventory/` + IaC | 人工指定 | CIDR 可脱敏记录 |
| Security（Security Group/WAF） | `tbd-sg-api` | 入站/出站访问控制 | Local firewall | TBD | TBD | ingress/egress rule summary / waf mode | `443 from CDN` / `egress all` | `docs/inventory/` + IaC | 人工指定 | 禁止记录账号密码 |
| Storage（S3/Object Storage） | `tbd-backup-bucket` | 备份与日志归档 | Optional | TBD | TBD | bucket/region/lifecycle/retention | `stg-backup-*` / `90d` | `docs/inventory/` + IaC | 人工指定 | access key 不写入本文档 |
| DNS（Route53/Cloud DNS） | `tbd-zone` | 域名解析 | N/A | TBD | TBD | hosted zone / record type / ttl | `api.stg.example.com` / `A` / `60` | DNS 控制台 + `docs/inventory/` | 人工指定 | 域名未定可用占位 |
| TLS Certificate（ACM/CA） | `tbd-cert-api` | HTTPS 证书 | N/A | TBD | TBD | cert provider / domains / expiry owner | `ACM` / `*.example.com` | 证书控制台 + `docs/inventory/` | 人工指定 | 私钥与签发凭据不落库 |
| Observability（CloudWatch/3rd） | `tbd-monitoring` | 监控、告警、日志聚合 | Local logs | TBD | TBD | log group / metrics / alert channel | `api-prod-log` / `5xx alarm` | 监控平台 + `docs/inventory/` | 人工指定 | webhook/token 仅存 Secrets |

## 2. 维护规则

- 云资源新增、变更规格、迁移区域、删除时，必须同步更新本表。
- 关键参数变更必须在 PR 中标注影响环境、风险与回滚方案。
- 任何敏感值（密钥、口令、连接串、私钥）仅记录在 `docs/inventory/secrets-inventory.md` 的“名称/位置”维度，不写真实值。
