# Staging HTTPS Smoke Test - 2026-07-29

## Scope

Deploy Issue #107 / ADR-012 to the existing OCI Staging environment, replace
Nginx with Caddy, obtain a Let's Encrypt certificate for
`app.poolducktest.com`, preserve the mock mail and synthetic-data boundary,
and verify the HTTPS, routing, authentication, API smoke, persistence, and
network-exposure requirements. Production and real mail delivery were out of
scope.

## Infrastructure Safety

- A compressed PostgreSQL backup was created before the first deployment at
  `/opt/poolduck-mail/backups/pre-issue107-20260729T050515Z.sql.gz`.
- The backup passed `gzip -t`, was non-empty, and had mode `0600`.
- The first ACME attempt failed because the existing `/32` Web ingress blocked
  Let's Encrypt HTTP-01 validation. The application was immediately rolled
  back to the previous Nginx commit and public HTTP health checks returned
  `200`.
- The user then explicitly approved public TCP `80` and `443` for Staging.
  A targeted Terraform plan changed only the HTTP and HTTPS NSG rules from
  `121.110.176.251/32` to `0.0.0.0/0`: `0` added, `2` changed, `0` destroyed.
- SSH remained restricted to the administrator CIDR. Public checks confirmed
  that `3000`, `3001`, and `5432` were unreachable.
- A full Terraform plan was not applied because unrelated image/cloud-init
  drift would replace the existing VM.

## Deployment

- Public URL: `https://app.poolducktest.com`
- Runtime: Docker Compose on the existing OCI VM
- Edge proxy: `caddy:2.11.4-alpine`
- Certificate issuer: Let's Encrypt `YE2`
- Certificate SAN: `DNS:app.poolducktest.com`
- Certificate validity observed: 2026-07-29 04:15:33 UTC through
  2026-10-27 04:15:32 UTC
- Mail provider: `mock`
- Data: synthetic seed only
- Application commit deployed:
  `337600792ad7023d867489ab835a994e6ca98574`
- Draft PR: #108

The Staging `.env` remained outside Git with mode `0600`. Its public URL,
frontend build URL, and CORS origin were changed to
`https://app.poolducktest.com`; secret values were not printed or committed.
Caddy `/data` and `/config` use dedicated Docker named volumes.

## Verification

- The Backend, Frontend, PostgreSQL, and Caddy containers were healthy.
- Caddy served and finalized the Let's Encrypt HTTP-01 challenge through the
  production ACME endpoint.
- HTTP `/` returned `308` with
  `Location: https://app.poolducktest.com/`.
- HTTPS `/`, `/health`, and `/healthz` returned `200`.
- Responses included HSTS, `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.
- The approved CORS origin was allowed and an unrelated origin received no
  `Access-Control-Allow-Origin` response header.
- Synthetic HTTPS login returned `201`; authentication cookies included
  `Secure`, `HttpOnly`, and `SameSite=Lax`.
- `npm run staging:seed` passed twice consecutively.
- `npm run smoke:api` passed with explicit Staging inputs and completed login,
  location access, mapped/unmapped scans, mock mail creation, and mock delivery
  with `send_status: sent`.
- Public TCP `80` and `443` were reachable. Public TCP `3000`, `3001`, and
  `5432` were unreachable; the host listeners for those services remained
  bound to `127.0.0.1`.
- Recreating only the Caddy container reused the existing certificate from the
  named volume, did not start a new certificate obtain flow, became healthy,
  and continued serving HTTPS `200`.
- The remote checkout matched the deployed commit and `.env` remained mode
  `0600`.

## Security Boundary And Residual Risk

TLS protects traffic in transit but does not remove the attack surface of a
public application endpoint. Public Staging can receive credential attacks,
application probes, and resource-exhaustion traffic. Existing authentication
rate limits, RBAC, tenant isolation, mock mail, synthetic data, restricted SSH,
private application/database ports, container logs, and timely dependency
maintenance remain required controls.

Centralized monitoring and backup automation are still tracked separately.
The unrelated Terraform VM-replacement drift must be reviewed before any
future non-targeted apply.
