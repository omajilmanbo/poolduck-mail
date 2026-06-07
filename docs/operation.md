# Operation, maintenance and troubleshooting manual (first edition)

## 1. Login failed

Troubleshooting steps:
1. Confirm user status (active/suspended)
2. Check the number of password errors and locking policy
3. Check the authentication service log (401/403)
4. Check whether JWT_SECRET or session configuration is abnormal

## 2. Email sending failed

Troubleshooting steps:
1. Check the failure status and error information in `mail_jobs`
2. Prioritize checking Sandbox/Mock provider recording and returning errors in the MVP stage
3. Check the inbox address format and domain name policy
4. Only after connecting to the real provider in the non-MVP stage, check the SMTP/provider credentials and connectivity.

## 3. Subscription exception

Troubleshooting steps:
1. Check `subscriptions` status and validity period
2. Call `/api/license/check` to verify the return
3. Check time zone and expiration judgment logic
4. Confirm whether the subscription status is one of `trial` / `active` / `expired` / `suspended`, and check the access control action

## 4. Tenant isolation exception (high priority)

Troubleshooting steps:
1. Review the tenant context in the request
2. Check if the SQL query contains tenant_id filter
3. Check the unauthorized access records in the audit log
4. Immediately block suspicious access and escalate the processing
