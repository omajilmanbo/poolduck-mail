# 数据库设计（初始草案）

> 说明：字段命名使用英文，文档说明使用中文。

## 1. tenants

> 用法：租户主表，代表一个独立客户组织；用于多租户数据隔离与计费归属的顶层边界。

- `id` (pk, uuid)
- `tenant_code` (varchar(10), unique) - 服务端生成的全局唯一 Crockford Base32 登录标识；不可由客户指定或修改
- `name` (varchar)
- `status` (varchar) - 通常为 active/suspended；Production 删除设为 pending_delete，到期清理设为 purged；Staging 即时清理的待补偿状态为 staging_deleting
- `deleted_at` / `purge_after` (timestamp, nullable) - ADR-023 Production 删除起点与一日历年恢复截止；数据库时间为权威，恰好到期不可恢复
- `deleted_from_status` / `deleted_from_subscription_status` (varchar(32), nullable) - 删除前 tenant 与 subscription 状态快照，供后续恢复 API 使用
- `location_limit` (integer, positive) - ADR-013 的人工运营额度；active/inactive/pending deletion
  location 均计数，purged 后释放
- `platform_version` (integer) - platform_admin 调整额度的乐观并发版本；Production 删除时递增
- `created_at` (timestamp)
- `updated_at` (timestamp)

`deleted_at`、`purge_after` 和两项状态快照必须同时为空或同时非空；非空时 tenant
`status` 为 `pending_delete` / `purged`，且 `purge_after = deleted_at + interval '1 year'`。
PostgreSQL 的日历年计算将 2024-02-29 12:00 映射为 2025-02-28 12:00（数据库时间）。
到期扫描索引为 `(purge_after, status)`。#160 的 Production 删除事务写入生命周期与原状态快照，
同时将订阅改为 `suspended`。#161 恢复事务仅在数据库时间早于 `purge_after` 时清空四项生命周期字段，
恢复原 tenant/subscription 状态并递增版本。#162 提供 Production 到期后单租户事务清理入口；#163 接入到期调度，Staging 删除由 #164 实现。

### ADR-023 / ADR-024 Production 到期清理矩阵（#162、#173）

`platformTenantPurgeService.purgeDueTenant(tenant.id)` 仅供内部调度调用。先锁定 tenant 行，确认数据库时间达到 `purge_after` 且状态为 `pending_delete`；与恢复共用行锁。整个租户在同一事务中按下列顺序清理，任何一步失败均回滚，重试时 `purged` 为无操作结果。仅接受内部 UUID；没有对租户开放的清理 API。

| 顺序 | 表 | 处理 | 外键与保留理由 |
| --- | --- | --- | --- |
| 1 | `scan_request_idempotency` | 销毁租户扫码幂等行 | Restrict/Cascade 关联 `scan_events` 和 `mail_jobs`，必须先于父行 |
| 2 | `mail_delivery_attempts` | 销毁回执/尝试 | Restrict 指向 `mail_jobs`；`processing` 或未完成尝试存在时整批回滚 |
| 3 | `mail_jobs` | 销毁邮件任务及正文/上下文快照 | Restrict 指向 `scan_events`，必须先于扫码事件 |
| 4 | `scan_events` | 销毁扫码事件及原始载荷 | 当前对象的 SetNull/Restrict 引用不再阻止墓碑处理 |
| 5 | `audit_logs` | 销毁本租户业务审计 | 删除流程的最小平台操作审计仍在独立表内 |
| 6 | `operator_location_assignments`, `location_legacy_identifiers`, `sessions`, `platform_tenant_idempotency` | 删除当前授权、兼容标识与会话 | 各自依赖 user/location/tenant |
| 7 | `users`, `devices`, `person_mappings`, `locations` | 清除当前 PII，保留 UUID 与不可复用业务码的非 PII 墓碑 | 必填身份字段改为不可登录的唯一占位符 |
| 8 | `subscriptions`, `tenants` | 订阅保持 `suspended`；tenant 写非 PII 墓碑、状态 `purged` | 保留 tenant UUID、不可复用 `tenant_code` 和生命周期关系 |
| 9 | `platform_audit_logs` | 同事务追加仅含内部 ID、原因码和清理计数的成功记录 | 原有平台审计按自身一年期限清理 |

清理先确认没有 `processing` 任务或 `completed_at IS NULL` 的发送尝试；待发/已排队任务因订阅 `suspended` 被阻止调用 provider，可在到期事务中销毁。清理不重置邮件状态或伪造 provider 回执。所有计数与墓碑状态在同一事务核对并提交；上述业务码仍由墓碑占用，不能重新发配。

`20261020010000_guard_purged_tenant_current_writes` 为当前对象表的 INSERT/UPDATE 加数据库门禁：写入时共享锁定 tenant 行并拒绝 `purged`，与清理事务的独占行锁串行化，防止清理提交后重新写入 PII、Session 或兼容标识。后续 `20261020020000_guard_staging_tenant_deletion` 也拒绝 `staging_deleting`。记录家族按 ADR-024 的独立到期事务销毁。

### ADR-024 一年记录保留与外键矩阵（#170–#173）

Production 正常到期使用数据库时间：`scan_events.created_at + interval '1 year'` 决定整个扫码家族的期限；`audit_logs.created_at` 与 `platform_audit_logs.created_at` 各自加一个日历年。2024-02-29 到 2025-02-28 的边界由 PostgreSQL 计算，不按固定 365 天。按 `(到期表达式, id)` 稳定扫描，每次最多 500 行；默认不开启清理器。待删除租户的现存扫码家族和业务审计冻结；相关平台审计在删除流程未结束时冻结。恢复后立即解除冻结，超期行重新成为候选。`delivery_unknown` 仍属终态，但只有相应尝试的 `provider_call_closed_at` 已确认且全部尝试均完成时才可销毁；陈旧认领恢复不会自动写该字段。已有未知结果不自动回填，待人工确认调用已结束。

| 父表 | 子表与 FK | 日常删除顺序 | 租户终结顺序 |
| --- | --- | --- | --- |
| `tenants` | `scan_events.tenant_id` Restrict；`mail_jobs.tenant_id`、`mail_delivery_attempts.tenant_id`、`scan_request_idempotency.tenant_id` Restrict；`audit_logs.tenant_id` SetNull；`platform_audit_logs.target_tenant_id` SetNull | 先锁 tenant，核对不处于 `pending_delete`；平台审计按自身期限 | 先删除业务记录，后写 tenant 墓碑；平台审计保留安全操作结果 |
| `scan_events` | `mail_jobs.scan_event_id` Restrict；`scan_request_idempotency.scan_event_id` Cascade | 幂等 → 尝试 → 邮件 → 扫码 | 同左，按 tenant 全量删除 |
| `mail_jobs` | `mail_delivery_attempts.mail_job_id` Restrict；`scan_request_idempotency.mail_job_id` Cascade | 已确认终态且尝试均完成后，幂等 → 尝试 → 邮件 | 确认无在途调用后，幂等 → 尝试 → 邮件 |
| `audit_logs` / `platform_audit_logs` | 可空 actor/tenant 关联；没有记录子表 | 各行按自身创建时间清理；锁 tenant 复核冻结 | 业务审计删除；平台审计依自身期限留存 |

`20261022000000_record_retention_scan_indexes` 增加 `mail_delivery_attempts.provider_call_closed_at` 可空列、`scan_events` 的 `(tenant_id, created_at + interval '1 year', id)` 与 `(created_at + interval '1 year', id)`，以及两类审计各自的 `(created_at + interval '1 year', id)` PostgreSQL 表达式索引，不修改任何历史行。Prisma schema 不能表达这些索引，SQL migration 是权威来源。受控回滚仅删除索引，保留调用关闭证据列；须先停用清理器并显式设置数据库会话 `app.allow_record_retention_index_rollback=true`。回滚不能恢复已销毁记录。

### ADR-023 Staging 物理清理矩阵（#164）

Staging 删除先在独立事务验平台 Session 与密码，确认订阅不是 `active`，将 tenant 置为 `staging_deleting`、订阅置为 `suspended`，记录仅含内部 ID 的待补偿审计。`staging_deleting` 不使用一年生命周期字段；认证拒绝登录、刷新及已有租户 token，`20261020020000_guard_staging_tenant_deletion` 使当前对象写入门禁也拒绝此状态。物理清理失败时前述状态持久保留，重新验密后可重试。

物理清理在单个事务中按 FK 子表到父表顺序删除：`scan_request_idempotency` → `mail_delivery_attempts` → `mail_jobs` → `scan_events` → `audit_logs` → `sessions` → `operator_location_assignments` → `location_legacy_identifiers` → `person_mappings` → `locations` → `devices` → `users` → `subscriptions` → `platform_tenant_idempotency` → 目标 `platform_audit_logs` → `tenants`。外键 Restrict 保证遗漏子行会使事务回滚，不允许部分完成。成功事务最后仅保留一条无 tenant FK 的平台操作结果，含内部 UUID、随机公共码的 SHA-256、删除计数和安全原因码；重复请求重新验密后凭该记录幂等返回。Staging 不保留 tenant 当前对象、历史扫码/邮件/回执/审计，也没有恢复入口或数据保留期。此路径不用于 Production。

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
> 查询约束：扫码写接口只接受 ADR-022 的 `E<person_code>` / `X<person_code>`。解析后必须同时带上服务端认证得到的 `tenant_id` 与当前 `location_id` 查人，禁止仅按全局唯一 `person_code` 查询，也不接受旧 `V2`、`PD1`、裸 `person_code` 或旧 `scan_code`。

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
- #137 增量迁移 `20260929000000_add_oci_submission_identifiers` 添加三个可空列：`rfc_message_id`、`envelope_id`、`opc_request_id`（均 varchar(512)）；历史及 mock attempt 不回填。OCI 调用前持久化 RFC 5322 Message-ID，收到响应后保存 envelope/request ID；原始请求、响应与收件地址不放入这些列。
- provider 调用前先持久化 `provider_invoked_at`；崩溃恢复只有在能够证明未越过该边界时才重新入队。
- attempt 和取消证据属于审计数据，rollback 不删除，也不把不确定投递重新变为可发送。
- 应用回滚须保留以上三个标识列；仅在全部为空、停写且已备份时，才可使用该迁移的 guarded schema rollback。
- #139 为全局 50 ms OCI 预约查询增加 `provider_invoked_at` 索引（迁移 `20260929001000_index_mail_attempt_provider_invoked_at`）；索引 rollback 不删除 attempt 或标识数据。
- OCI 预约未获时该 attempt 标记 `deferred/PROVIDER_RATE_LIMITED`，`provider_invoked_at` 仍为空；关联 job 回到 `queued` 并设置新的 `scheduled_at`，`retry_count` 不变。预约获准时才写入 `provider_invoked_at` 与 Message-ID，再调用 provider。

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
- `scan_events (tenant_id, received_at)`；ADR-024 另用 PostgreSQL 表达式索引扫描日历年到期时间
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
- `audit_logs (tenant_id, created_at)`；ADR-024 另用两类审计各自的日历年到期表达式索引

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
  公开业务 ID 和关系锚点，但地点名称、人员姓名和邮箱被匿名化。扫码、邮件与审计记录的日常销毁由后续 ADR-024 单独控制。
- `20260728020000_add_delayed_deletion` 仅增加可空列与索引，不回填或删除现有数据。该生命周期迁移
  不提供破坏性 SQL 回滚；需要回滚应用时保留新增列，待恢复版本再次接管到期清理。
- `20261020000000_add_tenant_deletion_lifecycle` 仅扩展 `tenants` 的可空字段、约束和索引，
  不回填或更改现有租户及其外键/历史关系。`backend/prisma/rollback/20261020000000_add_tenant_deletion_lifecycle.sql`
  仅在没有任何租户进入删除流程时允许移除新字段；否则拒绝回滚并保留状态。先在停写维护窗口确认无 `staging_deleting`、`pending_delete` 或 `purged`，再依逆序运行 `20261020020000_guard_staging_tenant_deletion.sql`、`20261020010000_guard_purged_tenant_current_writes.sql`、生命周期 rollback；每步均有状态守卫，拒绝时保留现有门禁。
- Core tenant-scoped indexes are included for users, devices, locations, person mappings, scan events, mail jobs, and audit logs.
- `20261020030000_index_tenant_staging_purge_foreign_keys` 为 Staging 整租户物理清理涉及的子表外键列增加索引。大租户删除父行时，PostgreSQL 外键检查因此无需反复全表扫描已删除但尚未 vacuum 的子表行。部署此迁移前须结束旧版正在运行的清理事务，迁移完成后再重试 `staging_deleting` 租户。
- `20261022000000_record_retention_scan_indexes` 增加可空的 provider 调用关闭证明列与 Production 一年到期扫描索引；迁移本身不删除历史。清理功能默认关闭，首次启用前须盘点到期行数、核对告警路由与不可恢复删除边界。索引回滚需停清理器并显式开启数据库会话守卫；调用关闭证明列保留，数据销毁不可回滚。

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
