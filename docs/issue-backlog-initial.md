# The first batch of Issues (can be started directly)

> Note: The following tasks are designed with 1–8 hour granularity and can be used as project startup batches.

## Issue 1 — Basic capabilities of scanning QR code input page

- **Title**: `[Feature] Scan code input page and basic verification`
- **Background**: A minimum available input page is required to receive input from the code scanner and trigger subsequent routing.
- **Scope**:
  - Provide input boxes and submission actions
  - Only supports basic verification of length and character set
  - Error message display
- **Out of scope**:
  - The email is actually sent
  - Multi-step workflow
- **Acceptance criteria**:
  - Legally scanned QR code content can be submitted
  - Illegal content is blocked and prompted
  - Page available in desktop browsers
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual full coverage
- **Recommended labels**:
  - `type:feature`, `area:scanner-input`, `risk:low`
- **Risk labels**: `risk:low`
- **Human decision required**: `No`

## Issue 2 — Mapping rules from QR code scanning results to mailbox (memory version)

- **Title**: `[Feature] QR code scanning result email mapping service`
- **Background**: The scan code results need to be mapped to the target mailbox to form a minimum closed loop.
- **Scope**:
  - Create memory mapping table
  - Hit and miss handling
- **Out of scope**:
  - Database persistence
  -Backend management interface
- **Acceptance criteria**:
  - Return unique mailbox on hit
  - Misses return an identifiable error
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual full coverage
- **Recommended labels**:
  - `type:feature`, `area:mail-routing`, `risk:medium`
- **Risk labels**: `risk:medium`
- **Human decision required**: `No`

## Issue 3 — Email sending service abstraction and sandbox implementation

- **Title**: `[Feature] Email sending interface and sandbox sending implementation`
- **Background**: First connect to the testable sending implementation to prepare for the production sender to connect.
- **Scope**:
  - Define email sending interface
  - Provide a sandbox provider (record sending requests)
  - Upper limit of failed retries (fixed number of times)
- **Out of scope**:
  - Real API from third party providers
  - Queue system
- **Acceptance criteria**:
  - Can call unified interface to send messages
  - Clear errors and logs in case of failure
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual full coverage
- **Recommended labels**:
  - `type:feature`, `area:email-delivery`, `risk:medium`
- **Risk labels**: `risk:medium`
- **Human decision required**: `No`

## Issue 4 — Prototype of multi-tenant isolation middleware

- **Title**: `[Feature] Request isolation middleware based on tenant ID`
- **Background**: SaaS must ensure tenant isolation to avoid cross-tenant access.
- **Scope**:
  - Parse tenantId in request
  - tenantId missing/illegal interception
  - Inject tenant context into business layer
- **Out of scope**:
  - Complete RBAC permission system
  - Billing and package strategies
- **Acceptance criteria**:
  - Request rejected with missing tenantId
  - tenant context can be used for subsequent services
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual full coverage
- **Recommended labels**:
  - `type:feature`, `area:tenant`, `risk:security`
- **Risk labels**: `risk:security`
- **Human decision required**: `Yes` (security policy threshold requires manual confirmation)

## Recommended execution order

1. Issue 1
2. Issue 2
3. Issue 3
4. Issue 4

Meet the "ready to start the first issue" standard: Issue 1 has clear scope, acceptance and testing rules, and can be created and entered into development immediately.
