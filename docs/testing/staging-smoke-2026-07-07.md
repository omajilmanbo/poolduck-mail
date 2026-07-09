# Staging Smoke Test - 2026-07-07

Issue: #58

## Scope

Execute the MVP Staging deployment on the prepared OCI compute instance using temporary public-IP HTTP access. No domain, TLS, production mail provider, production data, or CI/CD automation was introduced.

## Environment

- Commit deployed from `origin/main`: `6b519ba9e8f95d2c8f816080b5cd0d5858cf798f`
- Public URL: `http://168.138.211.9`
- SSH user: `ubuntu`
- Runtime: Docker Compose on single OCI VM
- Public entry: Nginx reverse proxy on port `80`
- Internal bindings:
  - Backend: `127.0.0.1:3001`
  - Frontend: `127.0.0.1:3000`
  - PostgreSQL: `127.0.0.1:5432`
- Mail provider: `mock`
- Data: synthetic seed only

Secrets were generated on the Staging host and were not committed or recorded.

## Deployment Notes

- `terraform init` and `terraform output` work in the current local workspace.
- `terraform validate` still fails locally with OCI provider schema not responding. This is recorded as an Issue #58 memo and does not block #58 because no IaC change, plan, or apply was performed.
- The first Staging boot failed because a random database password contained URL-reserved characters and was inserted into `DATABASE_URL` without URL encoding. The disposable Staging volume was recreated with a URL-safe hex password.
- During a temporary backend recreate for mock failure testing, an early smoke run hit an Nginx `502` while Backend was still starting. Re-running after Backend became healthy passed.

## Commands And Results

Infrastructure and runtime:

```bash
terraform output
ssh ubuntu@168.138.211.9 "hostname; docker --version; docker compose version"
```

Result:

- `compute_public_ip`: `168.138.211.9`
- Hostname: `app01`
- Docker: `29.5.3`
- Docker Compose: `v5.1.4`

Container deployment:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
```

Result:

- `poolduck-mail-postgres`: healthy
- `poolduck-mail-backend`: healthy
- `poolduck-mail-frontend`: healthy
- `poolduck-mail-staging-proxy`: healthy

Seed:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run local:seed
```

Result: pass. Synthetic tenants, users, locations, and scan mappings were created.

Public health checks:

```bash
curl -fsS http://168.138.211.9/health
curl -fsS http://168.138.211.9/healthz
curl -fsS http://168.138.211.9/
```

Result:

- Backend health returned `{"status":"ok","service":"poolduck-mail-backend"}`.
- Frontend health returned `{"status":"ok","service":"poolduck-mail-frontend"}`.
- Frontend login page returned successfully and showed API base `http://168.138.211.9`.

API success smoke:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T -e API_BASE_URL=http://reverse-proxy backend npm run smoke:api
```

Result: pass, final run created a queued mail job and sent it with mock provider:

```json
{
  "tenant_id": "11111111-1111-4111-8111-111111111111",
  "location_id": "66666666-6666-4666-8666-666666666666",
  "send_status": "sent"
}
```

Suspended subscription smoke:

Result: pass.

```json
{
  "tenant_id": "22222222-2222-4222-8222-222222222222",
  "license_status": "suspended",
  "can_send": false,
  "scan_status": 403,
  "scan_code": "SUBSCRIPTION_NOT_SENDABLE"
}
```

Mock failure smoke:

`MAIL_MOCK_SEND_RESULT` was temporarily changed to `failure`, Backend was recreated, and the API smoke was run with `API_SMOKE_EXPECT_SEND_STATUS=failed`.

Result: pass.

```json
{
  "tenant_id": "11111111-1111-4111-8111-111111111111",
  "location_id": "66666666-6666-4666-8666-666666666666",
  "send_status": "failed"
}
```

Final state:

- `MAIL_MOCK_SEND_RESULT=success`
- All containers healthy
- Public `/health` and `/healthz` passing

## Reverification - 2026-07-08

Public Staging entry was rechecked from the local workspace against `http://168.138.211.9`.

Commands:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri http://168.138.211.9/health
Invoke-WebRequest -UseBasicParsing -Uri http://168.138.211.9/healthz
Invoke-WebRequest -UseBasicParsing -Uri http://168.138.211.9/
$env:API_BASE_URL='http://168.138.211.9'; npm.cmd run smoke:api
```

Result:

- Backend health returned `{"status":"ok","service":"poolduck-mail-backend"}`.
- Frontend health returned `{"status":"ok","service":"poolduck-mail-frontend"}`.
- Frontend root returned HTTP `200`.
- API smoke passed against the public Staging URL with mock send success:

```json
{
  "tenant_id": "11111111-1111-4111-8111-111111111111",
  "location_id": "66666666-6666-4666-8666-666666666666",
  "scan_event_id": "26c1d2f3-292f-4688-92c2-a8ba83563701",
  "mail_job_id": "8ed6d194-9e85-410c-8c34-c92165fd8744",
  "send_status": "sent"
}
```

Suspended subscription gate was rechecked through the public API:

```json
{
  "tenant_id": "22222222-2222-4222-8222-222222222222",
  "license_status": "suspended",
  "can_send": false,
  "scan_status": 403,
  "scan_code": "SUBSCRIPTION_NOT_SENDABLE"
}
```

Expired subscription gate was not rechecked on 2026-07-08. At that time the applied synthetic seed provided a suspended tenant but not a fixed expired tenant; later runs should refresh Staging with `npm run staging:seed` before rechecking the expired path.

Mock failure-path verification was not re-run on 2026-07-08 because it requires changing `MAIL_MOCK_SEND_RESULT` on the Staging host and recreating Backend. The 2026-07-07 failure-path run remains the recorded result, and the final documented Staging state remains `MAIL_MOCK_SEND_RESULT=success`.

## Residual Risks

- The deployment currently uses plain HTTP by public IP. Add domain and TLS before any broader non-internal testing.
- OCI NSG currently allows public HTTP and HTTPS. SSH CIDR should be reviewed and narrowed if it is still broad in the applied state.
- Public IP was observed by external crawlers shortly after deployment; do not place customer data or production credentials in this environment.
- Staging deployment is manual. No GitHub Actions deployment or rollback automation exists yet.
- PostgreSQL backup and restore strategy remains a follow-up issue.

## Rebuild - 2026-07-09

The Staging compute instance was rebuilt with a new local SSH key stored under the gitignored `.secrets/staging/` directory.

Terraform outputs after apply:

- `compute_public_ip`: `140.245.94.111`
- `compute_private_ip`: `10.48.10.163`
- `compute_instance_id`: `ocid1.instance.oc1.ap-tokyo-1.anxhiljrr4cjrwace7oiqr3y66o245ndo5zkuqtnihungayqa7wia2spr2ma`

Post-rebuild deployment result:

- Runtime fix: `docker-compose-plugin` was unavailable on the Ubuntu 22.04 arm64 image, so `docker-compose-v2` was installed. The IaC cloud-init template was updated to use `docker-compose-v2` for future rebuilds.
- Application source: cloned from `origin/main`, then overlaid with the current local Staging compose and `staging:seed` files because those changes are not yet merged.
- Environment: `.env` was generated with Staging-only random database/JWT secrets. Secrets were not recorded in docs.
- Mail provider final state: `MAIL_PROVIDER=mock`, `MAIL_MOCK_SEND_RESULT=success`.
- Containers: PostgreSQL, Backend, Frontend, and reverse-proxy all healthy.

Commands:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T \
  -e API_BASE_URL=http://reverse-proxy \
  -e API_SMOKE_TENANT_ID=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa \
  -e API_SMOKE_EMAIL=staging-active-manager@example.local \
  -e API_SMOKE_PASSWORD=PoolduckStaging123! \
  -e API_SMOKE_LOCATION_ID=dddddddd-dddd-4ddd-8ddd-dddddddddddd \
  -e API_SMOKE_SCAN_CODE=SCAN-STG-ACTIVE-001 \
  -e API_SMOKE_UNMAPPED_SCAN_CODE=SCAN-STG-UNMAPPED \
  backend npm run smoke:api
```

Staging seed result:

- active tenant: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
- suspended tenant: `11111112-1112-4112-8112-111111111112`
- expired tenant: `66666667-6667-4667-8667-666666666667`

API success smoke result:

```json
{
  "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "location_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "scan_event_id": "bd865f05-b9e9-4d49-a613-b542f09cbe1d",
  "mail_job_id": "248fcc1f-edbd-4b25-a702-18a2831cd145",
  "send_status": "sent"
}
```

Public health checks:

- `GET http://140.245.94.111/health`: `{"status":"ok","service":"poolduck-mail-backend"}`
- `GET http://140.245.94.111/healthz`: `{"status":"ok","service":"poolduck-mail-frontend"}`
- `GET http://140.245.94.111/`: HTTP `200`

Subscription gate checks:

```json
[
  {
    "case": "suspended",
    "tenant_id": "11111112-1112-4112-8112-111111111112",
    "license_status": "suspended",
    "can_send": false,
    "scan_status": 403,
    "scan_code": "SUBSCRIPTION_NOT_SENDABLE"
  },
  {
    "case": "expired",
    "tenant_id": "66666667-6667-4667-8667-666666666667",
    "license_status": "expired",
    "can_send": false,
    "scan_status": 403,
    "scan_code": "SUBSCRIPTION_NOT_SENDABLE"
  }
]
```

Mock failure smoke result:

```json
{
  "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "location_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "scan_event_id": "a63226f2-31c2-4203-b11a-8b814a0be892",
  "mail_job_id": "8ab37c7f-37a9-456b-9512-841c332b2874",
  "send_status": "failed"
}
```

Final state:

- `MAIL_MOCK_SEND_RESULT=success`
- PostgreSQL, Backend, Frontend, and reverse-proxy healthy.
- Public `/health`, `/healthz`, and `/` passing.

### Problems encountered and prevention

1. `docker-compose-plugin` was not available on the OCI Ubuntu 22.04 arm64 default apt sources.
   - Symptom: cloud-init finished with package install errors and `docker compose version` returned `unknown command`.
   - Fix applied on the VM: installed `docker-compose-v2`.
   - Prevention: `infrastructure/oci-staging/templates/cloud-init.yaml.tftpl` now installs `docker.io` and `docker-compose-v2`.

2. The default SSH user could not access the Docker socket immediately after rebuild.
   - Symptom: `permission denied while trying to connect to the Docker daemon socket`.
   - Fix applied on the VM: used `sudo docker compose` for that deployment session.
   - Prevention: cloud-init now adds the default `ubuntu` user to the `docker` group and owns `/opt/poolduck-mail` by `ubuntu:ubuntu`; operators should open a new SSH session after cloud-init before using non-sudo `docker compose`.

3. The Staging `.env` was corrupted when generated through a nested SSH inline shell command.
   - Symptom: Backend migration failed with Prisma `P1013`, `invalid port number in database URL`.
   - Fix applied on the VM: generated a local gitignored `.secrets/staging/staging.env`, copied it to `/opt/poolduck-mail/app/.env`, reset the disposable Staging volume, and restarted the stack.
   - Prevention: deployment docs now require generating `.secrets/staging/staging.env` locally and copying it to the VM; do not generate secrets through nested SSH heredoc/inline shell expansion.

4. The default API smoke script values target the local seed data.
   - Symptom risk: running `npm run smoke:api` without explicit variables would test local tenant IDs rather than Staging seed IDs.
   - Fix applied: smoke was run with explicit `API_SMOKE_*` variables for the Staging active tenant.
   - Prevention: deployment docs now include the explicit Staging active tenant smoke command, and `staging:seed` prepares active, suspended, and expired tenants.

5. The deployed VM initially used local unmerged Staging files overlaid onto `origin/main`.
   - Symptom risk: the VM can drift from GitHub `main` until the Staging compose and seed files are merged.
   - Fix applied: copied the current local Staging compose, Nginx config, package script, and seed script to the VM for this rebuild.
   - Prevention: merge these Staging runtime files before the next rebuild so the VM can be deployed from `origin/main` without manual overlay.
