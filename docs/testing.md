# 测试策略（MVP）

## 1. 测试目标

- 覆盖核心业务闭环：登录 → 扫码事件 → 邮件任务
- 保证租户隔离、权限控制、订阅校验正确性
- 降低高风险模块（auth/billing/data）上线风险

## 2. 必测类型

### 2.1 单元测试
- 认证逻辑（密码校验、token 解析）
- 订阅状态判断（trial/active/expired/suspended）
- 邮件任务状态流转

### 2.2 集成测试
- API 与数据库交互
- 扫码事件创建到邮件任务生成链路
- 重试机制与失败记录

### 2.3 权限与安全测试
- RBAC 角色访问边界
- operator 生命周期：仅 tenant_manager 可用、跨 tenant/tenant_manager 目标统一拒绝、重复
  username/email、保留字/Unicode、8 位字母数字密码边界、身份修改/禁用/重置会话撤销、响应不含
  passwordHash
- 登录身份：username/email 双模式、无邮箱 operator、tenant_manager email-only、大小写规范化、统一
  `LOGIN_FAILED`、伪哈希路径、限流与旧 `email` 请求字段兼容
- 未授权访问拦截
- 输入参数校验与错误码一致性

### 2.4 租户隔离测试（重点）
- Tenant A 无法读取/操作 Tenant B 数据
- 跨租户 ID 访问必须返回拒绝
- 审计日志记录越权尝试

### 2.5 订阅与计费相关测试（重点）
- 订阅过期禁止关键业务接口
- `trial` / `active` 允许扫码与发信，`expired` / `suspended` 禁止扫码提交、创建邮件任务、发送与重试
- license check 结果与订阅状态一致

## 3. 回归基线

每次发布前至少执行：
- 登录相关回归
- 租户隔离回归
- 订阅状态回归
- 邮件发送成功/失败回归

## 4. 本地 seed 与 API 冒烟

进入 GUI 黑盒或 Staging 前，需要先完成本地 API 冒烟验证。

### 4.1 准备本地数据库

1. 启动本地 PostgreSQL：`docker compose up -d postgres`
2. 进入后端目录：`cd backend`
3. 生成 Prisma Client：`npm run prisma:generate`
4. 执行 migration：`npm run db:migrate`
5. 写入安全示例 seed：`npm run local:seed`

seed 数据仅使用 `example.local` 邮箱和固定 UUID，不包含真实客户数据、真实收件邮箱或真实邮件凭据。

核心 seed 值：

- `tenant_id`: `11111111-1111-4111-8111-111111111111`
- `operator@example.local` / `PoolduckLocal123!`
- `tenant-manager@example.local` / `PoolduckLocal123!`
- `location_id`: `66666666-6666-4666-8666-666666666666`
- active `person_code`: `01K0ABC10001`；进入动作码：`PD1|ENTRY|01K0ABC10001`；离开动作码：`PD1|EXIT|01K0ABC10001`
- unmapped 动作码：`PD1|ENTRY|01K0ABC19999`

### 4.2 API happy path 冒烟

1. 使用默认 sandbox success 启动后端：`npm run start:dev`
2. 另开终端执行：`npm run smoke:api`

脚本验证链路：

`health -> login -> license/check -> locations -> people -> unmapped scan -> mapped scan -> automatic sandbox result`

预期结果：

- unmapped scan 创建异常 `scan_event`，不创建 `mail_job`
- mapped scan 在事务内创建 `queued` mail_job，事务提交后自动调用 sandbox
- sandbox success 将 `mail_job` 更新为 `sent`；失败按 30 秒/2 分钟/10 分钟重试

### 4.3 API failure path 冒烟

1. 设置 `MAIL_MOCK_SEND_RESULT=failure` 后启动后端。
2. 执行 smoke，并声明首次自动发送失败后进入 queued 重试：
   - Windows PowerShell: `$env:API_SMOKE_EXPECT_SEND_STATUS='queued'; npm run smoke:api`
   - macOS/Linux: `API_SMOKE_EXPECT_SEND_STATUS=queued npm run smoke:api`

预期结果：

- mapped scan 仍创建 `queued` mail_job
- sandbox failure 进入 `queued` 重试；三次重试耗尽后更新为 `failed` 并保留安全 `error_message`

### 4.4 Local Compose 容器组冒烟

Issue #60 后，本地 GUI 黑盒前应额外验证容器组形态：

1. 构建并启动容器组：`docker compose up -d --build`
2. 查看状态：`docker compose ps`
3. 验证健康检查：
   - `GET http://localhost:3000/healthz`
   - `GET http://localhost:3001/health`
4. 写入 seed：`docker compose exec backend npm run local:seed`
5. 执行 API smoke：`docker compose exec backend npm run smoke:api`
6. 查看日志：
   - `docker compose logs -f backend`
   - `docker compose logs -f frontend`
7. 停止容器组：`docker compose down`

该流程仍使用 sandbox/mock mail provider，不得接入真实邮件 provider 或真实客户数据。

### 4.5 operator 生命周期人工验证

1. 用 `tenant-manager@example.local` 登录并调用 `GET /api/users`，确认只返回本 tenant 的 `operator` 且无 `passwordHash`。
2. 用 `POST /api/users` 创建只有合成 username、无邮箱的 operator；再绑定合成邮箱，确认 username/email
   均可登录。密码分别验证：7 位、仅字母、仅数字被拒绝，8 位以上字母数字组合成功。
3. 用 operator 会话调用 `/api/users`，确认返回 `ROLE_FORBIDDEN`。
4. 尝试操作其他 tenant 用户 ID 和当前 `tenant_manager` ID，确认均返回 `MANAGED_OPERATOR_NOT_FOUND`。
5. 停用 operator 后用其现有 access/refresh 会话访问受保护接口，确认立即返回 `USER_DISABLED` 或未认证。
6. 修改 username 或清空 email 后确认旧会话失效；重新启用后旧会话仍不可用。使用新密码登录后，
   再执行密码重置并确认全部既有会话失效。
7. 查询审计日志，确认创建、修改、启停、密码重置和拒绝事件存在，且不含密码、哈希、token 或完整敏感数据。
8. 用 `tenant_manager` 打开“用户管理”，确认可创建、修改 username/可选邮箱、启停和重置 operator；
   列表不显示密码或哈希，身份修改撤销会话，停用及重置都有确认框，提交后密码输入被清空。
9. 用 `operator` 登录，确认工作台无“用户管理”入口；直接访问 `/users` 会返回工作台，且后端 `/api/users` 仍拒绝 operator。

### 4.6 Issue #93 人员 ID 与邮件追溯验证

- 正常：新增人员时只提交姓名和合成邮箱，确认响应的 `person_code` 为 12 位大写 Crockford Base32，`person_id`/`scan_code` 与其一致；扫码后 scan event/mail job 均可追溯到同一 person/location/tenant。
- 错误与边界：提交客户端自定义 `person_code`/`scan_code` 返回 `400`；模拟唯一冲突时最多重试 5 次，耗尽返回 `PERSON_CODE_GENERATION_EXHAUSTED`；同秒生成不重复，后一秒代码字典序更大。
- 权限与隔离：使用其他 tenant 的 location，或在同 tenant 的其他 location 使用人员码，均不得解析人员或创建邮件任务；未映射输入只创建异常扫码记录。
- 历史一致性：扫码后修改 tenant/location/person 名称，确认邮件任务详情和导出仍显示发送时快照；只读列表、审计、错误和 CSV 不含完整邮箱、邮件正文或 UUID/人员码批量对应。
- 回归：人员管理接口仍返回兼容字段 `scan_code=person_code`，但扫码写接口只接受两张 `PD1` 动作码；新建人员不能编辑或移动 `person_code`，停用/恢复仍保留同一业务 ID。
- 动作码图片：在人员管理打开“查看动作码”，确认展示进入/离开 × 二维码/Code 128 共四张预览，单张 PNG 与 ZIP 文件名仅含 `person_code`、动作和格式；使用开源解码器往返还原 `PD1|ENTRY|<person_code>` / `PD1|EXIT|<person_code>`。
- 图片安全与错误：断言图片、文件名和 ZIP 不含姓名、邮箱、tenant/location UUID 或内部人员 UUID；缺失、非法 `person_code` 及画布/ZIP 生成失败时显示错误并保持下载不可用，不使用 UUID 回退，也不发起外部图片请求。

人工步骤：

1. 备份本地合成数据库，执行 `npm.cmd run db:deploy` 与 `npm.cmd run local:seed`。
2. 在人员管理新增一名合成人员，记录系统生成的 `person_code`；确认页面没有可编辑扫描码输入。
3. 在正确 location 扫描 `PD1|ENTRY|<person_code>`，确认邮件详情的 `context` 含发送时 tenant/location/person 名称和相同 `person_code`，且不返回完整邮箱或正文。
4. 修改人员或地点名称后重新读取旧邮件任务，确认 `context` 未变化。
5. 在另一个 location 或 tenant 扫描同一人员动作码，确认返回统一未映射/不存在结果且未创建 mail job。
6. 在一次性数据库运行 `backend/prisma/rollback/20260724000000_add_person_codes_and_mail_context.sql`，确认 `scan_code`、UUID、人员映射、扫码事件和邮件任务行仍保留；禁止在未备份或仍有写流量的数据库直接回滚。

### 4.7 Issue #95 进出动作一致性验证

- 正常：分别提交 `PD1|ENTRY|<person_code>` 与 `PD1|EXIT|<person_code>`，确认响应、scan event、mail job、历史列表、CSV 与固定正文分别一致显示 `entry/进入/入室` 和 `exit/离开/退室`。
- 错误：裸 `person_code`、未知版本、未知动作、错误大小写和非法长度均返回 `ACTION_CODE_INVALID`，且不创建 scan event/mail job；格式正确但未映射的动作码只创建带原动作的 unmapped 记录。
- 重复与边界：同 tenant/location/person/action 在 10 秒内返回首次结果；相反动作返回 `SCAN_ACTION_CONFLICT`；窗口外可创建下一次动作。并发请求不得创建重复可发送任务。
- 幂等与重试：相同 `Idempotency-Key` 和请求在 24 小时内重放原结果且不再次调用 provider；同 key 不同动作返回 `IDEMPOTENCY_KEY_CONFLICT`；自动重试继续使用原 `action_snapshot` 与已固化正文。
- 权限、订阅与租户隔离：`tenant_manager` / `operator` 在 `trial` / `active` 可提交；`expired` / `suspended` 禁止新提交，但已有幂等结果可安全重放；其他 tenant/location 的人员码不得解析或创建 mail job。
- 兼容：迁移前记录显示 `unknown` / `legacy_unknown`，不得按时间、每日次数或相邻记录反推动作。

人工步骤：

1. 在合成数据环境登录 active tenant，选择包含目标人员的 location。
2. 扫描进入码，确认工作台立即和刷新后均显示“进入”，邮件正文以“入室しました。”结束。
3. 10 秒内再次扫描进入码，确认返回原记录；再扫描离开码，确认提示动作冲突且历史不新增。
4. 窗口结束后扫描离开码，确认显示“离开”，邮件正文以“退室しました。”结束。
5. 使用同一 `Idempotency-Key` 重放步骤 4，确认返回相同 scan/mail ID；改为进入码复用该 key，确认被拒绝。
6. 在一次性数据库验证 `backend/prisma/rollback/20260724010000_add_scan_actions.sql`；必须先备份并停止写流量，确认回滚只移除 #95 的动作/幂等结构。

### 4.8 Issue #96 operator-location 授权验证

- 正常与边界：tenant_manager 为 operator 设置单个、多个或空 assignment；重复 location ID 返回 `400`，空数组撤销全部。新旧 operator 没有 assignment 时 location 列表为空。
- 权限：operator 不能调用 assignment API；tenant_manager 仍可访问本 tenant 全部 location，不受 assignment 限制。
- 隔离与错误：跨 tenant operator/location、伪造 ID 和未分配 location 均使用统一 not-found 响应；inactive location 不能新增 assignment，新扫码、人员映射和未映射处理继续被地点状态门禁阻止。
- 跨模块回归：locations、people、scan events、scan/mail history、mail send 与 unmapped cases 均复用服务端 assignment 过滤；不带 location 参数的列表也不能返回其他地点。
- 撤销：撤销后不等待 JWT 过期或页面重登，新的扫码、映射写入、历史查询和异常处理立即被拒绝；已有 queued 系统重试仍按独立邮件任务规则处理。
- 订阅与网络：已授权的 `trial` / `active` 保持原行为，`expired` / `suspended` 仍由订阅门禁拒绝扫码；assignment API 网络失败不得在客户端假定保存成功或扩大权限。
- 迁移与回滚：migration 不包含 assignment backfill，确保不会误授权同 tenant 或其他 tenant；回滚先回应用再删表，并明确旧应用会恢复宽权限。

人工步骤：

1. 在合成数据库执行 migration 和 seed；确认 seed 仅为明确列出的合成 operator/location 创建 assignment。
2. 用 tenant_manager 创建一个新 operator，确认其 `GET /api/locations` 返回空数组。
3. 通过 `PUT /api/users/{operator_id}/location-assignments` 分配一个地点，确认 operator 只能访问该地点的 locations、people、scan、history、mail history 与 unmapped cases。
4. 再分配第二个地点，确认两地点均可访问；提交其他 tenant、inactive 和伪造 location ID，确认整次替换失败且原 assignment 不变。
5. 撤销第一个地点，立即复用现有 operator token 和旧 `Idempotency-Key` 请求该地点，确认返回 not-found 且不创建新 scan event/mail job。
6. 用 tenant_manager 验证同一地点仍可正常读取，查询审计日志确认 set/revoke/denied 事件存在且不含姓名、邮箱、密码、token 或邮件正文。
7. 在一次性数据库按文档顺序验证 `backend/prisma/rollback/20260724020000_add_operator_location_assignments.sql`，禁止在未备份、仍有写流量或未批准恢复旧宽权限时执行。

## 5. Staging seed data

Staging verification uses `npm run staging:seed` from `backend/`, or the container equivalent:

```powershell
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed
```

The command is idempotent and writes only synthetic `.example.local` data. It prepares these fixed accounts:

每个表中列出的 staging operator 都只被显式分配到同一行的合成 Location ID；seed 不会为任何其他 operator 自动授权全部地点。

| Subscription | Tenant ID | Operator | Password | Location ID | Person code / ENTRY action code |
|---|---|---|---|---|---|
| active | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | `staging-active-operator@example.local` | `PoolduckStaging123!` | `dddddddd-dddd-4ddd-8ddd-dddddddddddd` | `01K0ABC20001` / `PD1|ENTRY|01K0ABC20001` |
| suspended | `11111112-1112-4112-8112-111111111112` | `staging-suspended-operator@example.local` | `PoolduckStaging123!` | `44444445-4445-4445-8445-444444444445` | `01K0ABC20002` / `PD1|ENTRY|01K0ABC20002` |
| expired | `66666667-6667-4667-8667-666666666667` | `staging-expired-operator@example.local` | `PoolduckStaging123!` | `99999990-9990-4990-8990-999999999990` | `01K0ABC20003` / `PD1|ENTRY|01K0ABC20003` |

Expected Staging checks:

- active tenant: login, license/check, locations, scan-events, and mail-jobs send pass with mock/sandbox provider.
- suspended tenant: license/check returns `can_send=false`; scan-events is rejected with `SUBSCRIPTION_NOT_SENDABLE`.
- expired tenant: license/check returns `can_send=false`; scan-events is rejected with `SUBSCRIPTION_NOT_SENDABLE`.

Do not run this seed against Production or any database containing real customer data.

## 6. GUI 黑盒与 E2E 冒烟

Issue #57 的本地 GUI 黑盒测试记录：

- `docs/testing/gui-black-box-2026-06-30.md`

最小 Playwright E2E smoke：

```powershell
cd frontend
npm run test:e2e
```

覆盖范围：

- active tenant 登录进入扫码工作台
- location 与人员映射展示
- `PD1|ENTRY|01K0ABC19999` 可持久化并显示“未映射”和“进入”，且不伪造 mail job
- `PD1|ENTRY|01K0ABC10001` 创建 mail_job 并显示“进入”，自动触发 sandbox，按 CI matrix 验证“已发送”或“等待重试/发送失败”
- `PD1|EXIT|01K0ABC10001` 在冲突窗口外创建离开记录并使用“退室”正文
- 页面刷新后从 tenant-scoped API 恢复历史记录
- Tenant A token 不能用 Tenant B location 查询历史
- suspended tenant 登录后扫码输入和提交按钮禁用

进入 Staging 前，GUI 黑盒结论必须明确是否存在阻塞项；UI 细节优化问题应拆分为后续 Issue，不阻塞 Staging smoke。

## 7. 质量门禁建议

- 单元测试通过率 100%（新增/改动相关）
- 高风险模块必须包含至少 1 个失败场景测试
- 关键接口必须有契约测试或集成测试覆盖

GitHub Actions 对 PR 与 `main` push 执行前后端 lint、typecheck、unit/integration tests 和 build；关键 E2E 使用 PostgreSQL 16、合成 seed、mock provider 的 success/failure matrix，并在失败时上传 Playwright trace 与服务日志。
