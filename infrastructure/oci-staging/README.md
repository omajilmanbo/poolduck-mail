# OCI Always Free Staging IaC（Issue #48）

本目录为 Poolduck Mail 的 OCI Always Free Staging 基础设施准备清单提供 Terraform IaC。目标 compartment 已由人工创建，显示名称为 `Mail_project_stg`；Terraform 实施时必须提供该 compartment 的 OCID。

## 资源范围

Terraform 将准备以下 Staging 资源：

- Staging VCN、Public Subnet、Internet Gateway、Route Table。
- Web/API NSG：开放 SSH、HTTP、HTTPS；SSH 必须收窄到管理员固定 IP。
- DB NSG：PostgreSQL `5432` 仅允许 Staging 子网访问，禁止公网访问。
- Always Free Compute：默认 `VM.Standard.A1.Flex`，用于 MVP Staging 单机承载 Frontend / Backend / PostgreSQL 16 容器。
- Object Storage Bucket：用于 Staging 非真实数据备份与运维产物归档，并配置生命周期自动清理。
- Cloud-init：只安装 Docker、创建目录和占位配置，不写入真实 secrets，不自动启动应用。

## Always Free 人工确认项

执行 `terraform apply` 前必须由人工确认：

1. `region` 是 OCI tenancy home region；Oracle 文档说明 Always Free compute / Autonomous Database 等资源需在 home region 创建。
2. `Mail_project_stg` compartment 的 OCID 正确。
3. A1 Flex 免费池仍有可用 OCPU/内存；若容量不足，可人工改为 `VM.Standard.E2.1.Micro` 后重新评估 Node.js + PostgreSQL 资源占用。
4. `admin_ssh_cidr` 已替换为管理员固定公网 IP/CIDR，禁止使用 `0.0.0.0/0`。
5. `ssh_public_key` 只包含公钥；私钥、API key、数据库密码、JWT secret、邮件 token 不得提交到仓库。
6. Object Storage 使用量和 Block Volume 使用量没有超出当前账户 Always Free 额度。

## 手工实施流程

```bash
cd infrastructure/oci-staging
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars：填写真实 compartment OCID、region、SSH 公钥、管理员 CIDR。
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
# 人工审核 plan 后才允许执行：
terraform apply tfplan
```

## 非范围声明

- 本 IaC 不创建 Production 资源。
- 本 IaC 不接入真实邮件服务；MVP Staging 仍使用 mock/sandbox provider。
- 本 IaC 不写入或生成任何真实 secret。
- 本 IaC 不自动部署 Poolduck Mail 应用镜像；应用发布流程由后续 Issue 单独定义。
- 本 IaC 不创建 OCI Autonomous Database，因为当前 ADR-004 已确定 MVP 数据库为 PostgreSQL 16。

## 参考

- OCI Always Free 官方文档：`https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm`
- Terraform OCI Provider：`https://registry.terraform.io/providers/oracle/oci/latest`
