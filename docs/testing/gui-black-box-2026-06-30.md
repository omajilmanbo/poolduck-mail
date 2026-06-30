# GUI Black-box and E2E Smoke Report - Issue #57

Date: 2026-06-30

Environment:

- Local container group: `docker compose up -d --build`
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`
- Database: local Compose PostgreSQL 16
- Mail provider: sandbox/mock only
- Seed command: `docker compose exec -T backend npm run local:seed`

## Scope

This report covers the MVP scan workspace from a user perspective:

- Login with `tenant_id`, email, and password
- Subscription state display and scan/send disabling
- Location selection and readonly person mapping
- Scan submission and queued mail_job display
- Manual sandbox send trigger and result display
- Critical failure paths needed before Staging validation

Out of scope:

- Full UI polish
- Full regression automation
- Real email delivery
- Security audit or penetration testing

## Seed Accounts

| Case | tenant_id | Email | Password |
|---|---|---|---|
| Active manager | `11111111-1111-4111-8111-111111111111` | `manager@example.local` | `PoolduckLocal123!` |
| Suspended manager | `22222222-2222-4222-8222-222222222222` | `suspended-manager@example.local` | `PoolduckLocal123!` |

## Manual Black-box Checklist

| Area | Case | Steps | Expected result | Result |
|---|---|---|---|---|
| Normal | Active login | Open `/`, login with active manager | Workspace opens | Pass |
| Normal | Location/person mapping | Select `Local Office` | `Local Recipient`, `SCAN-LOCAL-001`, and masked email are visible | Pass |
| Normal | Scan submit | Submit `SCAN-LOCAL-001` | New scan record appears with mail status `发送中` | Pass |
| Normal | Sandbox send success | Click send on queued record | Mail status becomes `已发送` | Pass |
| Error | Unauthenticated access | Open `/` in a fresh browser context | Login screen is shown before workspace data loads | Pass |
| Error | Unmapped scan code | Submit `SCAN-LOCAL-UNMAPPED` | Error feedback is shown and no mail send button is created for that scan | Pass via API smoke and GUI checklist |
| Permission/license | Suspended tenant | Login with suspended manager | Scan input and submit are disabled | Pass |
| Tenant isolation | Suspended tenant visibility | Login with suspended manager | Active tenant locations/person mappings are not visible | Pass |
| Boundary | Empty scan input | Leave scan field empty | Submit button remains disabled | Pass |
| Regression | Custom mail body | Submit scan through GUI | Request contains only `location_id` and `scan_code`; no custom body fields | Pass via frontend unit test |
| Regression | Token/session | Clear token or use fresh context | Workspace requires login again | Pass |
| Mail failure | Sandbox failure | Run backend with `MAIL_MOCK_SEND_RESULT=failure` and execute send smoke | Mail job reaches `failed` without sending real email | Pass via API smoke path |

## Automated E2E Smoke

Command:

```powershell
cd frontend
npm run test:e2e
```

Result:

- Pass: 2 tests passed
- Local Windows run used system Chrome through Playwright `channel: chrome` fallback because Playwright browser installation did not complete cleanly in this environment.

Coverage:

- Active manager login
- Location/person mapping visible
- Scan code `SCAN-LOCAL-001` creates a queued record
- Manual send changes status to `已发送`
- Suspended manager login disables scan controls and does not expose active tenant person mapping

## Required Command Checks

Run before considering Staging deployment verification:

```powershell
cd backend
npm test
npm run build

cd ../frontend
npm test
npm run build
npm run test:e2e
```

Container smoke:

```powershell
docker compose up -d --build
docker compose exec -T backend npm run local:seed
docker compose exec -T backend npm run smoke:api
```

Executed results:

- `cd backend && npm test`: Pass, 10 suites / 44 tests
- `cd backend && npm run build`: Pass
- `cd frontend && npm test`: Pass, 5 tests
- `cd frontend && npm run build`: Pass
- `cd frontend && npm run test:e2e`: Pass, 2 tests
- `docker compose exec -T backend npm run local:seed`: Pass
- `docker compose exec -T backend npm run smoke:api`: Pass, `send_status=sent`
- `docker compose exec -T -e API_SMOKE_EXPECT_SEND_STATUS=failed backend npm run smoke:api` with backend `MAIL_MOCK_SEND_RESULT=failure`: Pass, `send_status=failed`

## Known Issues / Follow-up

- GUI copy, layout density, and fine-grained visual polish are intentionally deferred.
- Full automated GUI coverage for every failure path is deferred; this issue adds only the MVP E2E smoke.
- Sandbox failure is verified through the send/API path. A dedicated GUI failure-mode test can be added when test orchestration can safely restart backend with alternate mail provider settings.

## Staging Readiness Conclusion

Result: Pass for MVP local GUI black-box and E2E smoke.

Recommendation: allow entering Staging deployment verification after human confirmation, using synthetic seed data and sandbox/mock mail provider only.
