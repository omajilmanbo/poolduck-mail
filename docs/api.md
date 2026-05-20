# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: `Authorization: Bearer <token>`
- 所有业务接口默认在租户上下文中执行
- tenant 隔离：登录时接收并校验 `tenant_id`；登录成功后业务接口使用 token/session 中的 `tenant_id`，不接受业务接口显式传入 `tenant_id`
- 订阅状态统一：`trial` / `active` / `expired` / `suspended`

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

## 3. Scan Events

### POST `/api/scan-events`
- 入参：`scan_code`, `scan_type`, `device_code`, `raw_payload`
- 说明：MVP 不接收 `custom_message` 等自定义邮件正文参数；邮件正文由后端按固定模板生成
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回订阅无效错误
- 出参：`scan_event_id`, `mail_job_preview`

### GET `/api/scan-events/{id}`
- 说明：查询单条扫码记录
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（历史记录可查）

### GET `/api/scan-events`
- 查询：按时间范围、device、状态筛选
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无（历史记录可查）

## 4. Mail Jobs

### POST `/api/mail-jobs`
- 说明：手动创建邮件任务（受权限控制）
- 权限：管理员（`root_admin`）
- 订阅要求：`trial` 或 `active`

### GET `/api/mail-jobs/{id}`
- 说明：查询邮件任务状态
- 权限：已登录用户（`root_admin` / `manager`）
- 订阅要求：无

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
