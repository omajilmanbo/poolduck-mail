# Current stage review report (review)

## 1. Overall conclusion
- Whether it is possible to enter the next stage: **need to be corrected first**

## 2. Confirmed consistent content
- Excluded MVP's 'custom mail body' consistent in core documentation: `docs/api.md`, `docs/requirements.md`, `docs/user-guide.md` all explicitly pin the template and disallow `custom_message/custom_text/mail_body`.
- The main collection of subscription states is consistent in the core documentation: `trial` / `active` / `expired` / `suspended`.
- The main set of user roles is consistent in the core documentation: `root_admin` / `manager`.
- The main caliber of the login process is consistent in the core document: `tenant_id + email + password` (the "username/password" in the copy can be aligned with the `email/password` of the API but does not conflict).
- The API draft is basically consistent with the database draft regarding `location_id` dimension isolation and `tenant_id + location_id + scan_code` constraints.

## 3. Issues found

| Severity | File | Problem | Recommended Action |
|---|---|---|---|
| High | README.md vs docs/decisions/ADR-004-tech-stack-for-mvp.md | README writes ADR-004 status as `Proposed`, but the ADR file is already `Accepted`, and README also writes "Completed Project Skeleton", which can easily lead to phase judgment conflicts. | Unify the ADR-004 status and current stage description of README. |
| High | README.md vs ADR-004 | The order of README is defined as `#21=Database Migration`, `#26=sandbox provider`; but the "subsequent impact" of ADR-004 is written as `#21=Sandbox Mail Provider`. Issue number semantic conflict. | Clarify the "current authority number mapping" (it is recommended to refer to the latest execution plan of README), and add "subsequent change description/superseded part" to ADR-004. |
| Medium | docs/database.md / docs/requirements.md / docs/architecture.md | Using the terms "office/school" and `location` simultaneously, although the field naming is basically unified as `location_*`, the Chinese terminology may still cause implementation ambiguity. | Add "office/school unified abstraction to location" in the glossary to avoid introducing `office_id` in new issues. |
| Medium | .github/ISSUE_TEMPLATE | The template does not explicitly require "whether the annotation affects SSOT (role, subscription status, login, fixed body)". | Add a checklist to force the submitter to declare whether SSOT is involved and quote the corresponding documents. |
| Low | docs/testing.md / workflow docs | The requirement for "tenantId/permissions/email destination address exception testing" exists, but the executable checklist is not granular enough. | Add minimum exception test matrix (cross-tenant, subscription invalidation, target mailbox is empty/illegal, location exceeds authority). |

## 4. Missing items
- Missing "Single Source of Truth for Terms and Numbers (SSOT) page": unified maintenance of `location`, role, subscription status, and Issue number mapping.
- The "README and ADR cross-check" pre-release check item is missing, resulting in status and sequence conflicts this time.
- The "input/output contract diagram" of #21~#26 is missing (which tables/APIs/middleware capabilities each Issue consumes and produces).

## 5. Suggested issues to be added or modified
- Title: `[Task] Align README and ADR-004 phase status and issue number mapping`
- Background: The current README and ADR-004 status conflict with #21 semantics, affecting scheduling and execution judgment.
- Acceptance criteria:
  - README and ADR-004 are completely consistent with "current stage" and "#21~#26 mapping";
  - Give notes on historical number changes without deleting traceable information;
  - Attach a conflict list to the PR.

- Title: `[Task] New SSOT consistency checklist (Issue/PR template)`
- Background: Avoid subsequent drift of roles, subscription status, login process, and email body templates.
- Acceptance criteria:
  - `.github/ISSUE_TEMPLATE/*` and PR template add SSOT check items;
  - Whether the requirement check affects docs/api.md, docs/database.md, docs/requirements.md;
  - This check item is visible in CI or review checklist.

## 6. Evaluation of the execution order of #21~#26
- The dependency logic is generally reasonable: first close the loop between the data model and authenticated tenants, and then do subscription access control, mapping read-only, scan code tasks, and send triggers.
- However, it is not recommended to directly advance the implementation before the "numbering semantic conflict" is corrected; otherwise developers may understand #21 according to the old numbering of ADR-004.
- It is recommended to complete the "Number Mapping Alignment Task" before proceeding to #21.

## 7. Do you recommend continuing #21?
- **No (current review conclusion)**
- Reason: There is a high-priority document conflict (README vs ADR-004), which will directly affect the task definition and implementation boundaries of #21. The documents need to be aligned before entering development.
