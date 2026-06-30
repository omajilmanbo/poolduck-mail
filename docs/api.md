# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: `Authorization: Bearer <token>`
- 所有业务接口默认在租户上下文中执行
- tenant 隔离：登录时接收并校验 `tenant_id`；登录成功后业务接口使用 token/session 中的 `tenant_id`，不接受业务接口显式传入 `tenant_id`
- 认证上下文：受保护接口通过后端 `JwtAuthGuard` 解析 token，并通过请求上下文注入 `tenant_id`、`user_id`、`role`；业务层通过统一上下文读取 tenant scope
- 角色判断：MVP 最小角色集合为 `root_admin` / `manager`，受保护业务接口默认只允许这两类角色
- 订阅状态统一：`trial` / `active` / `expired` / `suspended`
- 扫码邮件正文固定由后端生成，不接收 `custom_message` / `custom_text` / `mail_body` 等自定义正文字段
- 固定邮件正文模板：`{tenant_name}，{location_name}からのお知らせ：{person_name}　さんは　{time_stamp}　に入室しました。`

## 1. 认证（Auth）

### POST `/api/auth/login`
- 入参：`tenant_id`, `email`, `password`
- 出参：`access_token`, `expires_in`, `user`
- token payload：`user_id`, `tenant_id`, `role`
- MVP 默认 access token 生命周期：24 小时（`86400` 秒），支持扫码工作台长时间值守
- 后续前端可缓存上次使用的 `tenant_id` 以降低登录复杂度；登录 API 仍必须显式提交并由后端校验 `tenant_id`
- 错误：`tenant_id` 不存在时返回“tenant不存在”；用户不在该 tenant 或密码错误时返回登录失败
- 示例：

```json
{
  "tenant_id": "11111111-1111-4111-8111-111111111111",
  "email": "manager@example.local",
  "password": "example-password"
}
```

```json
{
  "access_token": "<jwt>",
  "expires_in": 86400,
  "user": {
    "user_id": "33333333-3333-4333-8333-333333333333",
    "tenant_id": "11111111-1111-4111-8111-111111111111",
    "email": "manager@example.local",
    "role": "manager"
  }
}
```

### POST `/api/auth/logout`
- 说明：无状态 JWT 策略下返回成功响应，客户端清除本地 token
- 出参：`status`, `strategy`

### GET `/api/auth/me`
- 说明：获取当前登录用户信息
- 租户上下文：以 `Authorization: Bearer <token>` 中的 `tenant_id` 为准，不接受客户端参数修改
- 出参：`user.user_id`, `user.tenant_id`, `user.email`, `user.role`
- 错误：未提供 token、token 无效或用户不存在时返回 `UNAUTHORIZED`

## 2. License Check

### GET `/api/license/check`
- 说明：校验当前 token tenant 的订阅状态，用于前端禁用扫码提交、邮件创建、发送与重试入口
- 租户上下文：仅使用 `Authorization: Bearer <token>` 中的 `tenant_id`，不接受 query/body 中的 `tenant_id`
- 出参：`status`, `plan`, `end_at`, `expired_at`, `grace_period`, `can_send`
- 发送门禁：`trial` / `active` 返回 `can_send=true`；`expired` / `suspended` 返回 `can_send=false`
- 权限：已登录用户（`root_admin` / `manager`）
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
- 说明：获取当前 token tenant 可用的 location（办公室/校舍）列表，用于扫码邮件页面切换上下文
- 租户上下文：仅使用 `Authorization: Bearer <token>` 中的 `tenant_id`
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（仅用于页面初始化）
- 出参：`[{ location_id, location_code, location_name, type, is_active }]`
- 错误：未认证时返回 `UNAUTHORIZED`

### GET `/api/locations/{location_id}/people`
- 说明：获取当前 token tenant + location 下人员一览与扫码编号映射
- 租户上下文：查询必须限定 `tenant_id + location_id`，不允许跨租户读取 location 或人员映射
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（仅用于映射预加载）
- 出参：`[{ person_id, person_name, scan_code, email_masked, is_active }]`
- 隐私：不返回完整邮箱地址
- 错误：`location_id` 非法或不属于当前 tenant 时返回 `LOCATION_NOT_FOUND`

### POST `/api/scan-events`
- 入参：`location_id`, `scan_code`
- 说明：
  - 创建扫码事件记录
  - 后端在当前 tenant + location 上下文中查找扫码编号对应邮箱
  - 后端按固定模板生成最终邮件正文：`{tenant_name}，{location_name}からのお知らせ：{person_name}　さんは　{time_stamp}　に入室しました。`
  - 后端创建关联邮件任务（初始 `queued`），本接口不发送真实邮件
  - 不接收任何自定义正文字段（`custom_message` / `custom_text` / `mail_body` 等）
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回 `SUBSCRIPTION_NOT_SENDABLE`
- 出参：`scan_event_id`, `mail_job_id`, `mail_subject`, `status`
- 正常响应示例：

```json
{
  "scan_event_id": "55555555-5555-4555-8555-555555555555",
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "mail_subject": "Office Aからのお知らせ",
  "status": "queued"
}
```

- 错误：
  - `location_id` 非法或不属于当前 tenant：返回 `LOCATION_NOT_FOUND`
  - `scan_code` 未找到 active 映射邮箱：创建 `scanType=unmapped` 的异常扫码事件，不创建 `mail_job`，返回 `SCAN_CODE_NOT_MAPPED` 与 `scan_event_id`
  - 请求包含 `custom_message` / `custom_text` / `mail_body` 等额外字段：返回 `400 Bad Request`

### POST `/api/mail-jobs/{mail_job_id}/send`
- 说明：确认/触发发送指定邮件任务（默认用于扫码后发送）。MVP 使用 sandbox/mock provider，不发送真实邮件。
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回 `SUBSCRIPTION_NOT_SENDABLE`
- 状态转换：
  - `queued` -> `sent`：sandbox 成功
  - `queued` -> `failed`：sandbox 失败并写入 `error_message`
  - `failed` -> `sent` / `failed`：允许再次手动触发
  - `sent`：返回 `MAIL_JOB_ALREADY_SENT`，不重复发送
- 出参：`mail_job_id`, `status`, `provider_result`
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

- 失败响应示例（HTTP 仍为成功触发，任务状态为 `failed`）：

```json
{
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "status": "failed",
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
  - 订阅无效：返回 `SUBSCRIPTION_NOT_SENDABLE`

### GET `/api/mail-jobs/{mail_job_id}`
- 说明：查询邮件发送结果与失败原因
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（历史结果可查）
- 出参（示例字段）：`mail_job_id`, `status`, `sent_at`, `error_code`, `error_message`

### GET `/api/scan-events/{id}`
- 说明：查询单条扫码记录（含关联邮件任务状态）
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（历史记录可查）
- 出参（示例字段）：`scan_event_id`, `person_id`, `person_name`, `time_stamp`, `status`, `mail_job_id`

### GET `/api/scan-events`
- 查询：`location_id`, `status`, `created_from`, `created_to`
- 说明：按location（办公室/校舍）与状态查询扫码记录，用于页面“扫码记录栏”展示
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（历史记录可查）
- 出参（示例字段）：`[{ scan_event_id, person_id, person_name, time_stamp, status }]`

## 4. 兼容保留接口（非扫码主流程）

### POST `/api/mail-jobs`
- 说明：手动创建邮件任务（受权限控制），用于非扫码路径或后台运维
- 权限：管理员（`root_admin`）
- 订阅要求：`trial` 或 `active`

### GET `/api/mail-jobs`
- 查询：`status`, `created_from`, `created_to`
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无

### POST `/api/mail-jobs/{id}/retry`
- 说明：重试失败邮件任务
- 权限：管理员（`root_admin`）
- 订阅要求：`trial` 或 `active`（`expired` / `suspended` 禁止）

## 5. Admin Tenants（管理员）

### GET `/api/admin/tenants`
- 说明：查询租户列表（平台管理员）
- 权限：平台管理员（`root_admin`）

### GET `/api/admin/tenants/{id}`
- 说明：查询租户详情
- 权限：平台管理员（`root_admin`）

### PATCH `/api/admin/tenants/{id}/status`
- 说明：更新租户状态（`trial` / `active` / `expired` / `suspended`）
- 权限：平台管理员（`root_admin`）
