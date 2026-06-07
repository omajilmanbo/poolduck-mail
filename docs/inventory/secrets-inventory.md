# Secrets Inventory (Secrets account)

> This file only records the Secret name, purpose, storage location, usage environment, and person in charge, but does not record the Secret content.
>
> It is strictly prohibited to write: real password, token, refresh token, API key, production database connection string, customer data.

## 1. Secrets ledger

| Secret name | Purpose | Save location | Usage environment | Person in charge | Remarks |
|---|---|---|---|---|---|
| DATABASE_URL | Database connection string | GitHub Secrets / Secret Manager (TBD) | Staging / Production | Manual management | Do not write real values |
| JWT_SECRET | Access Token signature | GitHub Secrets / Secret Manager (TBD) | Staging / Production | Manual management | Periodic rotation |
| REFRESH_TOKEN_SECRET | Refresh Token signature | GitHub Secrets / Secret Manager (TBD) | Staging / Production | Manual management | Periodic rotation |
| MAIL_PROVIDER_API_KEY | Mail service authentication | GitHub Secrets / Secret Manager (TBD) | Staging / Production | Manual management | MVP stage priority sandbox |
| MAIL_FROM_ADDRESS | From address ID | GitHub Secrets/Config Store (TBD) | Staging/Production | Manual management | Log name only |
| DB_BACKUP_STORAGE_CREDENTIAL | Backup storage access credentials | Secret Manager (TBD) | Production | Manual management | Log name only |
| MONITORING_DSN | Monitoring/alarm access parameters | GitHub Secrets / Secret Manager (TBD) | Staging / Production | Manual management | Do not write real values |

## 2. Rotation and audit recommendations

- Check Secrets for rotation at least quarterly.
- Special rotation should be triggered after permission changes (personnel resignation/role change).
- When reviewing PR and documents, focus on checking whether the real Secret has been submitted by mistake.
