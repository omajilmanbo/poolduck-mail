# External Services Inventory (external service ledger)

> Purpose: Record the external services, usage, environment coverage and management responsibilities that the system depends on.

## 1. Service ledger

| Service category | Service name (can occupy space) | Purpose | Local | Staging | Production | Configuration/credential saving location | Person in charge | Remarks |
|---|---|---|---|---|---|---|---|---|
| CI/CD | GitHub Actions | Build, test, release process | Yes | Yes | Yes | Repo workflow + Secrets | Manually specified | Aligned with `docs/workflow.md` |
| Database | PostgreSQL | Business data storage | Yes (local) | Yes (independent instance) | Yes (independent instance) | Infra config + Secrets | Manually specified | Version recommendation 16 |
| Mail Provider | Sandbox/Mock (MVP) | Mail task verification | Yes | Yes | TBD | Secret Manager / Config | Manually specified | Production provider to be decided |
| DNS | TBD | Domain name resolution | No | TBD | TBD | DNS console | Manually specified | Fill in TBD first if the platform is not determined |
| TLS Certificate | TBD | HTTPS Certificate | No | TBD | TBD | Certificate Service Console | Manually specified | Certificate renewal responsibilities need to be clear |
| Hosting Platform | TBD | Front-end and back-end hosting | Local machine | TBD | TBD | Platform console + IaC (if any) | Manually specified | Can use desensitized project name |
| Monitoring/Logging | TBD | Logs, indicators, alarms | Local logs | TBD | TBD | Platform configuration + Secrets | Manual specification | Alarm channels required for production |
| Backup Storage | TBD | Backup file storage | Optional | TBD | TBD | Storage console + Secrets | Manually specified | Do not record the real storage key |

## 2. Maintenance rules

- When external services are added, replaced, or taken offline, this ledger must be updated simultaneously.
- If the service affects production stability, the risks and rollback plan must be explained in the PR.
- It is recommended to assign minimum permissions to external service accounts, and record the owner and transferee.
