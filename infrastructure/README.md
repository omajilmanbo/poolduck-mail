# Infrastructure

This directory stores Poolduck Mail's Infrastructure as Code (IaC). Currently only the OCI Always Free Staging resource preparation code for Issue #48 is included:

- `oci-staging/`: Terraform configuration for existing OCI compartment `Mail_project_stg`.

All IaC files are only allowed to save non-sensitive parameters, placeholder values and resource definitions; real keys, tokens, database passwords, OAuth refresh tokens, and customer data must not be submitted to the repository.
