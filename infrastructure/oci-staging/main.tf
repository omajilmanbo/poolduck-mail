# Read the AD available under tenancy to put Always Free compute into the first AD; if E2 Micro is only available in a specific AD, it can be adjusted manually.
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

# Read the current Object Storage namespace for creating staging backup bucket.
data "oci_objectstorage_namespace" "current" {
  compartment_id = var.compartment_ocid
}

# Read Ubuntu images to avoid hardcoding region-related image OCIDs in the code.
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = var.ubuntu_os_version
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  # Unify resource labels to facilitate cost audit, manual confirmation and subsequent cleanup.
  common_tags = merge(var.freeform_tags, {
    compartment_hint = "Mail_project_stg"
  })

  # cloud-init only writes the installation script and placeholder configuration, and does not contain the real DATABASE_URL/JWT/mail credentials.
  cloud_init = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    resource_prefix = var.resource_prefix
  })
}

# Dedicated VCN for Staging, isolate Local/Production, and prohibit reuse with the production network.
resource "oci_core_vcn" "staging" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "${var.resource_prefix}-vcn"
  dns_label      = "pdmailstg"
  freeform_tags  = local.common_tags
}

# Internet Gateway allows staging Web/API to provide smoke test entrance to the public network.
resource "oci_core_internet_gateway" "staging" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-igw"
  enabled        = true
  freeform_tags  = local.common_tags
}

# The public network routing table only points 0.0.0.0/0 to the Internet Gateway; the database port is still restricted to the intranet by NSG.
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

# The public subnet carries Always Free stand-alone staging; Production must not reuse this subnet or CIDR.
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

# Web/API NSG: Only open SSH, HTTP, HTTPS; SSH source must be manually narrowed before apply.
resource "oci_core_network_security_group" "web" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-web-nsg"
  freeform_tags  = local.common_tags
}

# SSH inbound rules: Only administrators are allowed to fix IP/CIDR for deployment and troubleshooting.
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

# HTTP inbound rules: used by staging smoke test or subsequent reverse proxy.
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

# HTTPS inbound rules: reserve TLS for external access.
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

# Web/API outbound rules: Allow the staging host to pull system packages, container images, and access the sandbox mail provider.
resource "oci_core_network_security_group_security_rule" "web_all_egress" {
  network_security_group_id = oci_core_network_security_group.web.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Allow outbound traffic for package updates, image pulls, and sandbox mail provider calls."
}

# DB NSG: The database port does not expose the public network, and only allows access to local/intranet PostgreSQL within the staging subnet.
resource "oci_core_network_security_group" "db" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.staging.id
  display_name   = "${var.resource_prefix}-db-nsg"
  freeform_tags  = local.common_tags
}

# PostgreSQL intranet inbound rules: reserved for subsequent splitting of database hosts; current stand-alone deployment also retains explicit boundary descriptions.
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

# Staging backup/log archive bucket only saves non-real customer data and operation and maintenance products, but does not save keys or PII.
resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.current.namespace
  name           = var.backup_bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  freeform_tags  = local.common_tags
}

# Object Lifecycle: Automatically clean up staging backups and control Always Free Object Storage capacity usage.
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

# Always Free Compute: MVP staging hosts the front-end, back-end and PostgreSQL 16 (container) on a single machine, and can be split separately according to ADR later.
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
# Read the Compute primary VNIC attachment to output the ephemeral public IP to avoid manual search in the Console.
data "oci_core_vnic_attachments" "app" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  instance_id         = oci_core_instance.app.id
}

# Read the Compute primary VNIC details to output the public IP and intranet IP.
data "oci_core_vnic" "app" {
  vnic_id = data.oci_core_vnic_attachments.app.vnic_attachments[0].vnic_id
}
