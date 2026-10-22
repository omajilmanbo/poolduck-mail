# API 草案（MVP）

## 约定

- Base path: `/api`
- Auth: browser uses HttpOnly cookies (`poolduck_access`, `poolduck_refresh`); Bearer access tokens remain accepted for non-browser local tooling
- 所有业务接口默认在租户上下文中执行
- tenant 隔离：登录时接收并校验公开 `tenant_code`，服务端解析为内部 UUID；登录成功后业务接口使用 token/session 中的内部 `tenant_id`，不接受业务接口显式传入或覆盖 `tenant_id`
- 认证上下文：受保护接口通过后端 `JwtAuthGuard` 解析 token，并通过请求上下文注入 `tenant_id`、`user_id`、`role`；业务层通过统一上下文读取 tenant scope
- 角色判断：租户业务角色为 `tenant_manager` / `operator`；ADR-013 的 tenantless
  `platform_admin` 使用独立 `/api/platform/*` namespace、guard、Cookie 和 token audience，
  不加入租户业务角色集合
- 订阅状态统一：`trial` / `active` / `expired` / `suspended`
- 扫码邮件正文固定由后端生成，不接收 `custom_message` / `custom_text` / `mail_body` 等自定义正文字段
- 固定邮件主题和正文按动作选择：`entry` 显示「入室」，`exit` 显示「退室」；动作来自人员动作码，不接受独立动作字段

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

## 1a. 平台认证（ADR-013，#110 已实现）

### POST `/api/platform/auth/login`

- 入参：`email`, `password`；不接收 `tenant_code`，也不回退查询 tenant user
- 成功：设置独立 HttpOnly platform access/refresh Cookie，返回有限 `expires_in` 和最小平台身份摘要
- 失败：不存在、disabled 或密码错误均返回统一 `PLATFORM_LOGIN_FAILED`；执行伪哈希和限流
- MVP 不接收 TOTP，不返回或保存伪 `mfa_enabled`；完整 TOTP 由 #114 决策

### POST `/api/platform/auth/refresh`

- 只接受 platform refresh Cookie；逐次轮换并检测重放
- 账号 disabled、identity version 变化、Session 到期/撤销时统一拒绝并清除 Cookie

### POST `/api/platform/auth/logout`

- 撤销当前 platform Session 并清除独立 Cookie

### GET `/api/platform/auth/me`

- 只接受 platform access Cookie/token audience
- 出参只含 platform admin ID、脱敏/必要邮箱字段和状态；不含 `tenant_id`

### GET `/api/platform/auth/mail-mode`

- 只接受 platform access Cookie/token audience；tenant 用户和未认证请求不得读取
- 返回当前后端已校验的邮件 Provider 选择，响应仅为 `{ "mode": "mock" }` 或 `{ "mode": "oci_email_delivery_https" }`；`Cache-Control: no-store`
- 不返回发件地址、region、compartment、密钥或租户数据；此模式只表示提交方式，不表示单封邮件最终投递状态

platform token 调用租户业务 API、tenant token 调用上述平台 API 时均返回未授权/禁止，不进行
角色或账号回退。

### POST `/api/auth/change-initial-password`

- 权限：已登录且 `must_change_password=true` 的 tenant 用户
- 入参：`new_password`，至少 8 位并同时包含英文字母和数字
- 成功：清除强制改密状态、撤销该用户全部 refresh Session、清除当前 Cookie，并要求重新登录
- 其他受角色保护的租户 API 在强制改密完成前返回 `PASSWORD_CHANGE_REQUIRED`

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

> 实施状态：ADR-017 已在本地运行时代码实现。`POST /api/scan-events` 创建初始 `waiting` 任务并返回
> `effective_status`、`mail_status`、`can_cancel`、`cancel_until`、`server_time` 与 `canceled_at`；
> `POST /api/scan-events/{scan_event_id}/cancel` 是受支持的取消入口。客户端倒计时仅作提示，最终结果
> 仍由服务端数据库时间和持久化状态决定。
> 创建响应的 `server_time` 与 `received_at` 来自同一创建事务的 PostgreSQL 时间；取消成功响应的
> `server_time` 也来自取消事务，不使用浏览器或应用节点时间决定权限。

ADR-017 当前契约：

- 取消 endpoint 只接收路径中的 `scan_event_id`；tenant、location、actor、mail job 与截止时间均由
  服务端关系和认证上下文确定。
- 首次成功与重复取消返回 `200` 和首次 `canceled_at`；跨 tenant/location、未知 ID 或无 assignment
  统一 `SCAN_EVENT_NOT_FOUND`。
- 截止已到但未领取返回 `409 SCAN_CANCEL_WINDOW_EXPIRED`；`processing`、`sent`、`failed` 或
  `delivery_unknown` 返回 `409 SCAN_CANCEL_NOT_AVAILABLE`。
- 相同扫码 `Idempotency-Key` 只重放原事件的最新状态；已取消事件不延长窗口、不触发 provider。
- 取消成功后可用新的 `Idempotency-Key` 立即重扫；原 key 不得改绑到新事件。

### GET `/api/locations`
- 说明：获取当前 token tenant 可用的地点列表，用于扫码邮件页面切换上下文
- 租户上下文：仅使用认证会话中的 `tenant_id`
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（仅用于页面初始化）
- location 授权：`tenant_manager` 返回本 tenant 全部 location；`operator` 只返回显式分配的 location。无 assignment 时返回空数组
- 管理页可传 `include_deleted=true` 查看尚在 14 天恢复期内的地点；普通调用排除
  `pending_delete` / `purged`
- 出参：`[{ location_id, location_code, location_name, type, is_active, deletion_status, deleted_at, purge_after }]`；`location_id` 与 `location_code` 均返回 8 位公开业务 ID，`type` 固定为 `location`，不返回内部 UUID
- 错误：未认证时返回 `UNAUTHORIZED`

### GET `/api/locations/{location_id}/people`
- 说明：获取当前 token tenant + location 下人员一览与服务端生成的人员业务 ID
- 租户上下文：查询必须限定 `tenant_id + location_id`，不允许跨租户读取 location 或人员映射
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（仅用于映射预加载）
- location 授权：`operator` 必须已被显式分配该 location；未分配、伪造或跨 tenant 的 `location_id` 与不存在地点统一返回 `LOCATION_NOT_FOUND`
- 管理页可传 `include_deleted=true` 查看尚在恢复期内的人员；普通调用排除
  `pending_delete` / `purged`
- 出参：`[{ person_id, person_code, person_name, scan_code, email_masked, is_active, deletion_status, deleted_at, purge_after }]`；`person_id` 与兼容字段 `scan_code` 当前均返回 `person_code`，不返回内部 UUID
- 隐私：不返回完整邮箱地址
- 人员读取与写入路径统一执行 operator-location 门禁；客户端提交的 location 参数不能扩大权限

### 人员映射写接口

- `GET /api/locations/{location_id}/people/{person_id}`：`person_id` 使用公开 `person_code`；受控编辑时返回完整邮箱
- `POST /api/locations/{location_id}/people`：入参仅 `person_name`, `email`；服务端生成 12 位 `person_code`，客户端提交 `person_code` / `scan_code` 会返回 `400`
- `PATCH /api/locations/{location_id}/people/{person_id}`：仅允许更新姓名、邮箱；不接受状态、`person_code`、`scan_code` 或 `location_id`
- `DELETE /api/locations/{location_id}/people/{person_id}`：软停用，历史保留
- `POST /api/locations/{location_id}/people/{person_id}/reactivate`：重新启用已停用人员；地点本身必须 active，人员 ID 与历史关联不变
- `POST /api/locations/{location_id}/people/{person_id}/delete`：安排 14 天后终结删除并立即停止业务使用
- `POST /api/locations/{location_id}/people/{person_id}/restore`：期限内恢复为删除前的 active/inactive 状态；到期返回 `DELETION_RESTORE_EXPIRED`
- 生成规则：前 7 位为 Unix 秒、后 5 位为安全随机值；数据库唯一冲突最多重试 5 次，耗尽返回 `PERSON_CODE_GENERATION_EXHAUSTED`

### 地点写接口

- `POST /api/locations`：仅接收 `location_name`；服务端生成 8 位公开 ID，固定写入 `type=location`。提交 `location_id`、`location_code` 或 `type` 返回 `400`
- `PATCH /api/locations/{location_id}`：仅允许修改 `location_name`；同 tenant 名称去除首尾空白后按大小写不敏感规则唯一
- `DELETE /api/locations/{location_id}`：仅 `tenant_manager`，软停用
- `POST /api/locations/{location_id}/reactivate`：仅 `tenant_manager`，重新启用已停用地点
- `POST /api/locations/{location_id}/delete`：仅 `tenant_manager`，安排 14 天后终结删除；立即终止 queued 邮件
- `POST /api/locations/{location_id}/restore`：仅 `tenant_manager`，期限内恢复删除前状态；到期返回 `DELETION_RESTORE_EXPIRED`
- DELETE 为软停用；停用后拒绝新扫描与人员映射写入，并把该地点 queued 邮件安全终止为 failed/`LOCATION_INACTIVE`
- 终结清理由幂等后台任务按数据库时间执行：当前 PII 被匿名化、地点 assignments 被撤销；既有历史快照不因地点终结而改写，仍按 ADR-024 的正常一年期限独立销毁
- location ID 冲突最多重试 5 次，耗尽返回 `LOCATION_CODE_GENERATION_EXHAUSTED`；不存在、跨 tenant 或 operator 未授权统一返回 `LOCATION_NOT_FOUND`
- 错误：`location_id` 非法或不属于当前 tenant 时返回 `LOCATION_NOT_FOUND`

### POST `/api/scan-events`
- 入参：`location_id`, `scan_code`；`scan_code` 必须是精确、区分大小写、固定 13 位的 `E<12 位 person_code>` 或 `X<12 位 person_code>`；旧 `V2E` / `V2X` 不再接受
- 允许无提交后缀或单个 `CR`、`LF`、`CRLF`/Enter 后缀；前导/尾随空格、内部空白、设备前缀、重复后缀、未知版本/动作、错误大小写、截断和 `PD1` 旧格式统一返回 `ACTION_CODE_INVALID`。不实施 `PD1`/`V2` 双读
- 可选请求头：`Idempotency-Key`（8–200 位可见 ASCII）。相同 tenant、route、key 与相同请求内容在 24 小时内返回首次结果；同一 key 携带不同 location/person/action 返回 `IDEMPOTENCY_KEY_CONFLICT`
- 说明：
  - 创建扫码事件记录
  - 后端解析版本、动作与 `person_code`；裸 `person_code`、未知版本/动作、格式错误或混合大小写一律返回 `ACTION_CODE_INVALID`
  - 后端只在 JWT tenant + 当前 location 上下文中按解析后的 `person_code` 查找 active 映射；本接口不再兼容裸码或旧 `scan_code`
  - 新邮件任务的主题为 `【{tenant_name}】【{location_name}】からのお知らせ-{action}`，纯文本正文为姓名敬称、区分、日本时间及自动发送说明；`entry` 使用「入室」，`exit` 使用「退室」。完整格式见 `docs/architecture.md` 第 11 节。历史任务主题/正文不改写
  - 后端在事务内把动作、动作来源 `person_action_code`、person → location → tenant 外键及发送时名称/人员码/动作快照写入 scan event/mail job，再创建初始 `waiting` 任务；provider 在数据库 `send_not_before` 到期且 worker 原子领取后才可调用
  - 同 tenant、location、解析后的 `person_code`、同动作在 10 秒内重复提交时返回原 scan event/mail job，响应 `deduplicated=true`；相反动作在窗口内返回 `SCAN_ACTION_CONFLICT`，不创建第二条记录或任务
  - 邮件重试只发送 mail job 已固化的正文和动作，不根据后续扫描或人员状态重新推断
  - 不接收任何自定义正文字段（`custom_message` / `custom_text` / `mail_body` 等）
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：`trial` 或 `active`；`expired` / `suspended` 返回 `SUBSCRIPTION_NOT_SENDABLE`
- location 授权：`operator` 必须已分配该 location；门禁在幂等结果重放之前执行，因此撤销 assignment 后旧 `Idempotency-Key` 也不能继续读取或提交该地点结果
- 出参：`scan_event_id`, `mail_job_id`, `person_code`, `action`, `action_source`, `mail_subject`, `status`, `effective_status`, `mail_status`, `can_cancel`, `cancel_until`, `server_time`, `canceled_at`, `retry_count`, `scheduled_at`, `error_message`, `deduplicated`
- 正常响应示例：

```json
{
  "scan_event_id": "55555555-5555-4555-8555-555555555555",
  "mail_job_id": "66666666-6666-4666-8666-666666666666",
  "person_code": "01K0ABC10001",
  "action": "entry",
  "action_source": "person_action_code",
  "mail_subject": "【Poolduck Tenant】【Office A】からのお知らせ-入室",
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
  - 动作码中的 `person_code` 未找到当前 tenant/location 的 active 映射邮箱：返回 `SCAN_CODE_NOT_MAPPED`，响应不含 `scan_event_id`，不创建 scan event、case、mail job 或逐请求数据库审计
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
- OCI 模式在 Staging 获准并完成预检后，`sent` 只表示 OCI accepted，不代表收件箱投递；只有明确的 429/配额拒绝进入有限退避。认证/请求 4xx 与 suppression 终态为 `failed`；超时、断线、5xx 或回执不完整进入 `delivery_unknown`，不自动重发。`error_message` 与 `provider_result.error_message` 仅返回稳定安全原因码，不透出 OCI 原始错误。
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

### GET `/api/scan-events`
- 查询：`location_id`, `status`, `created_from`, `created_to`, `cursor`, `limit`（默认 25，最大 100）
- 说明：按location（办公室/校舍）与状态查询扫码记录，用于页面“扫码记录栏”展示
- 权限：已登录用户（`tenant_manager` / `operator`）
- 订阅要求：无（历史记录可查）
- 状态：`queued` / `processing` / `sent` / `failed`
- 出参：`{ items: [...], next_cursor }`；按 `created_at DESC, id DESC` 稳定排序，下一页原样传回 `next_cursor`
- 非本 tenant 的 `location_id` 返回 `LOCATION_NOT_FOUND`
- operator 未分配的 `location_id` 同样返回 `LOCATION_NOT_FOUND`；不提供 location 过滤条件时，列表也只包含已分配地点

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

## 6. Platform Control（ADR-013，#111 已实现）

以下接口只允许独立 `platform_admin`，不复用 `/api/admin/*`、tenant `JwtAuthGuard` 或 nullable
tenant 查询。响应只包含 tenant/subscription/额度/脱敏 manager 摘要，不返回人员、扫码、邮件、
租户审计或其他业务明细。

### GET `/api/platform/tenants`

- 说明：查询 tenant name、`tenant_code`、subscription、`location_limit`/当前计数、
  脱敏首个 tenant_manager 和平台版本
- 权限：platform_admin
- 列表摘要包含 `deleted_at`、`purge_after`（未删除时均为 `null`）
- `recent_platform_operation` 另返回平台审计的 `action`、`result`、时间与审计 ID；平台控制台仅用 Staging 删除开始/失败审计判断清理提示，不返回租户业务审计或敏感元数据

### GET `/api/platform/auth/environment`

- 仅有效 `platform_admin` Session 可读取；响应 `Cache-Control: no-store`
- 返回 `{ environment: "production"|"staging"|"unavailable", deletion_enabled: boolean }`。Production 删除入口可用；Staging 仅在 `STAGING_TENANT_DELETE_ENABLED=true` 时可用；其他环境不可用。环境值由服务器决定，不接受客户端覆盖

### POST `/api/platform/tenants`

- Header：必填 `Idempotency-Key`
- 入参：`name`, `manager_email`, `subscription_status`（仅 `trial|active`）,
  `start_at`, `end_at`, `location_limit`
- 服务端原子生成内部 UUID、`tenant_code`、subscription、首个 tenant_manager 和一次性临时密码；
  不接收客户端 UUID/tenant_code
- 临时密码只在该逻辑操作的成功响应/安全重放中返回；数据库只保存 Argon2 哈希并要求首次登录改密，
  UI 关闭一次性凭据区域后清除
- 相同 key/请求安全重放原结果；相同 key/不同请求返回 `IDEMPOTENCY_KEY_CONFLICT`

### GET `/api/platform/tenants/{tenant_code}`

- 返回 ADR-013 最小 tenant 摘要和乐观并发 `version`
- 摘要还包含 `deleted_at`、`purge_after`（未删除时均为 `null`）；不返回删除前状态快照

### GET `/api/platform/audit-logs`

- 仅独立的 active `platform_admin` Session 可读；租户 token、失效平台 Session 和普通租户身份均拒绝
- 可选筛选：`created_from`、`created_to`（ISO 时间，闭区间）、`platform_admin_id`（内部 UUID）、`action`（精确值）、`result`（`success|failure|denied`）、`target_tenant_id`（内部 UUID）；时间范围倒置返回 `INVALID_AUDIT_RANGE`
- `limit` 默认 25、最大 100；按 `created_at DESC, id DESC` 稳定分页，响应为 `{ items, next_cursor }`。游标绑定筛选条件；无效或混用筛选条件返回 `INVALID_CURSOR`
- 每行仅含 `audit_id`、管理员内部 ID、目标租户内部 ID 与可用的平台租户摘要、action、result、资源类型/安全 ID、经白名单复核的元数据及创建时间。Staging 租户已清理时摘要为 `null`，仍可显示安全清理结果。不返回邮箱、邮件正文、人员、扫码、租户 `audit_logs`、token 或任意原始元数据
- 每次成功查询写一条最小 `platform.audit.query` 审计，仅记录管理员内部 ID 和返回数量；审计写入失败时查询失败，不提供导出或修改接口

### PATCH `/api/platform/tenants/{tenant_code}/subscription`

- 入参：`status`, `start_at`, `end_at`, `version`
- 支持 `trial|active|expired|suspended`；高影响变更记录旧/新状态和非 PII 平台审计

普通暂停通过 subscription PATCH 写入 `suspended`；非删除中租户可通过同一 PATCH 显式写入
`trial|active`、有效 `start_at`/`end_at` 与当前 `version`。`pending_delete` / `purged` / `staging_deleting`
租户的普通订阅更新返回 `PLATFORM_TENANT_PENDING_DELETE`，不能绕过删除流程重新激活；待删除租户必须使用下述恢复接口。

### POST `/api/platform/tenants/{tenant_code}/delete`

- 仅 active `platform_admin` 且当前 Session 有效；请求体仅 `{ "password": "当前管理员密码" }`，服务端在同一次请求中重新验密
- `APP_ENV=production`：以数据库时间原子设置 tenant `status=pending_delete`、`deleted_at`、`purge_after=deleted_at + interval '1 year'` 及删除前 tenant/订阅状态快照，同时将订阅改为 `suspended`
- 目标 `subscription.status=active` 时返回 `409 PLATFORM_TENANT_ACTIVE_SUBSCRIPTION`，不修改 tenant 或订阅；`trial`、`expired`、`suspended` 可继续删除。检查与删除写入位于同一租户锁定事务中
- Production 返回 `{ tenant_code, status: "pending_delete", deleted_at, purge_after, idempotency_replayed }`；重复删除不重置期限或重复修改订阅
- Production 待删除窗口内，现存扫码/邮件家族与租户业务审计暂停日常一年到期清理；到期终结时销毁在线记录，仅保留基本对象非 PII 墓碑。平台审计按自身一年期限处理，未结束的删除流程关联记录暂缓清理。数据库备份生命周期另行决定
- `APP_ENV=staging` 且 `STAGING_TENANT_DELETE_ENABLED=true`：先持久化 `staging_deleting` 和订阅 `suspended`，再事务性删除目标当前对象及全部历史。成功返回 `{ tenant_code, status: "deleted", deleted_at: null, purge_after: null, idempotency_replayed }`；相同租户重复请求仍须重新验密后安全重放。失败时保留阻断状态供重新验密重试；无恢复接口
- Staging 未启用开关或其他环境返回 `PLATFORM_TENANT_DELETE_ENV_UNAVAILABLE`；该接口不接受客户端选择环境
- 错误密码返回 `PLATFORM_DELETE_PASSWORD_INVALID`，请求期间失效的 Session 返回 `PLATFORM_DELETE_SESSION_INVALID`；未知 tenant 返回 `PLATFORM_TENANT_NOT_FOUND`，已终结 tenant 返回 `PLATFORM_TENANT_PENDING_DELETE`
- `environment`、保留期及任何其他额外请求字段均拒绝；Production 删除期间的登录、Session 和既有读取继续遵循暂停订阅语义，新扫码及等待/重试邮件由现有 `suspended` 门禁阻断。Staging `staging_deleting` 拒绝租户认证及当前对象写入
- 审计只记录内部 tenant/admin ID、合法 request ID、环境、结果和原因码，不记录密码或业务 PII

### POST `/api/platform/tenants/{tenant_code}/restore`

- 仅 active `platform_admin` 且当前 Session 有效；仅 `APP_ENV=production` 开放，不接收客户端指定的环境、期限或恢复状态
- 目标必须为 `pending_delete`；服务器在持有目标 tenant 行锁的事务中，以数据库 `clock_timestamp() < purge_after` 为条件恢复删除前 tenant/subscription 状态，并清空四项生命周期字段。恰好到期及之后返回 `409 PLATFORM_TENANT_RESTORE_EXPIRED`，即使到期清理尚未运行
- 成功返回与 `GET /api/platform/tenants/{tenant_code}` 相同的最小平台摘要；恢复仅成功一次，重复请求返回 `409 PLATFORM_TENANT_NOT_PENDING_DELETE`
- Staging 或未知环境返回 `PLATFORM_TENANT_RESTORE_ENV_UNAVAILABLE`；订阅状态与快照不一致返回 `PLATFORM_TENANT_RESTORE_STATE_INVALID`，整笔事务回滚
- 不延长订阅 `end_at`，既有 Session 继续遵循原认证语义；已过期的 `trial`/`active` 仍由 ADR-003 到期门禁阻止扫码和发信。不修改人员/地点的独立删除状态，不重新排队或重发历史邮件
- 恢复立即解除记录清理冻结；创建时间超过正常一年期限的记录可被下一轮清理删除，无额外导出宽限期
- 进入恢复服务后的成功与业务拒绝使用内部 tenant/admin ID、合法 request ID、环境、结果和原因码记录脱敏平台审计；认证守卫与请求体验证在服务调用前拒绝

### PATCH `/api/platform/tenants/{tenant_code}/location-limit`

- 入参：正整数 `location_limit`, `version`
- active/inactive/pending deletion location 均计数，purged 后释放
- 新额度低于当前计数返回 `LOCATION_LIMIT_BELOW_CURRENT_USAGE`，且不修改既有 location
- tenant location 创建达到额度时返回 `LOCATION_LIMIT_REACHED`；创建与调额使用并发安全事务

所有平台写操作必须记录 request ID、目标内部 tenant ID、actor platform admin ID 和结果，不记录
密码、token、完整邮箱或租户业务 PII。商业价格、付款、账单、proration 和自动扩容不属于这些接口。
