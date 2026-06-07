# Deployment instructions (Local/Staging/Production)

## 1. Environment division

- Local: development and debugging environment
- Staging: Pre-release verification environment
- Production: formal production environment

## 2. Basic dependencies

- Node.js 20 LTS
- npm 10+
- Docker / Docker Compose(Local PostgreSQL 16)
- PostgreSQL 16 (Local provided by `docker-compose.yml`; Staging/Production uses independent database)
- The email provider in the MVP stage uses sandbox/mock (without access to real email sending)

## 3. Environment variables

Reference `.env.example`, including at least:
- `APP_ENV`
- `APP_PORT`
- `FRONTEND_PORT`
- `API_BASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `MAIL_PROVIDER`
- `MAIL_SMTP_HOST` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`
- `MAIL_FROM_ADDRESS`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `TENANT_CONTEXT_ENFORCED`

## 4. Local deployment

### 4.0 Manual inspection items before running

- The current environment must be able to execute Docker / Docker Compose.
- The current environment must allow the installation of npm dependencies.
- The current environment must be able to access the GitHub repository and create branches/PRs.
- The default ports are not occupied: PostgreSQL `5432`, Backend `3001`, Frontend `3000`.
- If PostgreSQL already occupies `5432` on this machine, you need to manually decide whether to use other ports, for example, set `POSTGRES_PORT=5433` in `.env`.
- Do not provide real database passwords, real customer data, real email credentials or OAuth refresh tokens.
- The sandbox/mock provider must be used for email sending in the MVP stage.

### 4.1 Local PostgreSQL(Docker Compose)

`docker-compose.yml` currently only provides PostgreSQL 16. The production Dockerfile will not be created at this stage, nor will staging/production be included in compose.

1. Prepare local environment variables:
   - `copy .env.example .env`
2. Start the local database:
   - `docker compose up -d postgres`
3. Check container status:
   - `docker compose ps`
4. Verify that PostgreSQL can connect:
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`
5. Stop the local database:
   - `docker compose down`

Default local configuration:

- Database name: `poolduck_mail`
- User: `poolduck_local`
- Example password: `poolduck_local_password`
- Native port: `5432`
- Backend connection string: `postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`

### 4.2 Backend (currently operational)

1. Install dependencies:
   - `cd backend`
   - `npm install`
2. Configure environment variables (optional):
   - Create a new `backend/.env` (or use system environment variables)
   - Configurable `APP_PORT` (default `3001`)
   - Connect to Local PostgreSQL using `DATABASE_URL` in `.env.example`
3. Start the development service:
   - `npm run start:dev`
4. Health check:
   - `GET http://localhost:3001/health`
5. Run the test:
   - `npm test`

### 4.3 Front-end (currently operational)

1. Install dependencies:
   - `cd frontend`
   - `npm install`
2. Start the development service:
   - `npm run dev`
3. Build verification:
   - `npm run build`
4. Health check:
   - `GET http://localhost:3000/healthz`
5. Run the test:
   - `npm test`

## 5. Staging deployment

- Use independent database and email sandbox configuration
- Execute smoke test after automated deployment
- Verify subscription, permissions, scan code link

## 6. Production deployment

- Must be verified by staging
- Execute database migration (backup first)
- Configure monitoring alarms (login failure rate, email failure rate)
- Gradual release or low-peak release

## 7. OCI Always Free Staging IaC implementation entrance (Issue #48)

Staging infrastructure preparation code is located in `infrastructure/oci-staging/`. This directory only provides access to Terraform planning and manual implementation, and does not automatically deploy applications by default.

Manual implementation steps:

1. Enter the IaC directory: `cd infrastructure/oci-staging`
2. Copy variable example: `cp terraform.tfvars.example terraform.tfvars`
3. Manually fill in `terraform.tfvars`: `compartment_ocid`, `region`, `admin_ssh_cidr`, `ssh_public_key`.
4. Initialization and checking: `terraform init && terraform fmt -check && terraform validate`
5. Generate plan: `terraform plan -out=tfplan`
6. Only after the manual review plan confirms that there are no Production resources, no real secrets, and no public network database ports can the execution be allowed: `terraform apply tfplan`

Implement constraints:

- `region` must be manually confirmed to be an OCI tenancy home region to maintain Always Free resource eligibility.
- `admin_ssh_cidr` disallows use of `0.0.0.0/0`.
- Staging email provider must still use mock/sandbox and is not allowed to connect to real customer delivery.
- `terraform.tfvars`, `tfplan`, and Terraform state files must not be submitted to the repository.
