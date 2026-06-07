# AGENTS.md

## Skills

Use these skill files when relevant:

- For splitting work into GitHub Issues, read `skills/planning.md`.
- For architecture changes, read `skills/architecture-decision.md`.
- For PR review, read `skills/code-review.md`.
- For test planning, read `skills/test-design.md`.
- For release preparation, read `skills/release-check.md`.



## Documentation policy

When changing behavior, update the corresponding docs:

- Product scope changes → docs/product.md
- Architecture changes → docs/architecture.md and docs/decisions/
- Database schema changes → docs/database.md
- API changes → docs/api.md
- Deployment changes → docs/deployment.md
- User-facing behavior changes → docs/user-guide.md or docs/admin-guide.md

Do not store secrets, customer data, or temporary chat logs in docs.
For important decisions, create an ADR and wait for human approval.
## ADR writing policy

All ADR files under `docs/decisions/` must be created from `docs/decisions/ADR-TEMPLATE.md`.
Do not create or update ADRs with a custom format.
If an ADR does not match the template, update it before implementation.

## ADR reading policy

Before working on any task that affects architecture, authentication, authorization,
tenant isolation, subscription gating, database schema, API design, or mail sending,
the agent must inspect `docs/decisions/` and read all relevant ADR files.

Do not guess ADR filenames.
If an Issue mentions an ADR number such as ADR-003, search `docs/decisions/` for
files beginning with that ADR number, for example `ADR-003-*`.

Current key ADRs:
- ADR-001: Web SaaS for MVP
- ADR-003: Tenant context isolation and subscription gating
- ADR-004: MVP technology stack

If the relevant ADR is missing, not merged, or not `Accepted`, stop and ask for
human confirmation before implementation.


## Working rules
- Update README.md and documents under /docs at any time.
- Only the Scope of the current Issue is implemented each time.
- Implementing content in Out of scope is not allowed.
- Submission of real keys, tokens, Gmail credentials, and OAuth refresh tokens is not allowed.
- The email sending function must use the sandbox/mock provider first during the MVP stage.
- Code involving tenantId, permissions, and email destination addresses must be supplemented with exception testing.
- The PR must describe the test command and test results.
- If the requirements are not clear, ask questions first and do not decide the business rules on your own.

## Review guidelines
- Check whether any omissions in document updates have resulted in the persistence of old text.
- Check for cross-tenant access risks.
- Check for possible mis-sent emails.
- Check whether PII or sensitive email information is logged.
- Check whether the Issue scope has been expanded.
