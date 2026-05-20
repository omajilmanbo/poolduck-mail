# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: `Authorization: Bearer <token>`
- 所有业务接口默认在租户上下文中执行

## 1. 认证（Auth）

### POST `/api/auth/login`
- 入参：`email`, `password`
- 出参：`access_token`, `expires_in`, `user`

### POST `/api/auth/logout`
- 说明：使当前 token/session 失效

### GET `/api/auth/me`
- 说明：获取当前登录用户信息

## 2. License Check

### GET `/api/license/check`
- 说明：校验当前 tenant 订阅可用性
- 出参：`status`, `plan`, `expired_at`, `grace_period`

## 3. Scan Events

### POST `/api/scan-events`
- 入参：`scan_code`, `scan_type`, `device_code`, `raw_payload`
- 说明：MVP 不接收 `custom_message` 等自定义邮件正文参数；邮件正文由后端按固定模板生成
- 出参：`scan_event_id`, `mail_job_preview`

### GET `/api/scan-events/{id}`
- 说明：查询单条扫码记录

### GET `/api/scan-events`
- 查询：按时间范围、device、状态筛选

## 4. Mail Jobs

### POST `/api/mail-jobs`
- 说明：手动创建邮件任务（受权限控制）

### GET `/api/mail-jobs/{id}`
- 说明：查询邮件任务状态

### GET `/api/mail-jobs`
- 查询：`status`, `created_from`, `created_to`

### POST `/api/mail-jobs/{id}/retry`
- 说明：重试失败邮件任务

## 5. Admin Tenants（管理员）

### GET `/api/admin/tenants`
- 说明：查询租户列表（平台管理员）

### GET `/api/admin/tenants/{id}`
- 说明：查询租户详情

### PATCH `/api/admin/tenants/{id}/status`
- 说明：更新租户状态（active/suspended）
