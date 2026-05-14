# API Specification

## Auth

### POST /api/auth/login
Login with email and password.

### POST /api/auth/logout
Logout current user.

### GET /api/me
Return current user.

## License

### GET /api/license/check
Return current tenant subscription status.

## Mail

### POST /api/mail/jobs
Create mail sending job.

### GET /api/mail/jobs
List mail jobs.

### GET /api/mail/jobs/{id}
Get mail job detail.

## Admin

### GET /api/admin/tenants
List tenants.

### PATCH /api/admin/tenants/{id}/subscription
Update subscription status.
