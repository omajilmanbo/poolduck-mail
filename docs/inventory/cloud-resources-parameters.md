# Cloud Resources Parameters (cloud resource parameter table)

> Purpose: Record the **non-sensitive parameters** and responsibility of cloud platform infrastructure resources (such as EC2/RDS/VPC/LB, etc.).
>
> Security requirements: Only record resource name, type, purpose, environment, specifications and identification; **Do not record access keys, passwords, tokens, private keys, and real connection strings**.

## 1. Resource parameter ledger

| Cloud resource type | Resource name (can be desensitized) | Purpose | Local | Staging | Production | Key parameters (non-sensitive) | Parameter examples | Save location | Person in charge | Remarks |
|---|---|---|---|---|---|---|---|---|---|---|
| Compute (OCI VM) | `poolduck-mail-stg-app-01` | Hosting Staging Frontend / Backend API / PostgreSQL 16 container | N/A | Terraform: `infrastructure/oci-staging/` (to be manually applied) | TBD | shape / region / subnet / NSG | `VM.Standard.A1.Flex` / `home region` / `poolduck-mail-stg-public-subnet` / `web-nsg,db-nsg` | `docs/inventory/` + IaC | Manually specified | Issue #48; Default is Always Free, manual quota confirmation is required |
| Container Service (ECS/K8s) | `tbd-api-cluster` | Container orchestration and scaling | N/A | TBD | TBD | cluster/service name / task cpu&memory / desired count | `api-service` / `512cpu-1024mb` / `2` | `docs/inventory/` + IaC | Manually specified | With EC2 Choose one of two options or mix |
| Load Balancer (ALB/NLB) | `tbd-public-alb` | External traffic access | N/A | TBD | TBD | listener port / target group / health check path | `443` / `tg-api` / `/health` | `docs/inventory/` + IaC | Manually specified | Only records rules, not certificate private keys |
| Database (PostgreSQL) | `poolduck-mail-stg-postgres` | Staging structured data storage | Local PostgreSQL | Terraform host PostgreSQL 16 container (to be manually deployed) | TBD | engine/version/network exposure/backup target | `PostgreSQL 16` / `5432 private only` / `Object Storage bucket` | `docs/inventory/` + IaC | Manually specified | Not using Autonomous Database as ADR-004 specifies PostgreSQL 16 |
| Network (OCI VCN/Subnet) | `poolduck-mail-stg-vcn` | Staging network isolation | N/A | Terraform: `infrastructure/oci-staging/` (to be manually applied) | TBD | vcn cidr / subnet cidr / route policy | `10.48.0.0/16` / `10.48.10.0/24` / IGW default route | `docs/inventory/` + IaC | Manually specified | Production must not be reused |
| Security (OCI NSG) | `poolduck-mail-stg-web-nsg` / `poolduck-mail-stg-db-nsg` | Staging inbound/outbound access control | Local firewall | Terraform: `infrastructure/oci-staging/` (to be manually applied) | TBD | ingress/egress rule summary | `22 admin CIDR` / `80,443 public` / `5432 staging subnet only` | `docs/inventory/` + IaC | Manually specified | SSH CIDR must be narrowed before implementation |
| Storage (OCI Object Storage) | `poolduck-mail-stg-backups` | Staging backup and log archiving | Optional | Terraform: `infrastructure/oci-staging/` (to be manually applied) | TBD | bucket/region/lifecycle/retention | `NoPublicAccess` / `home region` / `DELETE after 30d` | `docs/inventory/` + IaC | Manually specified | The access key is not written to this document; PII must not be saved |
| DNS (Route53/Cloud DNS) | `tbd-zone` | Domain name resolution | N/A | TBD | TBD | hosted zone / record type / ttl | `api.stg.example.com` / `A` / `60` | DNS console + `docs/inventory/` | Manually specified | The domain name is undetermined and available space |
| TLS Certificate (ACM/CA) | `tbd-cert-api` | HTTPS Certificate | N/A | TBD | TBD | cert provider / domains / expiry owner | `ACM` / `*.example.com` | Certificate console + `docs/inventory/` | Manually specified | Private key and issuance credentials are not lost |
| Observability (CloudWatch/3rd) | `tbd-monitoring` | Monitoring, alarming, log aggregation | Local logs | TBD | TBD | log group / metrics / alert channel | `api-prod-log` / `5xx alarm` | Monitoring platform + `docs/inventory/` | Manual specification | webhook/token only Secrets |

## 2. Maintenance rules

- When cloud resources are added, specifications are changed, regions are migrated, or deleted, this table must be updated simultaneously.
- Changes in key parameters must indicate the impact environment, risks and rollback plan in the PR.
- Any sensitive values (keys, passwords, connection strings, private keys) are only recorded in the "Name/Location" dimension of `docs/inventory/secrets-inventory.md`, and no real values are written.
