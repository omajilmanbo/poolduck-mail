# Staging VCN OCID for manual cross-checking in OCI Console.
output "vcn_id" {
  description = "OCID of the staging VCN."
  value       = oci_core_vcn.staging.id
}

# Staging public subnet OCID for subsequent load balancing or instance splitting and reuse.
output "public_subnet_id" {
  description = "OCID of the staging public subnet."
  value       = oci_core_subnet.public.id
}

# Staging Compute OCID for manual troubleshooting and console verification.
output "compute_instance_id" {
  description = "OCID of the staging compute instance."
  value       = oci_core_instance.app.id
}

# Staging Compute public network IP; used for manual SSH, HTTP/HTTPS smoke test.
output "compute_public_ip" {
  description = "Ephemeral public IP of the staging compute instance."
  value       = data.oci_core_vnic.app.public_ip_address
}

# Staging Compute Private network IP; used for subsequent internal service splitting or troubleshooting.
output "compute_private_ip" {
  description = "Private IP of the staging compute instance."
  value       = data.oci_core_vnic.app.private_ip_address
}

# Staging backup bucket name; real credentials are not output.
output "backup_bucket_name" {
  description = "Object Storage bucket name for staging backups."
  value       = oci_objectstorage_bucket.backups.name
}
