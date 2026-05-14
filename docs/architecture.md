# Architecture

## System type
B2B Web SaaS.

## Components
- Frontend: TBD
- Backend: TBD
- Database: TBD
- Authentication: TBD
- Email: Gmail API / SES / SMTP, TBD
- Hosting: TBD
- CI/CD: GitHub Actions, TBD

## High-level flow

Browser
  ↓ HTTPS
Frontend
  ↓ API
Backend
  ↓
Database / Email Provider / Logs

## Tenant model
- Each customer company is a tenant.
- Each user belongs to one tenant.
- All business data must be scoped by tenant_id.
- Frontend must not be trusted for tenant_id.

## Subscription model
- trial
- active
- expired
- suspended

## Security principles
- Billing and authorization must be enforced in backend.
- No production secrets in repository.
- No cross-tenant access.
