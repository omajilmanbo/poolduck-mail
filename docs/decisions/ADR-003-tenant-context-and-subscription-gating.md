# ADR-003: Tenant context isolation and subscription access rules

- Status: Accepted
- Date: 2026-05-20
- Related Issue: #6

## Context

Why does this decision need to be made?
- Issue #6 The current goal is to first clarify the basic rules of multi-tenancy, role permissions, and subscription constraints, rather than directly implementing middleware or RBAC code.

What problems are you currently experiencing?
- There are inconsistencies in the naming of `tenant_id` sources, administrator permission boundaries, and subscription status in the document.
- Whether the login process requires entering `tenant_id` first is not unified, which may lead to implementation deviation.
- The subscription access control conditions of the business interface are not fully explicit, and there is a risk of sending emails by mistake.

What business or technical constraints are there?
- This time only document clarification is allowed, authentication middleware, RBAC code, and subscription check API are not implemented.
- The business flow needs to be met: the customer enters `tenant_id` → enters the administrator username and password → enters the business interface.
- It is necessary to reduce the risk of cross-tenant access and ensure that QR code scanning and email sending are prohibited when the subscription is invalid.

## Decision

Which option was chosen in the end?
1. The login interface explicitly receives `tenant_id`, and the backend first verifies whether the tenant exists, and then verifies whether the user belongs to the tenant and the password is correct.
2. After successful login, the business interface only uses the `tenant_id` in token/session as the tenant context, and does not accept the explicit passing of `tenant_id` from the business interface.
3. MVP role boundaries:
   - `root_admin`: can maintain user accounts, subscriptions, offices/schools, and execute the administrator interface.
   - `manager`: Only maintenance personnel can view and execute the QR code scanning process. Subscriptions and offices/schools cannot be maintained.
4. The subscription status is unified as: `trial` / `active` / `expired` / `suspended`.
5. Function access control: only `trial` and `active` allow scanning QR codes and sending emails; `expired` and `suspended` prohibit scanning QR codes to submit, creating emails and retrying.

## Alternatives considered

What alternatives were considered? Why didn't you choose?
- Solution A: Do not enter `tenant_id` during the login phase, and only check the tenant by user name.
  Reason for not being selected: The "enter tenant_id first and then log in" process requirements proposed by the current business are not met.
- Option B: The business interface continues to allow the front end to pass `tenant_id`.
  Reason for not selected: It is easy to introduce the risk of cross-tenant overreach.
- Option C: Subscription status continues to use `canceled`.
  Reason for not being selected: It is inconsistent with the current "suspended" semantics and conflicts with this unified goal.

## Consequences

The positive and negative consequences of this decision.
- Front:
  - Unify login and tenant isolation rules to reduce cross-tenant access risks.
  - Unify subscription status and access control conditions to reduce the risk of accidentally sending emails.
  - The terminology of requirements, architecture, API, and database documents are consistent to reduce subsequent implementation deviations.
- Negative:
  - Add one step to the login experience (enter `tenant_id` first).
  - More clear error codes and international prompt copy need to be added in the subsequent implementation phase.

## Migration impact

Does it affect existing data, code, and deployment?
- Currently only the documentation is updated, no changes to the runtime code or deployment process.
- If the historical implementation or data uses `canceled`, the mapping strategy for migrating to `suspended` needs to be evaluated during the implementation phase.

## Security impact

Does it affect permissions, authentication, tenant isolation, and data security?
- Strengthen tenant isolation: verify tenant existence and user ownership when logging in, and prohibit business interfaces from switching tenants through client parameters after logging in.
- Strengthen permission boundaries: clarify the executable scope of `root_admin` and `manager`.
- Strengthen subscription access control: block key links for QR code scanning and email sending when the subscription is invalid.

## Operational impact

Will it affect deployment, monitoring, backup, and troubleshooting?
- No direct changes to deployment and backup processes.
- Monitoring can add login failure categories (tenant does not exist/user does not belong to tenant/password is incorrect) and subscription access rejection event statistics.
- Customer service and operation and maintenance can provide troubleshooting instructions based on the unified subscription status (`trial`/`active`/`expired`/`suspended`).

## Follow-up

What issues need to be created or what documents need to be supplemented in the future?
- New implementation class Issue: login verification sequence and error code implementation (tenant does not exist, user does not belong to tenant, password is wrong).
- Create a new test category Issue: covering administrators/ordinary users, valid/expired/suspended subscriptions, and cross-tenant access exception scenarios.
- Supplementary documentation: Add standard error codes and error response examples to `docs/api.md` (subsequent implementation phase).
