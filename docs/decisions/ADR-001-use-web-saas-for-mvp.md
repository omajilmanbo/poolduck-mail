# ADR-001: MVP with Web SaaS

- Status: Accepted
- Date: 2026-05-19
- Related Issue: #1

## Context

Poolduck Mail needs to quickly verify the "scanning code to trigger email sending" business closed loop in a multi-customer scenario. The current team resources are limited, and priority must be given to ensuring maintainability, iterability, and tenant isolation capabilities.

## Decision

The MVP stage uses Web SaaS architecture as the only delivery form.

## Alternatives considered

- This stage does not introduce comparison with other delivery forms, focusing on the Web SaaS route.

## Consequences

- It is necessary to prioritize the construction of stable back-end API, authentication, authorization and tenant isolation mechanisms.
- Standardized operation and maintenance monitoring and auditing capabilities need to be established.

## Migration impact

- It is currently in the preparation stage and there is no existing system migration.
- If there is a need to import historical data in the future, a migration strategy will be defined in an independent ADR.

## Security impact

- Force the backend to perform tenant isolation and permission verification.
- Manage keys through environment variables and prohibit storing production credentials in the repository.

## Operational impact

- It is necessary to improve the observability and troubleshooting process for login failures, email failures, and subscription exceptions.
- The release process needs to include a rollback plan and a release window strategy that minimizes the impact.


## Follow-up

- In the subsequent implementation phase, this ADR requirement needs to be mapped to database migration, API contract and test cases.
- If the business rules change, the supersede relationship needs to be clarified through the new ADR.
