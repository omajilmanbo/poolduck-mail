# Environment Parameters (environment parameter table)

> Purpose: Centrally record environment variable parameter definitions and environment differences.
>
> Security requirements: **Do not write the real secret value**. If it is a sensitive parameter, only "Secret/Placeholder/Example value" is recorded.

## 1. Parameter list

| Variable name | Purpose | Local | Staging | Production | Whether Secret | Remarks |
|---|---|---|---|---|---|---|
| APP_ENV | Running environment identification | `local` | `staging` | `production` | No | Consistent with the deployment environment |
| APP_PORT | Backend listening port | `3001` | `TBD` | `TBD` | No | Only record port, without access credentials |
| FRONTEND_PORT | Frontend local port | `3000` | `TBD` | `TBD` | No | TBD can be maintained if non-container deployment |
| API_BASE_URL | Front-end access API address | `http://localhost:3001` | `TBD` | `TBD` | No | Only write the URL, not the token |
| POSTGRES_DB | Local PostgreSQL database name | `poolduck_mail` | `TBD` | `TBD` | No | Consistent with `docker-compose.yml` default value |
| POSTGRES_USER | Local PostgreSQL username | `poolduck_local` | `Secret/Placeholder` | `Secret/Placeholder` | Yes | Local is an example value and will not be used in a real environment |
| POSTGRES_PASSWORD | Local PostgreSQL password | `poolduck_local_password` | `Secret` | `Secret` | Yes | Local is an example value and will not be used in a real environment |
| POSTGRES_PORT | Local PostgreSQL native port | `5432` | `TBD` | `TBD` | No | If there is a local port conflict, it can be changed to `5433` |
| DATABASE_URL | Database connection string | `postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail` | `Secret` | `Secret` | Yes | Local is a compose example value; do not write the real environment value |
| JWT_SECRET | JWT signing key | `local-placeholder` | `Secret` | `Secret` | Yes | Do not write real value |
| REFRESH_TOKEN_SECRET | Refresh token signing key | `local-placeholder` | `Secret` | `Secret` | Yes | Do not write real value |
| MAIL_PROVIDER | Mail provider type | `mock` | `sandbox` | `TBD` | No | MVP preferred sandbox/mock |
| MAIL_FROM_ADDRESS | Sending address identification | `no-reply@example.local` | `Secret/Placeholder` | `Secret/Placeholder` | Yes | Do not write real email account credentials |
| LOG_LEVEL | Log level | `debug` | `info` | `info` | No | Adjust according to environment |
| CORS_ORIGIN | CORS whitelist | `http://localhost:3000` | `TBD` | `TBD` | No | Separate multiple domain names with commas (example) |
| TENANT_CONTEXT_ENFORCED | Tenant context force switch | `true` | `true` | `true` | No | Avoid cross-tenant access |

## 2. Maintenance rules

- When adding environment variables, this table must be updated simultaneously.
- When the parameter meaning changes, the default value changes, or whether the Secret changes, this table must be updated simultaneously.
- When environment variables are deleted, the removal date must be marked and cleared from the deployment configuration.
