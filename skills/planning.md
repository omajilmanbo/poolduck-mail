# Planning Skill

When asked to split work into GitHub Issues, create **compact, independently implementable** Issues.

## Default issue body

Use only these sections unless a task genuinely needs more detail:

1. **目标与范围** — short bullets for the problem, intended work, and what is explicitly not included.
2. **验收与测试** — observable acceptance criteria and the tests/checks to run.
3. **待确认 / 外部前提** — include only when there is a real human decision, permission, secret, account, environment, or external-service dependency. Otherwise omit it.

Put role and risk in GitHub labels rather than duplicating them in the body. Add dependencies as a single short line only when they affect implementation order.

## Rules

- Each Issue should be 1–8 hours; split oversized work.
- Prefer short bullets over prose and do not restate repository-wide security rules in every Issue.
- Link the source requirement, ADR, or existing Issue only when it is directly relevant.
- Mark auth, billing, data, security, architecture, or external-service decisions as requiring human approval **only when a real decision is unresolved**.
- When details emerge later, use Issue comments instead of expanding the initial template pre-emptively.
