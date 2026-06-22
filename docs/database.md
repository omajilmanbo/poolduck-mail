# 数据库设计（初始草案）

> 说明：字段命名使用英文，文档说明使用中文。

## 1. tenants

> 用法：租户主表，代表一个独立客户组织；用于多租户数据隔离与计费归属的顶层边界。

- `id` (pk, uuid)
- `name` (varchar)
- `status` (varchar) - active/suspended
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 2. users

> 用法：可登录系统的管理员账号表（仅后台管理用户，不等同于收件人）。管理员分两类：`root_admin`（可编辑订阅、增减 location）与 `manager`（仅可维护 `person_mappings`）。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `email` (varchar, unique within tenant)
- `password_hash` (varchar)
- `role` (varchar) - root_admin/manager
- `status` (varchar)
- `last_login_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 3. subscriptions

> 用法：订阅配置表（MVP 先按 tenant 统一订阅）；由 `root_admin` 管理。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id, unique)
- `plan` (varchar)
- `status` (varchar) - trial/active/expired/suspended
- `start_at` (timestamp)
- `end_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 4. devices

> 用法：扫码设备注册表，记录租户下可上报扫码事件的终端设备。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `device_code` (varchar)
- `name` (varchar)
- `status` (varchar)
- `last_seen_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 5. scan_events

> 用法：扫码事件流水表，保存原始扫码输入与接收时间，用于追溯和后续邮件任务关联。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `device_id` (fk -> devices.id, nullable)
- `scan_code` (varchar)
- `scan_type` (varchar) - barcode/qrcode
- `raw_payload` (text)
- `received_at` (timestamp)
- `created_by_user_id` (fk -> users.id, nullable)
- `created_at` (timestamp)

## 6. locations（办公室/学校）

> 用法：办公室/学校上下文表；用户在扫码前需先选择当前 location，后续查找与发送行为均在该上下文内完成。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `location_code` (varchar) - 业务可读编码，如 OFFICE_A / SCHOOL_1
- `name` (varchar) - 办公室/学校名称
- `type` (varchar) - office/school
- `status` (varchar) - active/inactive
- `created_at` (timestamp)
- `updated_at` (timestamp)

> 说明：为满足“扫码前先切换办公室/校舍”，`locations` 作为租户内的唯一正式上下文命名。

## 7. person_mappings（扫码编号与人员邮箱映射）

> 用法：非登录人员（收件人）映射表，维护 location 内的 `scan_code -> person_name/email`；由 `manager` 与 `root_admin` 维护。与 `users` 严格区分：`users` 是登录管理员，`person_mappings` 是业务通讯录映射。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `location_id` (fk -> locations.id)
- `scan_code` (varchar)
- `person_name` (varchar)
- `email` (varchar)
- `status` (varchar) - active/inactive
- `created_at` (timestamp)
- `updated_at` (timestamp)

> 查询约束：`scan_code` 查找必须同时带上 `tenant_id` 与当前 `location_id`（办公室/学校上下文），禁止仅按 `scan_code` 全局查找，避免跨租户或跨办公室/学校误匹配。

## 8. mail_jobs

> 用法：邮件发送任务表，记录从生成到发送完成/失败的投递状态与错误信息。MVP 仅保存系统生成后的最终 `subject`/`body`，不单独保存用户自定义正文。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `scan_event_id` (fk -> scan_events.id, nullable)
- `to_email` (varchar)
- `subject` (varchar)
- `body` (text)
- `template_key` (varchar)
- `status` (varchar) - queued/sent/failed
- `retry_count` (int)
- `provider_message_id` (varchar, nullable)
- `error_message` (text, nullable)
- `scheduled_at` (timestamp, nullable)
- `sent_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 9. audit_logs

> 用法：审计日志表，记录管理员关键操作、资源对象与执行结果，满足合规与问题追踪。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id, nullable for system ops)
- `actor_user_id` (fk -> users.id, nullable)
- `action` (varchar)
- `resource_type` (varchar)
- `resource_id` (varchar)
- `result` (varchar) - success/fail/denied
- `metadata_json` (jsonb)
- `created_at` (timestamp)

## 10. 索引建议

- `users (tenant_id, email)` unique
- `users (tenant_id, role, status)`
- `subscriptions (tenant_id)` unique
- `devices (tenant_id, device_code)` unique
- `scan_events (tenant_id, received_at)`
- `locations (tenant_id, location_code)` unique
- `locations (tenant_id, name)`
- `person_mappings (tenant_id, location_id, scan_code)` unique
- `person_mappings (tenant_id, location_id, status, updated_at)`
- `mail_jobs (tenant_id, status, created_at)`
- `audit_logs (tenant_id, created_at)`

## 11. Migration baseline (Issue #21)

The initial migration is implemented with Prisma under `backend/prisma/`.

Implementation notes:

- Prisma schema: `backend/prisma/schema.prisma`.
- Initial migration SQL: `backend/prisma/migrations/20260622000000_init/migration.sql`.
- The implementation includes the initial MVP tables: `tenants`, `users`, `subscriptions`, `devices`, `locations`, `person_mappings`, `scan_events`, `mail_jobs`, and `audit_logs`.
- Status fields remain `varchar` columns at the database layer to match this document; business validation will be enforced in service/API layers in later issues.
- `scan_events.location_id` is included as a nullable foreign key to `locations.id` so scan history can be queried by the selected location context described in ADR-002 and `docs/api.md`.
- `person_mappings` has the required unique constraint on `(tenant_id, location_id, scan_code)`.
- Core tenant-scoped indexes are included for users, devices, locations, person mappings, scan events, mail jobs, and audit logs.

Local migration commands:

```bash
cd backend
npm run db:validate
npm run db:migrate
npm run db:deploy
npm run prisma:generate
```

`db:migrate` is for local development and creates/applies migration history. `db:deploy` applies committed migrations in CI/Staging/Production-like environments. Both require `DATABASE_URL` to point to the target PostgreSQL database.

Model smoke test:

```bash
cd backend
npm run db:deploy
npm run test:db
```

The smoke test creates a tenant, subscription, user, location, person mapping, scan event, mail job, and audit log using synthetic data only. Do not run it against a database containing real customer data.
