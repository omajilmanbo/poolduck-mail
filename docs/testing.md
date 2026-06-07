# Test strategy (MVP)

## 1. Test target

- Covering the core business closed loop: login → QR code scanning event → email task
- Ensure tenant isolation, permission control, and subscription verification accuracy
- Reduce the risk of high-risk modules (auth/billing/data) going online

## 2. Required test types

### 2.1 Unit testing
- Authentication logic (password verification, token analysis)
- Subscription status judgment (trial/active/expired/suspended)
- Email task status transfer

### 2.2 Integration testing
- API to interact with database
- Scan code event creation to email task generation link
- Retry mechanism and failure record

### 2.3 Permission and security testing
- RBAC role access boundaries
- Unauthorized access blocking
- Input parameter verification and error code consistency

### 2.4 Tenant isolation test (key points)
- Tenant A cannot read/operate Tenant B data
- Cross-tenant ID access must return Deny
- Audit log records unauthorized attempts

### 2.5 Subscription and billing related tests (key points)
- Subscription expiration prohibits key business interfaces
- `trial` / `active` allows scanning QR codes and sending emails, `expired` / `suspended` prohibits scanning QR codes to submit, creating email tasks, sending and retrying
- The license check result is consistent with the subscription status

## 3. Return to baseline

Before each release, execute at least:
- Login related regression
- Tenant isolation returns
- Subscription status return
- Email sending success/failure return

## 4. Quality access control suggestions

- Unit test pass rate 100% (related to new additions/changes)
- High risk modules must contain at least 1 failure scenario test
- Key interfaces must be covered by contract tests or integration tests
