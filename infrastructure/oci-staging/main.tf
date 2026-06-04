# 读取 tenancy 下可用 AD，用于把 Always Free compute 放到第一个 AD；如 E2 Micro 只在特定 AD 可用，人工可调整。
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

# 读取当前 Object Storage namespace，用于创建 staging 备份 bucket。
data "oci_objectstorage_namespace" "current" {
  compartment_id = var.compartment_ocid
}

# 读取 Ubuntu 镜像，避免在代码中硬编码区域相关 image OCID。
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = var.ubuntu_os_version
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  # 统一资源标签，便于成本审计、人工确认与后续清理。
  common_tags = merge(var.freeform_tags, {
    compartment_hint = "Mail_project_stg"
  })

  # cloud-init 只写入安装脚本和占位配置，不包含真实 DATABASE_URL/JWT/邮件凭据。
  cloud_init = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    resource_prefix = var.resource_prefix
  })
}

# Staging 专用 VCN，隔离 Local/Production，禁止与生产网络复用。
resource "oci_core_vcn" "staging" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "${var.resource_prefix}-vcn"
  dns_label      = "pdmailstg"
  freeform_tags  = local.common_tags
}

# Internet Gateway 允许 staging Web/API 对公网提供 smoke test 入口。
resource "oci_core_internet_gateway" "staging" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-igw"
  enabled        = true
  freeform_tags  = local.common_tags
}

# 公网路由表，仅把 0.0.0.0/0 指向 Internet Gateway；数据库端口仍由 NSG 限制为内网。
resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-public-rt"
  freeform_tags  = local.common_tags

  route_rules {
    description       = "Default route for staging HTTP/HTTPS egress and inbound response traffic."
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.staging.id
  }
}

# 公有子网承载 Always Free 单机 staging；Production 不得复用该子网或 CIDR。
resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.staging.id
  cidr_block                 = var.public_subnet_cidr
  display_name               = "${var.resource_prefix}-public-subnet"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  prohibit_public_ip_on_vnic = false
  freeform_tags              = local.common_tags
}

# Web/API NSG：只开放 SSH、HTTP、HTTPS；SSH 来源必须由人工在 apply 前收窄。
resource "oci_core_network_security_group" "web" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-web-nsg"
  freeform_tags  = local.common_tags
}

# SSH 入站规则：仅允许管理员固定 IP/CIDR，用于部署与排障。
resource "oci_core_network_security_group_security_rule" "web_ssh_ingress" {
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.admin_ssh_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Allow SSH from approved admin CIDR only."

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# HTTP 入站规则：供 staging smoke test 或后续反向代理使用。
resource "oci_core_network_security_group_security_rule" "web_http_ingress" {
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.http_ingress_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Allow HTTP access for staging smoke tests."

  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}

# HTTPS 入站规则：预留 TLS 后对外访问入口。
resource "oci_core_network_security_group_security_rule" "web_https_ingress" {
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.https_ingress_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Allow HTTPS access for staging after TLS is configured."

  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

# Web/API 出站规则：允许 staging 主机拉取系统包、容器镜像，并访问 sandbox mail provider。
resource "oci_core_network_security_group_security_rule" "web_all_egress" {
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Allow outbound traffic for package updates, image pulls, and sandbox mail provider calls."
}

# DB NSG：数据库端口不暴露公网，仅允许 staging 子网内访问本机/内网 PostgreSQL。
resource "oci_core_network_security_group" "db" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-db-nsg"
  freeform_tags  = local.common_tags
}

# PostgreSQL 内网入站规则：为后续拆分数据库主机预留；当前单机部署也保留显式边界说明。
resource "oci_core_network_security_group_security_rule" "db_postgres_ingress" {
  network_security_group_id = oci_core_network_security_group.db.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.public_subnet_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Allow PostgreSQL only from the staging subnet; never expose 5432 to the public internet."

  tcp_options {
    destination_port_range {
      min = 5432
      max = 5432
    }
  }
}

# Staging 备份/日志归档 bucket，只保存非真实客户数据与运维产物，不保存密钥或 PII。
resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.current.namespace
  name           = var.backup_bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  freeform_tags  = local.common_tags
}

# Object Lifecycle：自动清理 staging 备份，控制 Always Free Object Storage 容量占用。
resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  namespace = data.oci_objectstorage_namespace.current.namespace
  bucket    = oci_objectstorage_bucket.backups.name

  rules {
    name        = "delete-staging-backups-after-retention"
    action      = "DELETE"
    is_enabled  = true
    target      = "objects"
    time_amount = var.backup_retention_days
    time_unit   = "DAYS"
  }
}

# Always Free Compute：MVP staging 单机承载前端、后端与 PostgreSQL 16（容器），后续可按 ADR 另行拆分。
resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "${var.resource_prefix}-app-01"
  shape               = var.instance_shape
  freeform_tags       = local.common_tags

  dynamic "shape_config" {
    for_each = var.instance_shape == "VM.Standard.A1.Flex" ? [1] : []
    content {
      ocpus         = var.instance_ocpus
      memory_in_gbs = var.instance_memory_gb
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "${var.resource_prefix}-app-vnic"
    hostname_label   = "app01"
    nsg_ids          = [oci_core_network_security_group.web.id, oci_core_network_security_group.db.id]
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_gb
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(local.cloud_init)
  }
}
# 读取 Compute 主 VNIC attachment，用于输出 ephemeral public IP，避免人工到 Console 中手动查找。
data "oci_core_vnic_attachments" "app" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  instance_id         = oci_core_instance.app.id
}

# 读取 Compute 主 VNIC 详情，用于输出公网 IP 与内网 IP。
data "oci_core_vnic" "app" {
  vnic_id = data.oci_core_vnic_attachments.app.vnic_attachments[0].vnic_id
}
