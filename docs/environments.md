# Environment definition and difference (Local/Staging/Production)

## 1. Environmental use

- Local: Developers develop and debug locally.
- Staging: Pre-release verification, verifying functions, configuration and release process.
- Production: formal external service.

## 2. Environmental difference matrix

| Dimensions | Local | Staging | Production |
|---|---|---|---|
| User objects | Developers | Internal testing/acceptance | Real customers |
| Data type | Local test data | Non-real customer data | Real business data |
| Database | Local PostgreSQL (Compose) | Standalone Staging DB | Standalone Production DB |
| Mail Provider | Mock/Sandbox | Sandbox (independent account) | Official Provider (not sandbox-only) |
| Domain name and protocol | localhost (HTTP) | staging domain name (HTTPS) | formal domain name (HTTPS) |
| Secrets | local `.env` | Staging secrets store | Production secrets store |
| Log monitoring | Local log | Centralized log + basic monitoring | Centralized log + monitoring + alarm |
| Change risk | Low | Medium | High |

## 3. Mandatory isolation rules

1. Staging and Production must use independent databases, and sharing instances/Schema is not allowed.
2. Staging and Production must use independent secrets, and reuse of secrets with the same name and value is not allowed.
3. Staging and Production must use independent sets of environment variables (at least `DATABASE_URL`, `JWT_SECRET`, `MAIL_*` are separated).
4. Staging prohibits the import of real customer PII data.
5. Production prohibits enabling mock provider or sandbox-only secret.

## 4. Configuration baseline recommendations

- `APP_ENV`:`local` / `staging` / `production`.
- `APP_PORT`: allocated by deployment platform.
- `DATABASE_URL`: environment independent.
- `JWT_SECRET`: environment independent, regular rotation.
- `MAIL_PROVIDER`: Local/Staging allows sandbox/mock; Production points to the official channel.
- `FRONTEND_BASE_URL`, `API_BASE_URL`: distinguished by environment domain name.

## 5. Acceptance Checklist (Document Level)

- [ ] Local/Staging/Production has a clear purpose.
- [ ] Staging/Production DB and Secrets are separated and written clearly.
- [ ] Production non-sandbox-only constraints are explicit.
- [ ] Minimum set of environment variables defined.
