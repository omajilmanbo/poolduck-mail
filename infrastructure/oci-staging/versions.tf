# Terraform CLI is locked with the OCI Provider version to avoid plan drift caused by destructive changes to the Provider during manual implementation.
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.15"
    }
  }
}

# OCI Provider uses variables to set the region; authentication is recommended to be manually configured on the implementation machine, and the OCI CLI profile or environment variables are not saved in the repository.
provider "oci" {
  region = var.region
}
