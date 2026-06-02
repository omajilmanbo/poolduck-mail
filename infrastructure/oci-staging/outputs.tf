# Staging VCN OCID，供人工在 OCI Console 交叉核对。
output "vcn_id" {
  description = "OCID of the staging VCN."
  value       = oci_core_vcn.staging.id
}

# Staging 公有子网 OCID，供后续负载均衡或实例拆分复用。
output "public_subnet_id" {
  description = "OCID of the staging public subnet."
  value       = oci_core_subnet.public.id
}

# Staging Compute OCID，供人工排障和 Console 核对。
output "compute_instance_id" {
  description = "OCID of the staging compute instance."
  value       = oci_core_instance.app.id
}

# Staging Compute 公网 IP；用于人工 SSH、HTTP/HTTPS smoke test。
output "compute_public_ip" {
  description = "Ephemeral public IP of the staging compute instance."
  value       = data.oci_core_vnic.app.public_ip_address
}

# Staging Compute 私网 IP；用于后续内部服务拆分或排障。
output "compute_private_ip" {
  description = "Private IP of the staging compute instance."
  value       = data.oci_core_vnic.app.private_ip_address
}

# Staging 备份 bucket 名称；真实凭据不输出。
output "backup_bucket_name" {
  description = "Object Storage bucket name for staging backups."
  value       = oci_objectstorage_bucket.backups.name
}
