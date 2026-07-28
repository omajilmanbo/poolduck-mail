# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: browser uses HttpOnly cookies (`poolduck_access`, `poolduck_refresh`); Bearer access tokens remain accepted for non-browser local tooling
- 所有业务接口默认在租户上下文中执行
- tenant 隔离：登录时接收并校验公开 `tenant_code`，服务端解析为内部 UUID；登录成功后业务接口使用 token/session 中的内部 `tenant_id`，不接受业务接口显式传入或覆盖 `tenant_id`
- 认证上下文：受保护接口通过后端 `JwtAuthGuard` 解析 token，并通过请求上下文注入 `tenant_id`、`user_id`、`role`；业务层通过统一上下文读取 tenant scope
- 角色判断：MVP 最小角色集合为 `tenant_manager` / `operator`，受保护业务接口默认只允许这两类角色
- 订阅状态统一：`trial` / `active` / `expired` / `suspended`
- 扫码邮件正文固定由后端生成，不接收 `custom_message` / `custom_text` / `mail_body` 等自定义正文字段
- 固定邮件正文模板按动作选择：`entry` 使用“入室しました”，`exit` 使用“退室しました”；动作来自人员动作码，不接受独立动作字段

## 1. 认证（Auth）

### POST `/api/auth/login`
- 成功响应不向 JavaScript 返回 token；设置 HttpOnly Cookie，并返回 `expires_in=900` 与 `user`
- access token 15 分钟；refresh token 7 天、每次刷新轮换；数据库仅保存 refresh token 哈希
- 入参：`tenant_code`, `identifier`, `password`；`tenant_code` 为 10 位 Crockford Base32，输入会去除首尾空白并转为大写
- 出参：`expires_in`, `user`；token 仅通过 HttpOnly Cookie 下发
- token payload：`user_id`, `tenant_id`, `role`, `session_id`, `token_type`
- access token 生命周期 15 分钟（`900` 秒），refresh token 7 天并轮换
- 前端可缓存上次使用的 `tenant_code` 以降低登录复杂度；登录 API 不再接受 UUID `tenant_id`
- 仅回滚窗口可由运维显式设置 `AUTH_ACCEPT_LEGACY_TENANT_UUID=true` 临时双读 UUID；默认值为
  `false`，正常 UI 永远不提交 UUID，恢复完成后必须立即关闭
- identifier 含 `@` 时仅按小写规范邮箱查询；不含 `@` 时仅按小写 operator username 查询
- 兼容窗口内仍接受旧 `email` 字段；若同时提供 `identifier` 与 `email`，规范值必须相同
- tenant 不存在、身份不存在、账号停用或密码错误统一返回 HTTP 401 / `LOGIN_FAILED`；限流返回
  HTTP 429 / `LOGIN_RATE_LIMITED`，均不透露账号类型或存在性
- 示例：

```json
{
  "tenant_code": "10CA000001",
  "identifier": "local-operator",
  "password": "example-password"
}
```

```json
{
  "expires_in": 900,
  "user": {
    "user_id": "33333333-3333-4333-8333-333333333333",
    "tenant_code": "10CA000001",
    "username": "local-operator",
    "email": null,
    "role": "operator"
  }
}
```

### POST `/api/auth/logout`
- 撤销当前设备 session 并清除两个 Cookie；其他设备会话不受影响
- 说明：无状态 JWT 策略下返回成功响应，客户端清除本地 token
- 出参：`status`, `strategy`

### GET `/api/auth/me`
- 浏览器以 access Cookie 确认当前用户；access 过期时前端调用 refresh 后重试
- 说明：获取当前登录用户信息
- 租户上下文：以认证 Cookie（或本地工具 Bearer token）中的 `tenant_id` 为准，不接受客户端参数修改
- 出参：`user.user_id`, `user.tenant_code`, `user.username`, `user.email`, `user.role`；内部 `tenant_id` 不返回；operator email 可为
  `null`，tenant_manager username 为 `null`
- 错误：未提供 token、token 无效或用户不存在时返回 `UNAUTHORIZED`

## 2. License Check

### GET `/api/license/check`
- 说明：校验当前 token tenant 的订阅状态，用于前端禁用扫码提交、邮件创建、发送与重试入口
- 租户上下文：仅使用认证会话中的 `tenant_id`，不接受 query/body 中的 `tenant_id`
- 出参：`status`, `plan`, `end_at`, `expired_at`, `grace_period`, `can_send`
- 发送门禁：`trial` / `active` 返回 `can_send=true`；`expired` / `suspended` 返回 `can_send=false`
- 权限：已登录用户（`tenant_manager` / `operator`）
- 示例：

```json
{
  "status": "active",
  "plan": "mvp",
  "end_at": "2026-12-31T23:59:59.000Z",
  "expired_at": "2026-12-31T23:59:59.000Z",
  "grace_period": null,
  "can_send": true
}
```

## 3. 扫码邮件核心流程 API

### GET `/api/locations`
- 说明：获取当前 token tenant 可用的地点列表，用于扫码邮件页面切换上下文
- 租户上下文：仅使用认证会话中的 `tenant_id`
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（仅用于页面初始化）
- location 授权：`tenant_manager` 返回本 tenant 全部 location；`operator` 只返回显式分配的 location。无 assignment 时返回空数组
- 出参：`[{ location_id, location_code, location_name, type, is_active }]`；`location_id` 与 `location_code` 均返回 8 位公开业务 ID，`type` 固定为 `location`，不返回内部 UUID
- 错误：未认证时返回 `UNAUTHORIZED`

### GET `/api/locations/{location_id}/people`
- 说明：获取当前 token tenant + location 下人员一览与服务端生成的人员业务 ID
- 租户上下文：查询必须限定 `tenant_id + location_id`，不允许跨租户读取 location 或人员映射
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（仅用于映射预加载）
- location 授权：`operator` 必须已被显式分配该 location；未分配、伪造或跨 tenant 的 `location_id` 与不存在地点统一返回 `LOCATION_NOT_FOUND`
- 出参：`[{ person_id, person_code, person_name, scan_code, email_masked, is_active }]`；`person_id` 与兼容字段 `scan_code` 当前均返回 `person_code`，不返回内部 UUID
- 隐私：不返回完整邮箱地址
- 人员读取与写入路径统一执行 operator-location 门禁；客户端提交的 location 参数不能扩大权限

### 人员映射写接口

- `GET /api/locations/{location_id}/people/{person_id}`：`person_id` 使用公开 `person_code`；受控编辑时返回完整邮箱
- `POST /api/locations/{location_id}/people`：入参仅 `person_name`, `email`；服务端生成 12 位 `person_code`，客户端提交 `person_code` / `scan_code` 会返回 `400`
- `PATCH /api/locations/{location_id}/people/{person_id}`：仅允许更新姓名、邮箱；不接受状态、`person_code`、`scan_code` 或 `location_id`
- `DELETE /api/locations/{location_id}/people/{person_id}`：软停用，历史保留
- `POST /api/locations/{location_id}/people/{person_id}/reactivate`：重新启用已停用人员；地点本身必须 active，人员 ID 与历史关联不变
- 生成规则：前 7 位为 Unix 秒、后 5 位为安全随机值；数据库唯一冲突最多重试 5 次，耗尽返回 `PERSON_CODE_GENERATION_EXHAUSTED`

### 地点写接口

- `POST /api/locations`：仅接收 `location_name`；服务端生成 8 位公开 ID，固定写入 `type=location`。提交 `location_id`、`location_code` 或 `type` 返回 `400`
- `PATCH /api/locations/{location_id}`：仅允许修改 `location_name`；同 tenant 名称去除首尾空白后按大小写不敏感规则唯一
- `DELETE /api/locations/{location_id}`：仅 `tenant_manager`，软停用
- `POST /api/locations/{location_id}/reactivate`：仅 `tenant_manager`，重新启用已停用地点
- DELETE 为软停用；停用后拒绝新扫描与人员映射写入，并把该地点 queued 邮件安全终止为 failed/`LOCATION_INACTIVE`
- location ID 冲突最多重试 5 次，耗尽返回 `LOCATION_CODE_GENERATION_EXHAUSTED`；不存在、跨 tenant 或 operator 未授权统一返回 `LOCATION_NOT_FOUND`
- 错误：`location_id` 非法或不属于当前 tenant 时返回 `LOCATION_NOT_FOUND`

### POST `/api/scan-events`
- 入参：`location_id`, `scan_code`；`scan_code` 必须是精确、区分大小写的 `PD1|ENTRY|<12 位 person_code>` 或 `PD1|EXIT|<12 位 person_code>`，服务端只去除整个输入的首尾空白
- 可选请求头：`Idempotency-Key`（8–200 位可见 ASCII）。相同 tenant、route、key 与相同请求内容在 24 小时内返回首次结果；同一 key 携带不同 location/person/action 返回 `IDEMPOTENCY_KEY_CONFLICT`
- 说明：
  - 创建扫码事件记录
  - 后端解析版本、动作与 `person_code`；裸 `person_code`、未知版本/动作、格式错误或混合大小写一律返回 `ACTION_CODE_INVALID`
  - 后端只在 JWT tenant + 当前 location 上下文中按解析后的 `person_code` 查找 active 映射；本接口不再兼容裸码或旧 `scan_code`
  - `entry` 正文使用 `{tenant_name}，{location_name}からのお知らせ：{person_name}　さんは　{time_stamp}　に入室しました。`；`exit` 将末句替换为 `退室しました。`
  - 后端在事务内把动作、动作来源 `person_action_code`、person → location → tenant 外键及发送时名称/人员码/动作快照写入 scan event/mail job，再创建初始 `queued` 任务；事务提交后立即调用 sandbox/mock provider并返回当前发送或重试状态
  - 同 tenant、location、解析后的 `person_code`、同动作在 10 秒内重复提交时返回原 scan event/mail job，响应 `deduplicated=true`；相反动作在窗口内返回 `SCAN_ACTION_CONFLICT`，不创建第二条记录或任务
  - 邮件重试只发送 mail job 已固化的正文和动作，不根据后续扫描或人员状态重新推断
  - 不接收任何自定义正文字段（`custom_message` / `custom_text` / `mail_body` 等）
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回 `SUBSCRIPTION_NOT_SENDABLE`
- location 授权：`operator` 必须已分配该 location；门禁在幂等结果重放之前执行，因此撤销 assignment 后旧 `Idempotency-Key` 也不能继续读取或提交该地点结果
- 出参：`scan_event_id`, `mail_job_id`, `person_code`, `action`, `action_source`, `mail_subject`, `status`, `retry_count`, `scheduled_at`, `error_message`, `deduplicated`
- 正常响应示例：

```json
{
  "scan_event_id": "55555555-5555-4555-8555-555555555555",
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "person_code": "01K0ABC10001",
  "action": "entry",
  "action_source": "person_action_code",
  "mail_subject": "Office Aからのお知らせ",
  "status": "sent",
  "retry_count": 0,
  "scheduled_at": null,
  "error_message": null,
  "deduplicated": false
}
```

- 错误：
  - `location_id` 非法或不属于当前 tenant：返回 `LOCATION_NOT_FOUND`
  - 动作码格式无效：返回 `ACTION_CODE_INVALID`，不创建扫码事件或邮件任务
  - 动作码中的 `person_code` 未找到 active 映射邮箱：创建带原动作的 `scanType=unmapped` 异常扫码事件，不创建 `mail_job`，返回 `SCAN_CODE_NOT_MAPPED` 与 `scan_event_id`；动作通过后续历史查询读取
  - 10 秒内出现相反动作：返回 `SCAN_ACTION_CONFLICT`
  - `Idempotency-Key` 格式无效或被不同请求复用：返回 `IDEMPOTENCY_KEY_INVALID` 或 `IDEMPOTENCY_KEY_CONFLICT`
  - 请求包含 `custom_message` / `custom_text` / `mail_body` 等额外字段：返回 `400 Bad Request`

### POST `/api/mail-jobs/{mail_job_id}/send`
- 说明：受控处理尚未发送且已经到期的 `queued` 任务。扫码主流程会自动调用，前端不提供人工发送按钮。MVP 使用 sandbox/mock provider，不发送真实邮件。
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：重试执行时仅 `trial` 或 `active` 可继续；`expired` / `suspended` 将任务安全终止为 `failed` / `SUBSCRIPTION_NOT_SENDABLE`
- 状态转换：
  - `queued` -> `sent`：sandbox 成功
  - sandbox 失败：依次在 30 秒、2 分钟、10 分钟后自动重试
  - 三次重试仍失败：终止为 `failed`；加上首次发送最多执行四次 provider 调用
  - 原子领取把 `queued` 临时改为 `processing`，并发处理器不能重复发送
  - `sent`：返回 `MAIL_JOB_ALREADY_SENT`，不重复发送
- 出参：`mail_job_id`, `status`, `retry_count`, `scheduled_at`, `provider_result`
- sandbox 配置：`MAIL_MOCK_SEND_RESULT=success` 默认成功；设置为 `failure` 或 `failed` 时模拟失败
- 成功响应示例：

```json
{
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "status": "sent",
  "provider_result": {
    "provider": "sandbox",
    "success": true,
    "provider_message_id": "sandbox_66666666-6666-4666-8666-666666666666"
  }
}
```

- 首次失败响应示例（HTTP 仍为成功处理，任务进入自动重试队列）：

```json
{
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "status": "queued",
  "retry_count": 1,
  "scheduled_at": "2026-07-23T00:00:30.000Z",
  "provider_result": {
    "provider": "sandbox",
    "success": false,
    "error_message": "Sandbox provider simulated failure"
  }
}
```

- 错误：
  - 邮件任务不属于当前 tenant：返回 `MAIL_JOB_NOT_FOUND`
  - 任务状态不允许发送：返回 `MAIL_JOB_ALREADY_SENT` 或 `MAIL_JOB_STATUS_NOT_SENDABLE`
  - 订阅无效：任务终止为 `failed`，安全错误为 `SUBSCRIPTION_NOT_SENDABLE`

### GET `/api/mail-jobs/{mail_job_id}`
- 说明：查询邮件发送结果与失败原因
- 权限：已登录用户（`tenant_manager` / `operator`）
- location 授权：operator 只能处理已分配 location 的任务；撤销后新请求返回 `MAIL_JOB_NOT_FOUND`
- 订阅要求：无（历史结果可查）
- 租户边界：仅使用 JWT 中的 `tenant_id`；其他 tenant 的 ID 统一返回 `MAIL_JOB_NOT_FOUND`
- location 授权：operator 只能查询已分配 location 的任务；tenant_manager 不受 assignment 限制
- 出参：`mail_job_id`, `action`, `status`, `created_at`, `sent_at`, `error_message`, `retry_count`, `scheduled_at`, `context`, `scan_event`
- `context` 返回发送时固化的 `tenant_name`, `location_name`, `person_name`, `person_code`, `snapshot_source`；后续改名不改写历史
- `scan_event` 返回 `action`, `action_source`；旧数据为 `unknown` / `legacy_unknown`
- 安全边界：不返回 `to_email`、邮件正文或 provider secret；不受控的 provider 错误统一为安全说明

### GET `/api/scan-events/{id}`
- 说明：查询单条扫码记录（含关联邮件任务状态）
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（历史记录可查）
- 租户边界：仅使用 JWT 中的 `tenant_id`；其他 tenant 的 ID 统一返回 `SCAN_EVENT_NOT_FOUND`
- location 授权：operator 只能查询已分配 location 的记录；撤销后单条与列表查询立即不可见
- 出参：`scan_event_id`, `location_id`, `location_name`, `person_code`, `person_name`, `scan_code`, `scan_type`, `action`, `action_source`, `received_at`, `status`, `mail_job`；关联 `mail_job` 同时返回固化的 `action`
- `unmapped` 记录的 `mail_job` 为 `null`，不会伪造任务

### GET `/api/scan-events`
- 查询：`location_id`, `status`, `created_from`, `created_to`, `cursor`, `limit`（默认 25，最大 100）
- 说明：按location（办公室/校舍）与状态查询扫码记录，用于页面“扫码记录栏”展示
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（历史记录可查）
- 状态：`unmapped` / `queued` / `processing` / `sent` / `failed`
- 出参：`{ items: [...], next_cursor }`；按 `created_at DESC, id DESC` 稳定排序，下一页原样传回 `next_cursor`
- 非本 tenant 的 `location_id` 返回 `LOCATION_NOT_FOUND`
- operator 未分配的 `location_id` 同样返回 `LOCATION_NOT_FOUND`；不提供 location 过滤条件时，列表也只包含已分配地点

### 未映射扫码处理

- `GET /api/unmapped-scans`：按当前 tenant 查询，支持 `location_id` 与 `status=open|resolved|ignored`
- `GET /api/unmapped-scans/{case_id}`：查询单条当前 tenant 记录
- `PATCH /api/unmapped-scans/{case_id}`：把记录标记为 `resolved` 或 `ignored`，记录处理人、处理时间和审计日志；标记 `resolved` 前服务端必须找到同 tenant/location/scan_code 的 active 人员映射，否则返回 `UNMAPPED_SCAN_NOT_RESOLVED`
- 权限：`tenant_manager` / `operator`；跨 tenant ID 统一返回 `UNMAPPED_SCAN_NOT_FOUND`
- location 授权：operator 只可列出、读取和处理已分配 location 的记录；停用 location 仍可读取历史，但不能执行新的处理写入
- `resolved` 仅表示数据已修正，不会自动重发历史邮件；停用地点的历史仍可查，但 `mapping_prefill_allowed=false`

### 租户 operator 账号生命周期

- 权限：仅 `tenant_manager`；`operator` 返回 `ROLE_FORBIDDEN`
- `GET /api/users`：仅列出当前 token tenant 的 `operator`，不返回 `passwordHash`
- `POST /api/users`：创建当前 tenant 的 `operator`；入参必填 `username`, `password`，`email` 可选或为
  `null`，可选 `role` 只能为 `operator`
- `PATCH /api/users/{user_id}`：修改本 tenant `operator` 的 `username`、可空 `email` 或
  `status=active|inactive`；username 不可清空，可选 `role` 只能保持 `operator`
- `POST /api/users/{user_id}/password`：入参 `new_password`，由 `tenant_manager` 直接提交新密码
- 创建和重置密码均要求至少 8 位，并且至少各包含一个英文字母和数字；允许额外符号，后端使用 Argon2 保存哈希
- 修改 username/email、禁用或重置密码后立即撤销该 operator 的全部活动会话；重新启用不会恢复旧会话
- 不属于当前 tenant、跨 tenant 或目标为 `tenant_manager` 时统一返回 `MANAGED_OPERATOR_NOT_FOUND`
- 当前不能创建、修改或禁用 `tenant_manager`，因此不会通过本 API 锁死最后一个租户管理员
- 当前 tenant 内重复 username/email 分别返回 `USER_USERNAME_CONFLICT` / `USER_EMAIL_CONFLICT`；
  创建、更新、启停和重置均写审计且不记录身份原文、密码或密码哈希

### operator-location assignment

- 权限：仅 `tenant_manager`；operator 自助访问返回 `ROLE_FORBIDDEN`
- `GET /api/users/{user_id}/location-assignments`：查询当前 tenant operator 的显式 assignments，返回 `{ operator_id, locations }`
- `PUT /api/users/{user_id}/location-assignments`：以 `{ "location_ids": ["<8 位 location_code>", ...] }` 原子替换全部 assignments；空数组表示撤销全部
- `DELETE /api/users/{user_id}/location-assignments/{location_id}`：撤销单个 assignment
- 只能操作当前 tenant 的 `operator` 与 active location；重复 ID 返回 `400`，不存在、停用、伪造或跨 tenant location 统一返回 `ASSIGNABLE_LOCATION_NOT_FOUND`
- assignment 设置与撤销写入审计，元数据只包含资源 ID 和计数，不包含邮箱、姓名或密码
- 迁移后既有 operator 默认为无地点；只有上述显式授权成功后才可访问 location 业务路径

## 4. 邮件任务列表

### GET `/api/mail-jobs`
- 查询：`location_id`, `status`, `created_from`, `created_to`, `cursor`, `limit`（默认 25，最大 100）
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无
- 出参：`{ items: [...], next_cursor }`，稳定排序与租户/PII 边界同单条查询
- location 授权：operator 列表仅包含已分配 location 的任务；tenant_manager 可查询本 tenant 全部任务

## 5. 审计与导出

- `GET /api/audit-logs`：仅 `tenant_manager`，按当前 tenant 查询；支持时间、action、result、resource_type、cursor、limit
- `GET /api/audit-logs/export`：仅 `tenant_manager`，必须提供 `created_from` / `created_to`，范围不超过 31 天，最多 5000 行
- `GET /api/scan-events/export` 与 `GET /api/mail-jobs/export`：仅 `tenant_manager`，相同的时间范围限制，可按 location/status 过滤
- CSV 使用 UTC ISO 时间；扫码与邮件导出包含 `person_code`、`action`、`action_source` 及固化的名称上下文，邮件邮箱格式为 `a***z@example.com`，不含正文、provider secret 或完整邮箱；所有导出动作写审计

## 6. Admin Tenants（管理员）

### GET `/api/admin/tenants`
- 说明：查询租户列表（平台管理员；规划中，尚未实现）
- 权限：ADR-006 Accepted 后使用 tenantless `platform_admin`，不得复用 `tenant_manager`

### GET `/api/admin/tenants/{id}`
- 说明：查询租户详情
- 权限：规划中的 tenantless `platform_admin`；尚未实现

### PATCH `/api/admin/tenants/{id}/status`
- 说明：更新租户状态（`trial` / `active` / `expired` / `suspended`）
- 权限：规划中的 tenantless `platform_admin`；尚未实现
