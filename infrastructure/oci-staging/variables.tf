# Existing OCI Staging compartment OCID; the user has stated that the compartment name is Mail_project_stg, but Terraform requires the OCID.
variable "compartment_ocid" {
  description = "OCID of the existing OCI compartment for staging, display name expected to be Mail_project_stg."
  type        = string
}

# OCI home region / target region; Always Free resources must be manually confirmed to be implemented within the tenancy home region.
variable "region" {
  description = "OCI region where Always Free resources will be created; must be the tenancy home region for Always Free eligibility."
  type        = string
}

# Resource name prefix to uniformly identify Poolduck Mail staging resources to facilitate console retrieval and subsequent cleanup.
variable "resource_prefix" {
  description = "Prefix for OCI resource display names."
  type        = string
  default     = "poolduck-mail-stg"
}

# Staging VCN CIDR; used only in pre-release environments and may not be reused with Production networks.
variable "vcn_cidr" {
  description = "CIDR block for the staging VCN."
  type        = string
  default     = "10.48.0.0/16"
}

# Staging public subnet CIDR; MVP Always Free stand-alone deployment temporarily exposes Web/API to this subnet.
variable "public_subnet_cidr" {
  description = "CIDR block for the staging public subnet."
  type        = string
  default     = "10.48.10.0/24"
}

# SSH management source; it must be narrowed to the administrator's fixed public IP/CIDR before manual implementation, and the default value of 0.0.0.0/0 is prohibited.
variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH to the staging compute instance. Replace with an admin fixed public IP/CIDR before apply."
  type        = string
  default     = "203.0.113.10/32"
}

#Business HTTP source; before TLS/reverse proxy is connected, 80 can be temporarily opened for smoke test. After implementation, it is recommended to narrow it or change it to 443.
variable "http_ingress_cidr" {
  description = "CIDR allowed to reach HTTP port 80 for staging smoke tests."
  type        = string
  default     = "0.0.0.0/0"
}

#Business HTTPS source; reserved for subsequent configuration of TLS/reverse proxy.
variable "https_ingress_cidr" {
  description = "CIDR allowed to reach HTTPS port 443."
  type        = string
  default     = "0.0.0.0/0"
}

# SSH public key content; only the public key is saved, not the private key.
variable "ssh_public_key" {
  description = "SSH public key authorized for the staging compute instance. Do not put private keys in this repository."
  type        = string
  sensitive   = true
}

# Always Free recommends A1 Flex; if the home region capacity is insufficient, you can manually change it to VM.Standard.E2.1.Micro, but the application resource usage needs to be re-evaluated.
variable "instance_shape" {
  description = "OCI Always Free compute shape for the staging instance."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

# A1 Flex OCPU; the Always Free pool has a tenancy-level quota, and it must be confirmed that it is not occupied by other resources before implementation.
variable "instance_ocpus" {
  description = "OCPUs for VM.Standard.A1.Flex. Ignored for non-Flex shapes."
  type        = number
  default     = 1
}

# A1 Flex memory; Staging is not recommended to be less than 6GB when running Node.js + PostgreSQL + Docker on a single machine.
variable "instance_memory_gb" {
  description = "Memory in GB for VM.Standard.A1.Flex. Ignored for non-Flex shapes."
  type        = number
  default     = 6
}

# Startup disk size; the total amount of OCI Always Free Block Volume needs to be confirmed manually. This value is only used as the minimum baseline for staging.
variable "boot_volume_size_gb" {
  description = "Boot volume size for the compute instance."
  type        = number
  default     = 50
}

# Ubuntu version; cloud-init uses Ubuntu as the target system to install Docker and the base directory.
variable "ubuntu_os_version" {
  description = "Canonical Ubuntu image version used by the staging compute instance."
  type        = string
  default     = "22.04"
}

# Object Storage bucket name; the bucket namespace is globally determined by tenancy, and the bucket name is unique within the namespace.
variable "backup_bucket_name" {
  description = "Object Storage bucket name for staging database backups and operational artifacts."
  type        = string
  default     = "poolduck-mail-stg-backups"
}

# Number of days for backup retention; Staging only retains short-term non-real data backups to avoid occupying Always Free Object Storage capacity.
variable "backup_retention_days" {
  description = "Number of days to retain staging backup objects."
  type        = number
  default     = 30
}

# Project and environment tags; OCI defined tags need to create namespace in advance, this IaC only uses freeform tags.
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
