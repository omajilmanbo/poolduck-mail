# OCI Always Free Staging IaC(Issue #48)

This catalog provides Terraform IaC for Poolduck Mail's OCI Always Free Staging infrastructure readiness checklist. The target compartment has been manually created with the display name `Mail_project_stg`; the Terraform implementation must provide the OCID of this compartment.

## Resource scope

Terraform will prepare the following Staging resources:

- Staging VCN,Public Subnet,Internet Gateway,Route Table.
- Web/API NSG: Open SSH, HTTP, HTTPS; SSH must be narrowed to the administrator fixed IP.
- DB NSG: PostgreSQL `5432` only allows access to the Staging subnet and prohibits public network access.
- Always Free Compute: Default `VM.Standard.A1.Flex`, used for MVP Staging stand-alone hosting of Frontend / Backend / PostgreSQL 16 containers.
- Object Storage Bucket: used for staging non-real data backup and operation and maintenance product archiving, and configure life cycle automatic cleanup.
- Cloud-init: only installs Docker, creates directories and placeholder configurations, does not write real secrets, and does not automatically start applications.

## Always Free manual confirmation items

It must be manually confirmed before executing `terraform apply`:

1. `region` is the OCI tenancy home region; Oracle documentation states that resources such as Always Free compute / Autonomous Database need to be created in the home region.
2. The OCID of `Mail_project_stg` compartment is correct.
3. The A1 Flex free pool still has available OCPU/memory; if the capacity is insufficient, you can manually change it to `VM.Standard.E2.1.Micro` and then re-evaluate the resource usage of Node.js + PostgreSQL.
4. `admin_ssh_cidr` has been replaced by the administrator's fixed public IP/CIDR, and the use of `0.0.0.0/0` is prohibited.
5. `ssh_public_key` only contains public keys; private keys, API keys, database passwords, JWT secrets, and email tokens must not be submitted to the repository.
6. Object Storage usage and Block Volume usage do not exceed the current account Always Free quota.

## Manual implementation process

```bash
cd infrastructure/oci-staging
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: fill in the real compartment OCID, region, SSH public key, and administrator CIDR.
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
# The plan is allowed to be executed only after manual review:
terraform apply tfplan
```

## Non-scope declaration

- This IaC does not create Production resources.
- This IaC does not connect to the real mail service; MVP Staging still uses the mock/sandbox provider.
- This IaC does not write or generate any real secrets.
- This IaC does not automatically deploy the Poolduck Mail application image; the application release process is defined separately by subsequent Issues.
- This IaC does not create an OCI Autonomous Database as current ADR-004 has determined that the MVP database is PostgreSQL 16.

## Reference

- OCI Always Free official documentation: `https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm`
- Terraform OCI Provider:`https://registry.terraform.io/providers/oracle/oci/latest`
