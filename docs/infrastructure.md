# Infrastructure Overview (Local/Staging/Production)

## 1. Goal

Before entering the database, authentication, and email scanning, the infrastructure blueprints of the three environments must be unified to ensure:

- Environment isolation rules are clear to avoid misoperation across environments.
- The deployment locations of front-end and back-end, database, email provider, log monitoring, and Secrets are unified.
- There is a clear basis for splitting subsequent deployment and configuration issues.

## 2. Infrastructure overview map

```mermaid
flowchart LR
    subgraph Local[Local (development machine)]
      LBrowser[Browser]
      LFE[Frontend\nNext.js :3000]
      LBE[Backend API\nNestJS :3001]
      LDB[(PostgreSQL 16\nDocker Compose :5432)]
      LMAIL[Sandbox/Mock Mail Provider]
      LLOG[Local Logs]
      LBrowser --> LFE --> LBE
      LBE --> LDB
      LBE --> LMAIL
      LBE --> LLOG
    end

    subgraph Staging [Staging (pre-release)]
      SBrowser[Browser]
      SFE[Frontend\nHTTPS]
      SBE[Backend API\nHTTPS]
      SDB[(PostgreSQL 16\nStaging standalone instance)]
      SMAIL[Sandbox Mail Provider\nStaging Account]
      SOBS[Centralized Logs & Metrics]
      SBrowser --> SFE --> SBE
      SBE --> SDB
      SBE --> SMAIL
      SBE --> SOBS
    end

    subgraph Prod[Production (formal)]
      PBrowser[Browser]
      PFE[Frontend\nHTTPS + official domain name]
      PBE[Backend API\nHTTPS]
      PDB[(PostgreSQL 16\nProduction standalone instance)]
      PMAIL[Production Mail Provider\n (non-sandbox-only configuration)]
      POBS[Centralized Logs/Monitoring/Alerting]
      PBACKUP[(DB Backup)]
      PBrowser --> PFE --> PBE
      PBE --> PDB
      PBE --> PMAIL
      PBE --> POBS
      PDB --> PBACKUP
    end
```

## 3. Component deployment location

- Frontend:
  - Local: Development machine process.
  - Staging/Production: independent deployment unit (can be released separately from the backend).
- Backend API:
  - Local: Development machine process.
  - Staging/Production: an independent deployment unit responsible for tenant authentication, subscription access control, and email tasks.
- PostgreSQL:
  - Local: Docker Compose local container.
  - Staging: independent database instance, used only for test data.
  - Production: independent database instance, used for real business data, including backup strategy.
- Mail Provider:
  - Local:mock/sandbox.
  - Staging: sandbox (no real customer posting).
  - Production: Official sending link (cannot use mock secret or sandbox-only configuration).
- Logging/monitoring:
  - Local: console/local log.
  - Staging/Production: centralized logs and indicators, Production needs to be alerted.
- Secrets:
  - The three environments are stored independently and reuse is prohibited.

## 4. Isolation principle

1. Staging and Production must:
   - Independent database instance.
   - Independent Secrets.
   - Set of independent environment variables.
2. Staging does not use real customer data.
3. Production does not use mock secret or sandbox-only mail configuration.
4. Disable sharing of access credentials across environments (such as the same `DATABASE_URL` / `JWT_SECRET`).

## 5. Unscoped declaration (aligned with Issue #35)

The following are outside the scope of the current Issue implementation:

- Create real cloud resources such as AWS/Vercel/RDS/ECS.
-Write Docker Compose implementation files.
- Build CI/CD pipeline implementation.
- Access to real email provider SDK/API.

## 6. Subsequent implementation class Issue suggestions

1. New: Local Docker Compose orchestration (frontend/backend/postgres).
2. New: Staging/Production environment variables and secrets management specifications are implemented.
3. New: Production HTTPS certificate and domain name access process.
4. New: Database backup and recovery drill process.
5. Create new: log/indicator/alarm minimum observable link.
6. New: Release and rollback runbook (including staging gate).

## 7. Resource ledger (actual parameters)

`docs/infrastructure.md` is responsible for the infrastructure blueprint and isolation principle; please maintain the actual implementation resources and parameters in `docs/inventory/`:

- `docs/inventory/infrastructure-inventory.md`: Infrastructure resource ledger
- `docs/inventory/environment-parameters.md`: Environment variable parameter table
- `docs/inventory/secrets-inventory.md`: Secrets name and storage location ledger (excluding real values)
- `docs/inventory/external-services.md`: External service dependency ledger
- `docs/inventory/cloud-resources-parameters.md`: Cloud resource parameter table (EC2/RDS/VPC/LB, etc.)

When Local/Staging/Production resources, domain names, ports, environment variables or external services change, the above accounts must be updated simultaneously.


## 8. OCI Always Free Staging IaC(Issue #48)

The Staging infrastructure resources of Issue #48 are prepared to use Terraform. The code is located in `infrastructure/oci-staging/` and the target is the manually created OCI compartment `Mail_project_stg`.

This stage only generates IaC and waits for manual confirmation before implementation. It does not execute terraform apply in PR, nor submit any real OCI credentials, database password, JWT secret or mail service token.

Current Staging IaC scope:

- OCI VCN / Public Subnet / Internet Gateway / Route Table, used for Staging network isolation and public network smoke test entrance.
- Web/API NSG, only open SSH, HTTP, HTTPS; SSH source must be narrowed to administrator fixed IP/CIDR before manual implementation.
- DB NSG, only the Staging subnet is allowed to access PostgreSQL `5432`, and the public network is prohibited from directly accessing the database port.
- Always Free Compute, by default uses `VM.Standard.A1.Flex` to host MVP Staging's Frontend, Backend and PostgreSQL 16 containers on a single machine.
- Object Storage Bucket, used for non-real staging data backup and operation and maintenance product archiving, and configured life cycle cleanup.
- Cloud-init only installs Docker, creates directories and placeholder configurations, does not automatically deploy applications, and does not write real secrets.

Before manual implementation, you must confirm the OCI home region, Always Free quota, `Mail_project_stg` compartment OCID, administrator SSH CIDR and SSH public key.
