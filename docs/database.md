# 数据库设计（初始草案）

> 说明：字段命名使用英文，文档说明使用中文。

## 1. tenants

- `id` (pk, uuid)
- `name` (varchar)
- `status` (varchar) - active/suspended
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 2. users

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `email` (varchar, unique within tenant)
- `password_hash` (varchar)
- `role` (varchar) - admin/operator
- `status` (varchar)
- `last_login_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 3. subscriptions

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id, unique)
- `plan` (varchar)
- `status` (varchar) - trial/active/expired/canceled
- `start_at` (timestamp)
- `end_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 4. devices

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `device_code` (varchar)
- `name` (varchar)
- `status` (varchar)
- `last_seen_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 5. scan_events

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `device_id` (fk -> devices.id, nullable)
- `scan_code` (varchar)
- `scan_type` (varchar) - barcode/qrcode
- `raw_payload` (text)
- `received_at` (timestamp)
- `created_by_user_id` (fk -> users.id, nullable)
- `created_at` (timestamp)

## 6. mail_jobs

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `scan_event_id` (fk -> scan_events.id, nullable)
- `to_email` (varchar)
- `subject` (varchar)
- `template_key` (varchar)
- `status` (varchar) - queued/sent/failed
- `retry_count` (int)
- `provider_message_id` (varchar, nullable)
- `error_message` (text, nullable)
- `scheduled_at` (timestamp, nullable)
- `sent_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 7. audit_logs

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id, nullable for system ops)
- `actor_user_id` (fk -> users.id, nullable)
- `action` (varchar)
- `resource_type` (varchar)
- `resource_id` (varchar)
- `result` (varchar) - success/fail/denied
- `metadata_json` (jsonb)
- `created_at` (timestamp)

## 8. 索引建议

- `users (tenant_id, email)` unique
- `subscriptions (tenant_id)` unique
- `devices (tenant_id, device_code)` unique
- `scan_events (tenant_id, received_at)`
- `mail_jobs (tenant_id, status, created_at)`
- `audit_logs (tenant_id, created_at)`
