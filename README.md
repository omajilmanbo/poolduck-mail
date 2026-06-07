# Poolduck Mail (tentative name)

Poolduck Mail is a Web SaaS project for enterprise customers. Its goal is to let customers scan barcodes/QR codes with a barcode scanner so the system can automatically identify the recipient email address and trigger email delivery.

## Current project stage

Currently in the **Function implementation preparation stage after the local development environment is completed**:

- Documentation of product scope, business processes, tenant isolation and subscription rules has been completed.
- MVP stack confirmed via ADR-004 (status: `Accepted`).
- The front-end and back-end basic engineering skeleton has been completed.
- The Local Docker Compose development environment has been completed, and the current local PostgreSQL 16 can be started through Docker Compose.
- In the follow-up, we will first complete the Staging deployment process, database migration basics, authentication and tenant context, and then enter the core scan-to-email workflow.

## MVP technology stack summary (subject to ADR-004)

- Front-end: Next.js (App Router) + TypeScript + Tailwind CSS
- Backend: NestJS (Node.js 20 LTS, REST API)
- Database: PostgreSQL 16 + Prisma
- Authentication and authorization: JWT (access/refresh) + RBAC (root_admin/manager)
- Email sending: MVP uses Sandbox/Mock provider (not connected to real email service)
- Testing: Vitest / Testing Library (front-end), Jest / Supertest (back-end), Playwright (E2E)
- CI: GitHub Actions (lint, typecheck, tests are the minimum CI gates)

> Note: Subsequent implementation of Issue must follow `docs/decisions/ADR-004-tech-stack-for-mvp.md`, and the core technology stack cannot be replaced without manual approval.

## Local development entrance (current status)

The current repository has initialized the front-end and back-end engineering skeleton and completed the Local Docker Compose development environment.

### Local Docker Compose

Manual inspection items before running:

- Docker / Docker Compose can be executed natively.
- The default ports are not occupied: PostgreSQL `5432`, Backend `3001`, Frontend `3000`.
- If PostgreSQL already occupies `5432` on this machine, first use port mapping such as `POSTGRES_PORT=5433` in the local `.env`.
- Do not write real database passwords, real customer data, real email credentials in `.env`, compose files or documents.

Start local PostgreSQL 16:

1. Example of copying environment variables:
   - Windows: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. Start the database: `docker compose up -d postgres`
3. Check the health status: `docker compose ps`
4. Verify database connection:
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`

`docker-compose.yml` only starts PostgreSQL by default. At this stage, the front and back ends are still running as local Node.js processes, and the back end uses `DATABASE_URL` in `.env.example` to connect to the local database.

- Backend directory: `backend/`
- Install dependencies: `cd backend && npm install`
- Database connection string: `DATABASE_URL=postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`
- Start the development service: `npm run start:dev`
- Default health check address: `GET http://localhost:3001/health`
- Run the test: `npm test`

> If you need to customize the port, you can set `APP_PORT` in `backend/.env` or environment variables.

- Frontend directory: `frontend/`
- Install dependencies: `cd frontend && npm install`
- Start the front-end development service: `npm run dev`
- Front-end health check address: `GET http://localhost:3000/healthz`
- Front-end build: `npm run build`
- Front-end testing: `npm test`

## Document Navigation

- Product description: `docs/product.md`
- Requirements description: `docs/requirements.md`
- Architecture design: `docs/architecture.md`
- Database design: `docs/database.md`
- API draft: `docs/api.md`
- Development process: `docs/workflow.md`
- Testing strategy: `docs/testing.md`
- Infrastructure overview: `docs/infrastructure.md`
- Infrastructure resource ledger: `docs/inventory/infrastructure-inventory.md`
- Environment parameter table: `docs/inventory/environment-parameters.md`
- Secrets ledger: `docs/inventory/secrets-inventory.md`
- External services ledger: `docs/inventory/external-services.md`
- Cloud resource parameter table: `docs/inventory/cloud-resources-parameters.md`
- Environment definition: `docs/environments.md`
- Network policy: `docs/network.md`
- Deployment instructions: `docs/deployment.md`
- Release specifications: `docs/release.md`
- Operation and maintenance manual: `docs/operation.md`
- User manual: `docs/user-guide.md`
- Administrator's Guide: `docs/admin-guide.md`
- ADR list: `docs/decisions/`

## Recommended Issue execution order

### Completed/Baseline tasks

- **#17**: MVP technology stack ADR finalization and documentation alignment.
- **#18**: Front-end project initialization.
- **#19**: Backend project initialization.
- **#20**: Establish a basic CI workflow.
- **#31**: Review the consistency of the current stage results and documentation.
- **#35**: Design Local/Staging/Production infrastructure architecture.
- **#41**: Update the Issue template to make manual preparation and external prerequisites mandatory.
- **#43**: Added infrastructure resource ledger and environment parameter table.
- **#36**: Create a Local Docker Compose development environment.

### Current subsequent execution sequence

1. **#37**: Design the Staging deployment process and environment variables.
2. **#21**: Implement database migration basis and initial model.
3. **#38**: Design a PostgreSQL backup and recovery strategy.
4. **#39**: Design logging, monitoring and alerting strategies.
5. **#22**: Implement tenant login and user authentication API.
6. **#33**: Minimal implementation of authentication and tenant context middleware.
7. **#23**: Implement subscription status check and scan code sending restriction basis.
8. **#24**: Implement location and person mapping read-only API.
9. **#25**: Implement the QR code scanning event creation and fixed email task generation API.
10. **#26**: Implement email sandbox provider and send trigger API.

### Business implementation dependencies (according to current execution plan)

- #37 Complete the Staging deployment process and environment variable boundaries first to avoid backfilling the deployment rules after subsequent implementation.
- #21 provides the database basic model, which is the data precursor of #22/#23/#24/#25/#26.
- #38 Complete the PostgreSQL backup and recovery strategy to ensure a baseline for subsequent migration and production paths.
- #39 Complete the log, monitoring and alarm strategies to provide a log baseline for login, subscription gating, QR code scanning exception, email sending failure, etc.
- #22 and #33 together form a closed loop of authentication and tenant scope; #23/#24/#25/#26 rely on this closed loop.
- #23 provides subscription gate rules and is a front-end gate for #25/#26.
- #24 provides location + person mapping read-only capabilities, which is the direct predecessor of #25.
- #25 After completing the generation of scan code events and fixed email tasks, #26 execute the sending trigger.

> Note: Issue priority is sorted by implementation dependency, not by number size.

> Note (aligned on 2026-05-27): The subsequent implementation number of this repository shall be subject to the "Recommended Issue Execution Order" of this README.
> The old follow-up number in ADR-004 is only used for historical tracing and is not used as the basis for current scheduling.

### Documentation Consistency SSOT (before implementation)

- Role: `root_admin` / `manager`.
- Subscription status: `trial` / `active` / `expired` / `suspended`.
- Login process: `tenant_id` + email + password.
- Email body: The back-end fixed template is generated, and custom body is not supported.

## Development constraints (current stage)

- It has now entered the implementation preparation stage: proceed according to the "recommended issue execution order", giving priority to completing basic tasks such as #37/#21.
- Do not submit secrets/tokens/real customer data.
- Confirm ADR, Issue, manual preparation items and test plan before developing new functions.
