# Database Design

## Initial tables

### tenants
Customer company.

### users
Login users.

### subscriptions
Tenant subscription status.

### devices
Optional. Used later if device binding is needed.

### audit_logs
Operation logs.

### mail_jobs
Mail sending jobs.

### mail_recipients
Mail recipient details.

## Rules
- Business tables must include tenant_id.
- Queries must filter by tenant_id from authenticated user.
- Do not trust tenant_id from request body.
- Use soft delete for important business data.
