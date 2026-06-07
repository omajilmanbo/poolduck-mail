# Infrastructure Inventory (resource ledger)

> Purpose: Record the **actually used** infrastructure resources and key parameter ownership for Local/Staging/Production execution and auditing.
>
> Security requirements: This ledger only records the resource name, purpose, environment, parameter name, storage location, and person in charge; **It is prohibited to record real passwords, tokens, API keys, refresh tokens, and production database connection strings**.

## 1. Instructions for use

- This document is used to supplement the blueprint design of `docs/infrastructure.md`, focusing on the "final implementation parameters".
- If the platform or resources have not yet been determined in the current environment, fill in `TBD` uniformly.
- If the real resource name should not be made public, it is allowed to use masked names or placeholders (e.g. `stg-db-01`, `prod-mail-provider`).
- Any infrastructure changes (new addition, offline, replacement, migration) must be updated simultaneously in this ledger.

## 2. Resource ledger (according to environment)

| Resource category | Purpose | Local | Staging | Production | Key parameters/identifiers (non-sensitive) | Save location | Person in charge | Remarks |
|---|---|---|---|---|---|---|---|---|
| Frontend Hosting | Front-end page hosting | Local process (`localhost:3000`) | TBD | TBD | URL / domain name / deployment platform | `docs/inventory/` | Manually specified | You can fill in the placeholder domain name first |
| Backend API Hosting | API service hosting | Local process (`localhost:3001`) | TBD | TBD | Base URL / Runtime / Region | `docs/inventory/` | Manually specified | Deployed separately from the front end |
| PostgreSQL | Business data storage | Docker Compose / PostgreSQL 16 / `5432` | Standalone instance (TBD) | Standalone instance (TBD) | engine/version/port/instance-id | `docs/inventory/` | Manually specified | Prohibited sharing of instances across environments |
| Mail Provider | Email sending capability | sandbox/mock provider | sandbox provider (independent account) | TBD (formal link) | provider name / account alias | `docs/inventory/` | Manually specified | MVP prohibits sending real customer emails outside of production |
| Log & Monitoring | Logs, indicators, alarms | Local logs | Centralized logs and indicators (TBD) | Centralized logs, indicators, and alarms (TBD) | service name / project id | `docs/inventory/` | Manually specified | Alarm strategy required for production environment |
| Backup | Backup and recovery | Optional (local snapshot) | Backup policy (TBD) | Backup policy (TBD) | schedule / retention / storage | `docs/inventory/` | Manually specified | Do not log real storage credentials |
| Deployment Method | Release method | Manual startup (dev) | CI/CD (TBD) | CI/CD (TBD) | workflow name / runner / approval | `docs/inventory/` | Manually specified | Need to be consistent with `docs/workflow.md` |
| DNS & TLS | Domain name and certificate | N/A | TBD | TBD | domain / cert source / expiry owner | `docs/inventory/` | Manually specified | You can record the placeholder domain name first |

## 3. Change record suggestions

It is recommended to add the following information for each change (can be in the PR description or change log):

- Change date
- Impact on the environment (Local/Staging/Production)
- Change resource category
- Risk description and rollback points
- Corresponding to Issue/PR link
