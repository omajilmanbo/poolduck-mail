# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: `Authorization: Bearer <token>`
- 所有业务接口默认在租户上下文中执行
- tenant 隔离：登录时接收并校验 `tenant_id`；登录成功后业务接口使用 token/session 中的 `tenant_id`，不接受业务接口显式传入 `tenant_id`
- 订阅状态统一：`trial` / `active` / `expired` / `suspended`
- 扫码邮件正文固定由后端生成，不接收 `custom_message` / `custom_text` / `mail_body` 等自定义正文字段
- 固定邮件正文模板：`{tenant_name}，{location_name}からのお知らせ：{person_name}　さんは　{time_stamp}　に入室しました。`

## 1. 认证（Auth）

### POST `/api/auth/login`
- 入参：`tenant_id`, `email`, `password`
- 出参：`access_token`, `expires_in`, `user`
- 错误：`tenant_id` 不存在时返回“tenant不存在”；用户不在该 tenant 或密码错误时返回登录失败

### POST `/api/auth/logout`
- 说明：使当前 token/session 失效

### GET `/api/auth/me`
- 说明：获取当前登录用户信息

## 2. License Check

### GET `/api/license/check`
- 说明：校验当前 tenant 订阅可用性
- 出参：`status`, `plan`, `expired_at`, `grace_period`
- 权限：已登录用户（`root_admin` / `manager`）

## 3. 扫码邮件核心流程 API

### GET `/api/locations`
- 说明：获取当前 tenant 可用的location（办公室/校舍）列表，用于扫码邮件页面切换上下文
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（仅用于页面初始化）
- 出参（示例字段）：`[{ location_id, location_name, is_active }]`
- 错误：跨租户 location 不可见

### GET `/api/locations/{location_id}/people`
- 说明：获取当前location（办公室/校舍）下人员一览与扫码编号映射
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（仅用于映射预加载）
- 出参（示例字段）：`[{ person_id, person_name, scan_code, email_masked }]`
- 错误：`location_id` 非法或不属于当前 tenant 时返回可识别错误

### POST `/api/scan-events`
- 入参：`location_id`, `scan_code`
- 说明：
  - 创建扫码事件记录
  - 后端在当前 tenant + location 上下文中查找扫码编号对应邮箱
  - 后端按固定模板生成最终邮件正文
  - 后端创建关联邮件任务（初始 `pending`）
  - 不接收任何自定义正文字段（`custom_message` / `custom_text` / `mail_body` 等）
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回订阅无效错误
- 出参（示例字段）：`scan_event_id`, `mail_job_id`, `mail_subject`, `status`
- 错误：
  - `location_id` 非法或不属于当前 tenant
  - `scan_code` 未找到映射邮箱：返回可识别业务错误，并将扫码事件记录为异常状态（如 `unmapped`）以便后续排查
  - 订阅无效

### POST `/api/mail-jobs/{mail_job_id}/send`
- 说明：确认/触发发送指定邮件任务（默认用于扫码后发送）
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：`trial` 或 `active`
- 出参（示例字段）：`mail_job_id`, `status`, `provider_result`
- 错误：
  - 邮件任务不属于当前 tenant
  - 任务状态不允许发送（如已发送）
  - provider 发送失败（返回可识别错误码与错误信息）

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
