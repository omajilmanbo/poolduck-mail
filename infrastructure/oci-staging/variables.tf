# 已存在的 OCI Staging compartment OCID；用户已说明区间名称为 Mail_project_stg，但 Terraform 需要 OCID。
variable "compartment_ocid" {
  description = "OCID of the existing OCI compartment for staging, display name expected to be Mail_project_stg."
  type        = string
}

# OCI home region / 目标 region；Always Free 资源必须由人工确认在 tenancy home region 内实施。
variable "region" {
  description = "OCI region where Always Free resources will be created; must be the tenancy home region for Always Free eligibility."
  type        = string
}

# 资源名前缀，统一标识 Poolduck Mail staging 资源，便于控制台检索和后续清理。
variable "resource_prefix" {
  description = "Prefix for OCI resource display names."
  type        = string
  default     = "poolduck-mail-stg"
}

# Staging VCN CIDR；仅用于预发布环境，不得与 Production 网络复用。
variable "vcn_cidr" {
  description = "CIDR block for the staging VCN."
  type        = string
  default     = "10.48.0.0/16"
}

# Staging 公有子网 CIDR；MVP Always Free 单机部署暂将 Web/API 暴露在该子网。
variable "public_subnet_cidr" {
  description = "CIDR block for the staging public subnet."
  type        = string
  default     = "10.48.10.0/24"
}

# SSH 管理来源；人工实施前必须收窄为管理员固定公网 IP/CIDR，禁止默认 0.0.0.0/0。
variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH to the staging compute instance. Replace with an admin fixed public IP/CIDR before apply."
  type        = string
  default     = "203.0.113.10/32"
}

# 业务 HTTP 来源；未接入 TLS/反向代理前可临时开放 80 供 smoke test，实施后建议收窄或改为 443。
variable "http_ingress_cidr" {
  description = "CIDR allowed to reach HTTP port 80 for staging smoke tests."
  type        = string
  default     = "0.0.0.0/0"
}

# 业务 HTTPS 来源；预留给后续配置 TLS / reverse proxy 使用。
variable "https_ingress_cidr" {
  description = "CIDR allowed to reach HTTPS port 443."
  type        = string
  default     = "0.0.0.0/0"
}

# SSH 公钥内容；只保存公钥，不保存私钥。
variable "ssh_public_key" {
  description = "SSH public key authorized for the staging compute instance. Do not put private keys in this repository."
  type        = string
  sensitive   = true
}

# Always Free 推荐首选 A1 Flex；若 home region 容量不足，人工可改为 VM.Standard.E2.1.Micro，但需重新评估应用资源占用。
variable "instance_shape" {
  description = "OCI Always Free compute shape for the staging instance."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

# #116 拟调整目标；2026-09-08 官方免费池为 2 OCPU / 12 GB，实施前核对 tenancy 剩余额度。
variable "instance_ocpus" {
  description = "OCPUs for VM.Standard.A1.Flex. Ignored for non-Flex shapes."
  type        = number
  default     = 2
}

# A1 Flex 内存；与 2 OCPU 配套的拟调整目标，修改默认值不代表现有 VM 已扩容。
variable "instance_memory_gb" {
  description = "Memory in GB for VM.Standard.A1.Flex. Ignored for non-Flex shapes."
  type        = number
  default     = 12
}

# #116 启动盘目标 100 GB，容纳 PostgreSQL 数据、镜像和日志；扩容后不能原地缩小。
variable "boot_volume_size_gb" {
  description = "Boot volume size for the compute instance."
  type        = number
  default     = 100
}

# Ubuntu 版本；cloud-init 以 Ubuntu 为目标系统安装 Docker 与基础目录。
variable "instance_image_ocid" {
  description = "Pinned launch image OCID for an existing VM; null selects the latest compatible image for initial provisioning."
  type        = string
  default     = null
}

variable "ubuntu_os_version" {
  description = "Canonical Ubuntu image version used by the staging compute instance."
  type        = string
  default     = "22.04"
}

# Object Storage bucket 名；bucket namespace 全局由 tenancy 决定，bucket 名在 namespace 内唯一。
variable "backup_bucket_name" {
  description = "Object Storage bucket name for staging database backups and operational artifacts."
  type        = string
  default     = "poolduck-mail-stg-backups"
}

# 备份保留天数；Staging 只保留短周期非真实数据备份，避免占用 Always Free Object Storage 容量。
variable "backup_retention_days" {
  description = "Number of days to retain staging backup objects."
  type        = number
  default     = 30
}

# 项目与环境标签；OCI defined tags 需预先创建 namespace，本 IaC 仅使用 freeform tags。
variable "freeform_tags" {
  description = "Common freeform tags for all staging resources."
  type        = map(string)
  default = {
    project     = "poolduck-mail"
    environment = "staging"
    managed_by  = "terraform"
    issue       = "48"
  }
}

# ADR-019: these public identifiers are approved for Staging only. No DNS
# provider credential or OCI-generated DNS record value is stored in Terraform.
variable "email_domain_name" {
  description = "Approved staging Email Delivery domain."
  type        = string
  default     = "mail.poolducktest.com"
}

variable "email_dkim_selector" {
  description = "Existing OCI DKIM selector, imported into Terraform state."
  type        = string
  default     = "stg202610"
}

variable "email_sender_address" {
  description = "Exact approved staging sender address; not a recipient allowlist."
  type        = string
  default     = "no-reply@mail.poolducktest.com"
}

variable "tenancy_ocid" {
  description = "Tenancy OCID for the optional Dynamic Group and root-compartment IAM policy."
  type        = string
  default     = null
}

variable "enable_email_instance_principal" {
  description = "Create the narrowly scoped staging Dynamic Group and IAM policy only after separate policy approval."
  type        = bool
  default     = false
}

variable "email_log_retention_days" {
  description = "Approved raw OCI Email Delivery log retention; null defers creating PII-bearing logs until access is reviewed."
  type        = number
  default     = null

  validation {
    condition     = var.email_log_retention_days == null || contains([30, 60, 90, 120, 150, 180], var.email_log_retention_days)
    error_message = "OCI service log retention must be null or a 30-day increment from 30 through 180 days."
  }
}

variable "enable_email_delivery_alerts" {
  description = "Create the Staging Email Delivery notification topic, email subscription, and native metric alarms."
  type        = bool
  default     = false
}

variable "email_alert_endpoint" {
  description = "Operator mailbox for the OCI Notifications EMAIL subscription; keep this value only in ignored local tfvars."
  type        = string
  default     = null
  sensitive   = true
}

variable "enable_email_application_alerts" {
  description = "Enable ADR-020 custom mail metrics IAM and alarms in Staging; source default is disabled."
  type        = bool
  default     = false
}
