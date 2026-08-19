# 数据库设计（初始草案）

> 说明：字段命名使用英文，文档说明使用中文。

## 1. tenants

> 用法：租户主表，代表一个独立客户组织；用于多租户数据隔离与计费归属的顶层边界。

- `id` (pk, uuid)
- `tenant_code` (varchar(10), unique) - 服务端生成的全局唯一 Crockford Base32 登录标识；不可由客户指定或修改
- `name` (varchar)
- `status` (varchar) - active/suspended
- `location_limit` (integer, positive) - ADR-013 的人工运营额度；active/inactive/pending deletion
  location 均计数，purged 后释放
- `platform_version` (integer) - platform_admin 修改 subscription/额度时使用的乐观并发版本
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 2. users

> 用法：可登录系统的租户账号表（仅后台管理用户，不等同于收件人）。管理员分为
> `tenant_manager`（管理自身 tenant）与 `operator`（仅维护授权地点内的 `person_mappings`
> 与扫码）。ADR-013 的 tenantless `platform_admin` 使用独立表，不加入本表，也不允许
> `tenant_id` 为 null。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `username` (varchar(32), nullable, unique within tenant；operator 必填，tenant_manager 必须为空)
- `email` (varchar(254), nullable, unique within tenant；tenant_manager 必填，operator 可空)
- `password_hash` (varchar)
- `role` (varchar) - tenant_manager/operator
- `status` (varchar)
- `must_change_password` (boolean) - platform_admin 原子创建的首个 tenant_manager 初始为 true；
  既有用户迁移时保持 false
- `last_login_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

## 2a. platform_admins（ADR-013，已由 #110 实现）

> 用法：tenantless 平台最高权限身份。MVP 同时最多一个 active 账号；不能通过 tenant 注册或
> tenant_manager API 创建。数据库 partial unique index 强制同时最多一个 active 账号。

- `id` (pk, uuid)
- `email` (varchar(254), unique，服务层规范化为小写)
- `password_hash` (varchar)
- `status` (varchar) - active/disabled
- `identity_version` (integer) - 密码、状态或恢复操作变化时撤销全部 Session
- `last_login_at` (timestamp, nullable)
- `created_at` / `updated_at` (timestamp)

MVP 不增加 `mfa_enabled`、TOTP secret 或恢复码字段；TOTP 由 #114 的独立 ADR 决定。

## 2b. platform_sessions（ADR-013，已由 #110 实现）

- `id` (pk, uuid)
- `platform_admin_id` (fk -> platform_admins.id)
- `refresh_token_hash` (varchar)
- `identity_version_snapshot` (integer)
- `expires_at`, `last_used_at`, `revoked_at` (timestamp)
- `created_at`, `updated_at` (timestamp)

platform Session 使用独立 Cookie、JWT secret/audience 和有限 TTL，不与 tenant `sessions` 混用。

## 2c. platform_audit_logs（ADR-013，已由 #110 实现）

- `id` (pk, uuid)
- `platform_admin_id` (fk -> platform_admins.id)
- `target_tenant_id` (fk -> tenants.id, nullable)
- `action`, `resource_type`, `resource_id`, `result` (varchar)
- `request_id` (varchar)
- `metadata_json` (jsonb, sanitized)
- `created_at` (timestamp)

只记录平台操作所需的内部 ID、状态变化和结果；不得记录密码、token、完整邮箱或租户业务 PII。

## 2d. platform_tenant_idempotency

- `id` (pk, uuid)
- `key_hash` (varchar(64), unique) - 不保存原始 `Idempotency-Key`
- `request_fingerprint` (varchar(64))
- `platform_admin_id` (uuid) - 发起该逻辑操作的平台身份
- `tenant_id` (fk -> tenants.id, unique)
- `expires_at`, `created_at` (timestamp)

租户临时密码不进入该表。服务端使用受控 `PLATFORM_PROVISIONING_SECRET`、key hash 与请求指纹
确定性地产生同一逻辑请求的高熵临时密码，以兼顾网络重放语义和“数据库只保存 Argon2 哈希”边界。
UI 在成功响应后仅临时显示并可立即清除。

## 3. subscriptions

> 用法：订阅配置表（MVP 先按 tenant 统一订阅）；现行发送门禁遵循 ADR-003，修改权限遵循
> ADR-006/ADR-013，仅 tenantless `platform_admin` 可通过独立平台 API 修改。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id, unique)
- `plan` (varchar)
- `status` (varchar) - trial/active/expired/suspended
- `start_at` (timestamp)
- `end_at` (timestamp)
- `version` (integer) - 平台修改使用的乐观并发版本

时间统一按 UTC 存储；当 `end_at <= 当前 UTC 时间` 时，trial/active 在运行时视为 expired。过期用户仍可登录，但不能创建扫描发送或发送邮件。
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
- `location_id` (fk -> locations.id, nullable)
- `person_mapping_id` (fk -> person_mappings.id, nullable；旧数据可为空，新成功扫码必须存在)
- `person_code_snapshot` (varchar(12), nullable；新成功扫码保存解析后的人员码，旧数据可为空)
- `scan_code` (varchar)
- `scan_type` (varchar) - entry/exit（旧数据可保留其他 legacy 值）
- `action` (varchar) - entry/exit/unknown
- `action_source` (varchar) - person_action_code/legacy_unknown
- `raw_payload` (text)
- `received_at` (timestamp)
- `created_by_user_id` (fk -> users.id, nullable)
- `created_at` (timestamp)

## 6. locations（办公室/学校）

> 用法：办公室/学校上下文表；用户在扫码前需先选择当前 location，后续查找与发送行为均在该上下文内完成。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `location_code` (varchar(8)) - 服务端生成的大写 Crockford Base32 公开业务 ID；tenant 内唯一
- `name` (varchar) - 地点名称；服务层按去除首尾空白、大小写不敏感的 tenant 内规则拒绝重名
- `type` (varchar) - 固定为 `location`
- `status` (varchar) - active/inactive
- `created_at` (timestamp)
- `updated_at` (timestamp)

> 说明：`locations.id` UUID 继续作为主外键，普通 API 不返回该 UUID。迁移把旧 code/type 保存到 `location_legacy_identifiers`，再回填 8 位公开 ID 与固定类型；所有历史关联保持内部 UUID 不变。

## 6a. operator_location_assignments

> 用法：保存 tenant_manager 对 operator 的显式 location 授权。没有 assignment 即没有任何 location 权限；该表不做旧 operator 的自动回填。

- `id` (pk, uuid)
- `tenant_id` (tenant-scoped fk)
- `operator_id` (tenant-scoped fk -> users)
- `location_id` (tenant-scoped fk -> locations)
- `created_at` (timestamp)

约束：

- `(tenant_id, operator_id, location_id)` unique
- `(tenant_id, operator_id)` 必须引用同 tenant user，服务层同时要求目标角色为 `operator`
- `(tenant_id, location_id)` 必须引用同 tenant location
- 设置 API 只允许 active location；停用后保留 assignment 以支持历史识别和显式撤销，但所有新写操作继续受 location 状态门禁

## 7. person_mappings（扫码编号与人员邮箱映射）

> 用法：非登录人员（收件人）映射表。内部 UUID 只用于主外键；公开的 `person_code` 由服务端生成，并嵌入该人员的 ENTRY/EXIT 两张动作码。由 `operator` 与 `tenant_manager` 维护。与 `users` 严格区分：`users` 是登录管理员，`person_mappings` 是业务通讯录映射。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `location_id` (fk -> locations.id)
- `person_code` (varchar(12), global unique, not null)
- `scan_code` (varchar；迁移兼容列，新记录与 `person_code` 相同)
- `person_name` (varchar)
- `email` (varchar)
- `status` (varchar) - active/inactive
- `created_at` (timestamp)
- `updated_at` (timestamp)

> `person_code` 为 12 位大写 Crockford Base32：前 7 位编码 Unix 秒，后 5 位为密码学随机后缀。同一进程同秒生成时后缀单调递增；数据库全局唯一约束与最多 5 次重试处理跨节点碰撞。客户端不能指定或修改该值。
>
> 查询约束：扫码写接口只接受 ADR-015 的 `V2E<person_code>` / `V2X<person_code>`。解析后必须同时带上服务端认证得到的 `tenant_id` 与当前 `location_id` 查人，禁止仅按全局唯一 `person_code` 查询，也不接受 `PD1`、裸 `person_code` 或旧 `scan_code`。

## 8. mail_jobs

> 用法：邮件发送任务表，记录从生成到发送完成/失败的投递状态与错误信息，并固化发送时的 tenant/location/person 上下文。MVP 仅保存系统生成后的最终 `subject`/`body`，不单独保存用户自定义正文。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `location_id` (fk -> locations.id)
- `person_mapping_id` (fk -> person_mappings.id)
- `scan_event_id` (fk -> scan_events.id)
- `tenant_name_snapshot` (varchar)
- `location_name_snapshot` (varchar)
- `person_name_snapshot` (varchar)
- `person_code_snapshot` (varchar(12))
- `action_snapshot` (varchar) - entry/exit/unknown；重试和历史读取均使用该快照
- `context_snapshot_source` (varchar) - `scan_relation` / `legacy_backfill`
- `to_email` (varchar)
- `subject` (varchar)
- `body` (text)
- `template_key` (varchar)
- `status` (varchar) - waiting/queued/processing/sent/failed/canceled/delivery_unknown
- `retry_count` (int)
- `provider_message_id` (varchar, nullable)
- `error_message` (text, nullable)
- `scheduled_at` (timestamp, nullable)
- `cancel_until` (timestamp, nullable；新任务数据库默认 T0 + 10 秒)
- `send_not_before` (timestamp, nullable；新任务数据库默认 T0 + 10 秒)
- `claimed_at` (timestamp, nullable)
- `claim_attempt_id` (uuid, nullable)
- `sent_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

> ADR-017 本地迁移已实现：新任务以 `waiting` 开始，并以独立
> `cancel_until/send_not_before` 表示首次 10 秒犹豫期；`scheduled_at` 只保留给 provider retry。
> `scan_event` 保留不可变原始动作并增加取消元数据，`mail_job` 增加 `canceled` 终态与 claim/attempt
> 证据。既有 `queued` 记录不追溯获得取消窗口，guarded rollback 不得把 `canceled` 映射回
> `queued`。`mail_delivery_attempts` 持久化领取、provider 调用边界、完成结果和安全错误码；迁移为
> `20260806010000_add_scan_send_cancellation`。guarded rollback 遇到任何 `waiting` 任务即拒绝，且保留取消与 attempt 证据。
> 所有截止列使用 `timestamp(3)`；运行时先把 PostgreSQL 当前时间截断到毫秒，再执行严格
> `db_now < cancel_until` / `db_now >= send_not_before` 条件更新。一次性数据库准入脚本会重复验证
> 截止前 1ms、恰好截止和截止后 1ms，并在事务中演练 rollback guard。

> `id` 继续作为所有内部主外键目标；普通登录只提交 `tenant_code`。迁移按 `created_at, id` 稳定顺序回填旧 tenant，最多重试 5 次，并保留 UUID 关系用于回滚。

## 8a. mail_delivery_attempts

- 保存 `tenant_id`、`mail_job_id`、attempt ID、`claimed_at`、`provider_invoked_at`、`completed_at`、结果与安全错误码。
- provider 调用前先持久化 `provider_invoked_at`；崩溃恢复只有在能够证明未越过该边界时才重新入队。
- attempt 和取消证据属于审计数据，rollback 不删除，也不把不确定投递重新变为可发送。

## 9. scan_request_idempotency

> 用法：保存扫码写请求的 24 小时幂等结果引用。原始 `Idempotency-Key` 和请求正文均不落库，只保存 SHA-256 哈希。

- `id` (pk, uuid)
- `tenant_id` (fk -> tenants.id)
- `route` (varchar)
- `key_hash` (char(64))
- `request_fingerprint` (char(64))
- `scan_event_id` (fk -> scan_events.id)
- `mail_job_id` (fk -> mail_jobs.id, nullable)
- `expires_at` (timestamp)
- `created_at` (timestamp)
- unique (`tenant_id`, `route`, `key_hash`)

## 10. audit_logs

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

## 11. 索引建议

- `users (tenant_id, username)` unique
- `users (tenant_id, email)` unique
- `users (tenant_id, role, status)`
- `subscriptions (tenant_id)` unique
- `devices (tenant_id, device_code)` unique
- `scan_events (tenant_id, received_at)`
- `locations (tenant_id, location_code)` unique
- `operator_location_assignments (tenant_id, operator_id, location_id)` unique
- `operator_location_assignments (tenant_id, operator_id)`
- `operator_location_assignments (tenant_id, location_id)`
- `locations (tenant_id, name)`
- `person_mappings (tenant_id, location_id, scan_code)` unique
- `person_mappings (person_code)` global unique
- `person_mappings (tenant_id, location_id, status, updated_at)`
- `scan_events (tenant_id, person_mapping_id, created_at)`
- `scan_events (tenant_id, location_id, person_mapping_id, received_at)`
- `mail_jobs (tenant_id, status, created_at)`
- `mail_jobs (tenant_id, location_id, created_at)`
- `mail_jobs (tenant_id, person_mapping_id, created_at)`
- `scan_request_idempotency (tenant_id, route, key_hash)` unique
- `scan_request_idempotency (expires_at)`
- `audit_logs (tenant_id, created_at)`

## 12. Migration baseline (Issue #21)

The initial migration is implemented with Prisma under `backend/prisma/`.

Implementation notes:

- Prisma schema: `backend/prisma/schema.prisma`.
- Initial migration SQL: `backend/prisma/migrations/20260622000000_init/migration.sql`.
- The implementation includes the MVP tables: `tenants`, `users`, `subscriptions`, `devices`, `locations`, `operator_location_assignments`, `person_mappings`, `scan_events`, `mail_jobs`, `scan_request_idempotency`, `audit_logs`, and `sessions`.
- `sessions` stores one row per device login. Only a SHA-256 refresh-token hash is stored; sessions have expiry, last-used, and revocation timestamps, supporting independent multi-device logout and rotation.
- Status fields remain `varchar` columns at the database layer to match this document; business validation will be enforced in service/API layers in later issues.
- `scan_events.location_id` is included as a nullable foreign key to `locations.id` so scan history can be queried by the selected location context described in ADR-002 and `docs/api.md`.
- `person_mappings` has the required unique constraint on `(tenant_id, location_id, scan_code)`.
- Issue #93 adds an immutable, globally unique `person_code`, backfills legacy mappings in stable `created_at, id` order, and stops the migration if mapped scan/mail history cannot be linked safely.
- Mapped scan events persist `person_mapping_id` and `person_code_snapshot`; mail jobs require the full person/location/tenant relation plus immutable name/code snapshots. Existing jobs are labeled `legacy_backfill`, while new jobs use `scan_relation`.
- Emergency rollback SQL is kept at `backend/prisma/rollback/20260724000000_add_person_codes_and_mail_context.sql`. It requires a backup and stopped writes; it removes the new trace columns without dropping legacy `scan_code`, UUID keys, scan events, or mail jobs.
- Issue #95 adds `action` / `action_source` to scan events, `action_snapshot` to mail jobs, and `scan_request_idempotency` for 24-hour replay. Existing rows default to `unknown` / `legacy_unknown`; rollback SQL is `backend/prisma/rollback/20260724010000_add_scan_actions.sql`.
- Issue #96 adds `operator_location_assignments` with tenant-scoped composite foreign keys. The approved migration is fail-closed: it inserts no rows, so every existing operator starts with no location access until a tenant_manager assigns locations.
- Issue #96 rollback SQL is `backend/prisma/rollback/20260724020000_add_operator_location_assignments.sql`. Roll back application code before dropping the table; otherwise current code will fail closed because its authorization relation no longer exists. Returning to the old application restores its former permissive operator behavior and therefore requires explicit security approval.
- Issue #99 新增 `users.username`，在规范化邮箱和检查 tenant 内大小写冲突后，为旧 operator 回填
  `op-` 加 10 位随机小写 Crockford Base32 子集用户名。数据库约束保证 operator username 必填、
  tenant_manager email 必填且 username 为空；username/email 均以小写规范值执行 tenant 内唯一。
- Issue #99 回滚脚本为 `backend/prisma/rollback/20260724030000_add_user_login_identities.sql`。存在
  `email IS NULL` 的 operator 时脚本会停止；必须先保留 username-capable 版本并由 tenant_manager
  补齐邮箱，不得删除账号以完成回滚。
- ADR-018 通过 `20260806000000_remove_unmapped_scan_cases` 删除上线前未使用的 `unmapped_scan_cases`，并清除开发/合成的 `scan_type=unmapped` 事件。guarded rollback 只重建空表，不恢复已删除数据；执行前必须停止写流量并确认环境没有业务数据。
- Issue #104 为 `locations` 与 `person_mappings` 增加 `deleted_at`、`purge_after`、
  `deleted_from_status` 及到期扫描索引。`pending_delete` 记录保留 14 天；`purged` 记录保留不可复用的
  公开业务 ID 和关系锚点，但地点名称、人员姓名和邮箱被匿名化。成功扫码、邮件和审计历史不删除。
- `20260728020000_add_delayed_deletion` 仅增加可空列与索引，不回填或删除现有数据。该生命周期迁移
  不提供破坏性 SQL 回滚；需要回滚应用时保留新增列，待恢复版本再次接管到期清理。
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
