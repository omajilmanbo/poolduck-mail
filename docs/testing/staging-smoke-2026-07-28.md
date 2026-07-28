# Staging Smoke Test - 2026-07-28

## Scope

Redeploy the changes completed by PR #105 to the existing OCI Staging
environment, keep the mock mail provider and synthetic data, and verify the
public-ID, login, location-permission, scan-action, and delayed-deletion release
baseline. Production and real mail delivery were out of scope.

## Infrastructure Safety

- The current administrator public address was resolved before connecting.
- Only the OCI SSH ingress rule was changed, from a single-address rule to the
  corresponding administrator `/24`.
- A targeted Terraform plan/apply changed one NSG rule with `0` resources added
  and `0` destroyed. A second targeted plan reported no changes.
- A full Terraform plan was not applied because unrelated compute image and
  cloud-init drift would have replaced the Staging VM.
- HTTP and HTTPS ingress rules were not widened.

## Deployment

- Public URL: `http://140.245.94.111`
- Runtime: Docker Compose on the existing OCI VM
- Mail provider: `mock`
- Data: synthetic seed only
- Application commit deployed: `b44748ac5e2e7d8284482d5b1b3718a12cfd6902`

Before deployment, a compressed PostgreSQL backup was created under the
host-only Staging backup directory and passed `gzip -t`. Existing uncommitted
manual runtime files on the VM were preserved in a Git stash before the clean
checkout. Staging-only secrets remained in the host `.env` with mode `0600` and
were not printed or committed.

The Backend, Frontend, PostgreSQL, and reverse-proxy containers were rebuilt or
restarted as required and finished healthy. The Backend reported no pending
database migrations.

## Verification

- `npm run staging:seed` passed twice consecutively.
- `npm run smoke:api` passed with explicit Staging tenant, operator, location,
  mapped action code, and unmapped action code inputs.
- The smoke flow completed login, scan creation, mock mail creation, and mock
  send with `send_status: sent`.
- Public `GET /health` returned HTTP `200` for the Backend.
- Public `GET /healthz` returned HTTP `200` for the Frontend.
- The remote checkout was clean and matched the deployed commit.

## Problem Encountered And Prevention

The first seed run after the identity migration failed with Prisma `P2002`
because a legacy synthetic user already had the fixed seed ID but did not yet
match the new tenant-scoped username or email selector. The seed attempted to
create a second row with that fixed ID.

The user seed helper now resolves by tenant-scoped identity first and then by
the fixed synthetic ID. Existing rows are updated in place; only missing rows
are created. Backend lint passed, and both Local and Staging seed runs passed
twice, providing an idempotency regression check.

## Residual Risk

The full Terraform plan still contains unrelated VM replacement drift. That
drift must be reviewed separately before any future non-targeted apply.
