# ADR-004: Final version of MVP technology stack

- Status: Accepted
- Date: 2026-05-25
- Related Issue: #17

## Context

After ADR-001/002/003 has confirmed the product form, scan-code mailbox mapping strategy and tenant isolation/subscription rules, the project is about to enter the implementation stage.
The current document still has "optional options" for technical implementation (such as database type, authentication implementation method, email sending and access method). If the version is not finalized first, the following problems may occur in the subsequent implementation of Issue:

- Agents or developers each choose different frameworks, resulting in inconsistent directory structures and coding styles;
- It is difficult to unify the test framework and CI pipeline, and the verifiability of PR decreases;
- Mistakenly accessing the real email service during the MVP stage, increasing the risk of mis-sending and leakage;
- Key security points such as tenant isolation, permissions, and subscription verification lack unified implementation constraints.

Constraints:

- Currently only MVP is promoted, with priority given to deliverability and low operation and maintenance complexity;
- Need to remain consistent with existing architecture documents and database/API drafts;
- Email capabilities must give priority to the sandbox/mock provider, and the real provider will be connected later;
- At this stage, only the technology stack is finalized and documents are aligned, and business code is not implemented.

## Decision

The MVP technology stack is unified as follows:

1. Front-end
   - Framework: Next.js (App Router) + TypeScript
   - UI: Tailwind CSS + Headless UI (or Radix UI, choose one based on component availability)
   - Status and data request: React Query (TanStack Query)
   - Form and validation: React Hook Form + Zod

2. Backend
   - Runtime and language: Node.js 20 LTS + TypeScript
   - API:NestJS(REST)
   - Data verification: class-validator + class-transformer (input boundary)
   - Authentication: JWT (access token) + refresh token rotation strategy (MVP can use short-period access first + server can revoke refresh)

3. Database
   - PostgreSQL 16
   - ORM:Prisma
   - Multi-tenant strategy: single database multi-tenant (shared DB + tenant_id), and enforce tenant scope at the repository/service layer

4. Authentication and Authorization
   - Login method: tenant_id + username(email) + password
   - Password storage: Argon2id hash
   - Permission model: RBAC (root_admin/manager)

5. Email provider
   - MVP default provider: Sandbox/Mock Mail Provider (only records sending requests and results, no real emails are sent)
   - Provider abstract interface is retained in the backend, and real SMTP/third-party API access is provided as a follow-up issue

6. Testing framework
   - Front-end: Vitest + Testing Library
   - Backend: Jest + Supertest
   - E2E (key link): Playwright (log in → scan QR code → task status)

7. CI basic solution
   - Platform: GitHub Actions
   - Minimum pipeline:
     - lint
     - typecheck
     - unit/integration tests
     - docs link / markdown basic validation (optional)
   - Merge access control: the main branch must pass CI, and PR must fill in the test results

## Alternatives considered

1. Use Python for the whole stack (FastAPI + Jinja/front-end and back-end in the same repository and light front-end)
   - Advantages: high back-end development efficiency and mature ecosystem.
   - Reason for not selecting: The current team and existing documents prefer Web SaaS layered front-end and back-end, and the front-end interactive page needs are clear. Using Next.js + NestJS is more conducive to separation of responsibilities and subsequent expansion.

2. The backend uses Go (Gin/Fiber)
   - Advantages: high performance, simple binary deployment.
   - Reason for not selecting: Priority is given to development efficiency and scaffolding completeness in the MVP stage. TypeScript full stack can reduce context switching costs, and the testing and DTO verification system is more unified.

3. Email is directly connected to the real third party (SendGrid/SES, etc.)
   - Advantages: The real delivery link can be directly verified.
   - Reason for not selecting: MVP has higher security risks and violates the "prioritize sandbox/mock provider" phase requirements.

## Consequences

Positive impact:

- Subsequently, the directory structure, dependency selection, testing and CI standards of Issue will be unified;
- Security critical paths such as tenant isolation/subscription verification can be implemented under a unified technical framework;
- Reduce the risk of sending emails by mistake through the sandbox provider, which facilitates local and CI stable testing.

Negative effects:

- The flexibility of technology selection is reduced, and subsequent migration costs will be incurred if the stack is switched;
- Next.js + NestJS + Prisma has a learning curve for new members;
- It is necessary to invest in CI and test infrastructure work in the early stage, which will increase the burden of documentation and engineering configuration in the short term.

## Migration impact

- For existing code: The current repository has not yet initialized the business code, and there is no code migration cost.
- For existing documents: the technology stack descriptions of `docs/architecture.md` and `README.md` need to be updated simultaneously.
- For subsequent implementation: Issue #18/#19 and other implementation tasks must comply with this ADR and must not replace the core framework on their own.

## Security impact

- Authentication: Using Argon2id + JWT, combined with token life cycle and refresh strategy, to reduce the risk of credential leakage.
- Multi-tenancy: enforce query constraints through tenant scope to reduce cross-tenant access risks.
- Email: MVP mandates sandbox/mock provider to avoid real mis-sending and PII leakage.
- Audit: Continue to use the existing architectural requirements and record key events such as login failures, permission denials, and delivery failures.

## Operational impact

- Deployment: Node.js 20 and PostgreSQL 16 operating environments are required.
- CI: Need to establish GitHub Actions basic pipeline and maintain dependency cache.
- Operation and maintenance: MVP does not involve actual mail channel operation and maintenance, but the provider abstraction needs to be retained for smooth subsequent access.

## Follow-up

- Issue #18: Initializing the front-end project skeleton (Next.js + TypeScript + Tailwind).
- Issue #19: Initializing the backend project skeleton (NestJS + Prisma + PostgreSQL connection configuration).
- Issue #20: Minimal implementation of authentication and tenant context middleware (following ADR-003).
- Issue #21: Sandbox Mail Provider and minimal closed loop of email tasks.
- Updated `docs/testing.md`: Added test layering and command conventions that align with this ADR.
- Updated `docs/deployment.md`: Added Node/PostgreSQL basic running requirements and CI constraints.

> Historical numbering description (2026-05-27): The Issue number in this section reflects the plan at the time when the ADR was written.
> The current execution order and number mapping shall be subject to the "Recommended Issue Execution Order" of `README.md`; if there is a conflict, the README shall be the current implementation baseline.
