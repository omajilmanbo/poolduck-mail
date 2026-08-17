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
- 登录身份：10 位 tenant_code 回填与大小写规范化、UUID tenant_id 拒绝、username/email 双模式、无邮箱 operator、tenant_manager email-only、统一
  `LOGIN_FAILED`、伪哈希路径、限流与旧 `email` 请求字段兼容
- platform 身份：独立邮箱/密码登录、单 active 账号、有限 Session、refresh 轮换/重放、即时撤销、
  tenant/platform token audience 双向拒绝；MVP 不宣称启用 TOTP
- platform 控制面：tenant 原子创建/幂等、一次性临时密码、subscription/额度乐观并发、
  tenant_manager/operator 禁止访问、platform_admin 禁止读取租户业务 API
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
- platform_admin 不受任一 tenant subscription 门禁，但 disabled/撤销/Session 到期仍拒绝
- `location_limit` 统计 active/inactive/pending deletion，purged 后释放；达到上限拒绝创建，
  降额低于当前用量拒绝
- 人工额度测试不得生成价格、付款、账单、proration 或自动扩容数据

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

- `tenant_code`: `10CA000001`（内部 tenant UUID 不作为登录输入）
- operator username：`local-operator`；可选邮箱：`operator@example.local`
- tenant_manager email：`tenant-manager@example.local`（tenant_manager 没有 username，只能使用邮箱登录）
- 以上账号密码：`PoolduckLocal123!`
- `location_id`: `10CA1001`（公开地点 ID；内部 UUID 仅用于数据库追溯）
- active `person_code`: `01K0ABC10001`；进入动作码：`V2E01K0ABC10001`；离开动作码：`V2X01K0ABC10001`
- not-mapped 拒绝动作码：`V2E01K0ABC19999`

### 4.2 API happy path 冒烟

1. 使用默认 sandbox success 启动后端：`npm run start:dev`
2. 另开终端执行：`npm run smoke:api`

脚本验证链路：

`health -> login -> license/check -> locations -> people -> not-mapped rejection -> mapped scan -> cancel -> rescan -> automatic sandbox result`

预期结果：

- not-mapped 动作码返回 `SCAN_CODE_NOT_MAPPED`，响应不含 `scan_event_id`，且不创建 scan event、case、mail job 或逐请求数据库审计
- mapped scan 在事务内创建 `waiting` mail_job，并以数据库时间设置 10 秒取消窗口
- 首个任务在窗口内取消后保持 `canceled` 且 provider attempt 为 0；使用新幂等键立即重扫，窗口到期后由 worker 原子领取
- sandbox success 将第二个 `mail_job` 更新为 `sent`；失败按 30 秒/2 分钟/10 分钟进入 `queued` 重试

### 4.3 API failure path 冒烟

1. 设置 `MAIL_MOCK_SEND_RESULT=failure` 后启动后端。
2. 执行 smoke，并声明首次自动发送失败后进入 queued 重试：
   - Windows PowerShell: `$env:API_SMOKE_EXPECT_SEND_STATUS='queued'; npm run smoke:api`
   - macOS/Linux: `API_SMOKE_EXPECT_SEND_STATUS=queued npm run smoke:api`

预期结果：

- mapped scan 仍先创建 `waiting` mail_job，首次 provider 调用只能发生在数据库截止时间之后
- sandbox failure 进入 `queued` 重试；三次重试耗尽后更新为 `failed` 并保留安全 `error_message` 和 attempt 证据

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
- 权限与隔离：使用其他 tenant 的 location，或在同 tenant 的其他 location 使用人员码，均不得解析人员或创建业务记录、处理工单或邮件任务。
- 历史一致性：扫码后修改 tenant/location/person 名称，确认邮件任务详情和导出仍显示发送时快照；只读列表、审计、错误和 CSV 不含完整邮箱、邮件正文或 UUID/人员码批量对应。
- 回归：人员管理接口仍返回兼容字段 `scan_code=person_code`，但扫码写接口只接受两张 `V2E` / `V2X` 动作码；新建人员不能编辑或移动 `person_code`，停用/恢复仍保留同一业务 ID。
- 动作码图片：在人员管理打开“查看动作码”，确认展示进入/离开 × 二维码/Code 128 共四张预览，单张 PNG 与 ZIP 文件名仅含 `person_code`、动作和格式；使用开源解码器往返还原 `V2E<person_code>` / `V2X<person_code>`。
- 图片安全与错误：断言图片、文件名和 ZIP 不含姓名、邮箱、tenant/location UUID 或内部人员 UUID；缺失、非法 `person_code` 及画布/ZIP 生成失败时显示错误并保持下载不可用，不使用 UUID 回退，也不发起外部图片请求。

人工步骤：

1. 备份本地合成数据库，执行 `npm.cmd run db:deploy` 与 `npm.cmd run local:seed`。
2. 在人员管理新增一名合成人员，记录系统生成的 `person_code`；确认页面没有可编辑扫描码输入。
3. 在正确 location 扫描 `V2E<person_code>`，确认邮件详情的 `context` 含发送时 tenant/location/person 名称和相同 `person_code`，且不返回完整邮箱或正文。
4. 修改人员或地点名称后重新读取旧邮件任务，确认 `context` 未变化。
5. 在另一个 location 或 tenant 扫描同一人员动作码，确认返回统一未映射/不存在结果且未创建 scan event、case 或 mail job。
6. 在一次性数据库运行 `backend/prisma/rollback/20260724000000_add_person_codes_and_mail_context.sql`，确认 `scan_code`、UUID、人员映射、扫码事件和邮件任务行仍保留；禁止在未备份或仍有写流量的数据库直接回滚。

### 4.6a Issue #92 地点 ID、统一类型与重新启用验证

- 创建：tenant_manager 仅提交地点名称，响应 `location_id=location_code` 且符合 8 位大写 Crockford Base32，`type=location`；客户端提交 ID/code/type 返回 `400`
- 碰撞与名称：同 tenant 名称按 trim 后大小写不敏感拒绝重名；不同 tenant 可使用同名。模拟 ID 唯一冲突最多重试 5 次，耗尽返回 `LOCATION_CODE_GENERATION_EXHAUSTED`
- 迁移：旧 code/type 保存到兼容表，所有旧地点转为 `type=location`；person、成功 scan、mail 与 assignment 的内部 `location_id` UUID 不改写，历史关联数量一致
- 权限与隔离：operator 不能创建、编辑、停用或启用地点；公开地点 ID、旧 ID 或 UUID 的兼容解析始终先限定 token tenant 与 operator assignment
- 启停：地点停用安全终止 queued 邮件，重新启用后恢复新扫描/人员写入；人员停用与重新启用保留同一 `person_code` 和历史。人员所属地点 inactive 时不得重新启用人员
- 商业边界：不配置价格、allowance、付款或 #102 数据，地点创建与重新启用仍成功

人工步骤：

1. 在合成数据库备份后执行 migration 和 seed，记录旧地点 UUID 与关联行数；验证新地点码、固定类型、兼容表和关联行数。
2. 用 tenant_manager 打开地点管理，只输入名称创建地点；确认页面没有地点代码输入和 office/school 选择。
3. 停用并重新启用地点，确认 ID 不变；在人员管理停用并重新启用人员，确认 `person_code` 和历史不变。
4. 用 operator 和其他 tenant 的地点码重复上述写操作，确认统一拒绝且无跨 tenant 数据变化。
5. 在一次性数据库运行 `backend/prisma/rollback/20260728000000_generate_location_codes.sql`，确认旧 code/type 恢复且 UUID 关系未改写。

### 4.7 Issue #95 进出动作一致性验证

- 正常：分别提交 `V2E<person_code>` 与 `V2X<person_code>`，确认响应、scan event、mail job、历史列表、CSV 与固定正文分别一致显示 `entry/进入/入室` 和 `exit/离开/退室`。
- 错误：裸 `person_code`、未知版本、未知动作、错误大小写和非法长度均返回 `ACTION_CODE_INVALID`，且不创建 scan event/mail job；格式正确但没有当前 active 映射的动作码返回 `SCAN_CODE_NOT_MAPPED`，也不创建任何业务记录。
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

### 4.7a Issue #117 扫码枪兼容负载 ADR 验证

ADR-015 已 `Accepted`：上线前以 `V2E<person_code>` / `V2X<person_code>` 一次性替换 `PD1|...`，不实施双读、旧资产迁移或 T0/T1/T2 阶段。以下矩阵是运行时同步切换的准入要求，不要求指定扫码枪厂牌/型号。

- 已知证据（2026-08-06）：业务负责人用网页二维码解析器读取现有动作二维码，结果完整包含 `|`。该结果验证二维码图像/逻辑文本层并把排障范围收窄到其后的 HID/Windows/浏览器输入链路；不得单独据此宣称 Code 128 键盘模拟已通过。
- 证据记录：只使用合成 `person_code=01K0ABC10001`；记录 USB HID/键盘模拟模式、扫码枪键盘国家/布局配置、Windows 当前键盘布局、输入法状态、前后缀/Enter 配置、QR/Code 128、屏显/打印，以及提交前逐字符原始值和 code point。厂牌/型号可作为排障附注，但不是通过条件。
- 正常：`V2E01K0ABC10001` / `V2X01K0ABC10001` 的 QR 与 Code 128 必须在代表性的 US QWERTY、Japanese 106、French AZERTY、German QWERTZ Windows 布局测试夹具中逐字符还原；只允许无后缀或单个 `CR`、`LF`、`CRLF`，并验证图片仍为进入/离开 × QR/Code 128 四张本地 PNG/ZIP。
- 错误：逐项提交旧新格式拼接、未知版本、未知动作、非法字符、错误大小写、缺失/额外字段、内部空白、前导/尾随空格、截断、设备前缀和重复 CR/LF；全部应稳定归为 `ACTION_CODE_INVALID`，不创建成功事件或 mail job。
- 权限与租户隔离：相同候选负载由 operator/tenant_manager 在未授权 location 或其他 tenant 提交时不得解析人员或泄露存在性；客户端不能另传 `action`、actor 或 tenant。
- 订阅与网络：`trial` / `active` 保持原路径；`expired` / `suspended` 阻止事件和 mail job；捕获页或网络失败不得把部分输入当作成功扫码重放。
- 边界：验证固定 15 位、大小写、快速连扫、10 秒边界和同 `Idempotency-Key` 的同/不同语义输入；`PD1`、旧新拼接和其他版本必须统一拒绝，不能存在双读分支。
- 回归：相同动作去重、相反动作冲突、mail retry 不重推动作、成功历史/CSV/邮件正文一致、not-mapped 无持久化、四 PNG/ZIP 本地生成及不含 PII/UUID/认证信息均保持不变。

人工步骤：

1. 在不连接业务 API 的本地纯文本捕获页关闭输入法联想，记录 `V2E01K0ABC10001` 与 `V2X01K0ABC10001` 的 QR/Code 128 屏显和打印输入。
2. 使用独立软件解码器读取同一图片，比较逻辑负载、独立解码值与 HID 原始输入；按 ADR-015 把差异定位到图片编码、HID 字符→按键转换、Windows 布局映射或应用输入层。
3. 覆盖代表性 Windows 键盘布局、匹配/不匹配的扫码枪键盘布局、无后缀与 Enter 后缀配置；重点证明仅大写字母数字的固定长度格式不依赖标点按键。
4. 将精确原始值、code point 和通用输入配置回填 ADR-015；不得附姓名、邮箱、真实 tenant/location 标识或生产扫码日志，也不得把单个型号列为兼容白名单。
5. 在导入业务数据或正式发放资产前，确认解析器、API、四资产、seed、smoke、测试和文档已整体切换，且仓库不存在运行时 `PD1` 兼容分支。

### 4.7b Issue #122 未映射工单 ADR 验证矩阵

ADR-018 已 `Accepted`：服务未上线且没有业务数据，直接删除未映射 event/case/API/UI，不设置历史或兼容期。

- 正常：当前 tenant/location 的 active 人员 `V2E/V2X` 创建动作一致的 scan event 与唯一 mail job，不进入未映射路径。
- 错误：覆盖 inactive、pending deletion、purged、随机合法码、`PD1`、裸码、未知版本/动作、非法长度/字符和关系异常；所有 not-mapped 拒绝均不含 `scan_event_id`，且不得创建 scan event、case、mail job 或逐请求数据库审计。
- 权限：tenant_manager/operator 继续按当前角色和 location assignment fail closed；未分配 operator 不得读取历史或从错误差异判断人员状态。
- 租户隔离：同码跨 location/tenant 不执行跨 scope 存在性查询，不泄露人员是否存在，也不把记录展示给无权用户。
- 边界：快速随机输入、重复同码、日志保留边界和未来告警合并；指标和日志不得含完整动作码、PII 或 UUID 映射。具体速率阈值在上线前安全/运维 Issue 中人工批准。
- 订阅：`trial` / `active` 与 `expired` / `suspended` 保持 ADR-003；门禁拒绝不创建 event/case/mail job。
- 回归：扫码历史、CSV、动作、`Idempotency-Key`、10 秒去重、人员启停/删除/恢复、审计和 mail retry 不串数据。
- migration：前向脚本删除 case 表和全部开发/合成 unmapped event；schema validation 与 deploy 通过。guarded rollback 只重建空表，不恢复事件、不补造拒绝、不重放邮件。
- 人工：确认工作台没有“未映射扫码”入口，`/unmapped` 不再提供页面，not-mapped 拒绝不会出现在扫码历史；inactive 重新启用和 pending deletion 恢复仍从人员管理执行。

上线前安全/运维 Issue 必须补充网络失败、限流存储不可用、指标出口不可用和完整性检查失败的降级测试；可观测性失败不得放宽授权或允许发信。

### 4.7c Issues #124/#125/#127/#128/#129 / ADR-017 扫码发送取消验证矩阵

ADR-017 已 `Accepted`，schema/API/worker/Frontend 已在本地实现。本节既是自动化回归矩阵，也是进入
任何部署审批前必须复核的准入清单；本地通过不代表 Staging/Production 已部署。

2026-08-06 本地实现证据见 `docs/testing/local-adr-017-2026-08-06.md`。

- 正常：T0 原子创建 `waiting`，截止前取消且 provider attempt 为 0；未取消任务到期自动发送；重复
  取消返回首次结果；刷新/重登恢复权威状态；取消后以新 key 立即重扫。
- 错误：未知 ID、过期、`processing`/`sent`/`failed`/`delivery_unknown`、provider 异常、取消 API
  网络中断、stale claim 与数据库短暂不可用均返回安全结果，不伪造已取消或已撤回。
- 权限：同 location 当前授权 operator（含非原扫码人）与 tenant_manager 可取消；assignment、session
  或账号撤销后拒绝；inactive/pending-deletion 资源仍允许具授权者在截止前取消。
- 租户隔离：跨 tenant/location 伪造 event/job ID 或 key 统一 not-found，不改变目标任务且不泄露
  状态、截止、人员或邮箱。
- 边界：使用 PostgreSQL 可控时间覆盖截止前 1ms、恰好截止（发送领取优先）、截止后 1ms，取消/
  worker/new scan 三方并发，多 worker、进程重启、客户端时钟偏差/休眠，以及 p95 2 秒/p99 5 秒 SLO。
- 订阅：`trial`/`active` 正常；等待期间转为 `expired`/`suspended` 时取消仍可用而发送 fail-closed，
  幂等重放和 retry 不能绕过。
- 回归：Issue #68 去重/相反动作冲突、原 key 重放、retry 30 秒/2 分钟/10 分钟、动作/正文快照、
  历史/CSV、派生状态、not-mapped 拒绝、location access 与敏感日志过滤保持一致。
- 人工：只用合成人员与 `.example.local` 地址，在浏览器观察 10 秒按钮、取消/到期竞态、刷新/重登、
  网络断开恢复和小窗口；从 sandbox attempt 记录证明成功取消任务从未调用 provider。

### 4.8 Issue #96 operator-location 授权验证

- 正常与边界：tenant_manager 为 operator 设置单个、多个或空 assignment；重复 location ID 返回 `400`，空数组撤销全部。新旧 operator 没有 assignment 时 location 列表为空。
- 权限：operator 不能调用 assignment API；tenant_manager 仍可访问本 tenant 全部 location，不受 assignment 限制。
- 隔离与错误：跨 tenant operator/location、伪造 ID 和未分配 location 均使用统一 not-found 响应；inactive location 不能新增 assignment，新扫码和人员映射继续被地点状态门禁阻止。
- 跨模块回归：locations、people、scan events、scan/mail history 与 mail send 均复用服务端 assignment 过滤；不带 location 参数的列表也不能返回其他地点。
- 撤销：撤销后不等待 JWT 过期或页面重登，新的扫码、映射写入和历史查询立即被拒绝；已有 queued 系统重试仍按独立邮件任务规则处理。
- 订阅与网络：已授权的 `trial` / `active` 保持原行为，`expired` / `suspended` 仍由订阅门禁拒绝扫码；assignment API 网络失败不得在客户端假定保存成功或扩大权限。
- 迁移与回滚：migration 不包含 assignment backfill，确保不会误授权同 tenant 或其他 tenant；回滚先回应用再删表，并明确旧应用会恢复宽权限。

人工步骤：

1. 在合成数据库执行 migration 和 seed；确认 seed 仅为明确列出的合成 operator/location 创建 assignment。
2. 用 tenant_manager 创建一个新 operator，确认其 `GET /api/locations` 返回空数组。
3. 通过 `PUT /api/users/{operator_id}/location-assignments` 分配一个地点，确认 operator 只能访问该地点的 locations、people、scan、history 与 mail history。
4. 再分配第二个地点，确认两地点均可访问；提交其他 tenant、inactive 和伪造 location ID，确认整次替换失败且原 assignment 不变。
5. 撤销第一个地点，立即复用现有 operator token 和旧 `Idempotency-Key` 请求该地点，确认返回 not-found 且不创建新 scan event/mail job。
6. 用 tenant_manager 验证同一地点仍可正常读取，查询审计日志确认 set/revoke/denied 事件存在且不含姓名、邮箱、密码、token 或邮件正文。
7. 在一次性数据库按文档顺序验证 `backend/prisma/rollback/20260724020000_add_operator_location_assignments.sql`，禁止在未备份、仍有写流量或未批准恢复旧宽权限时执行。

### 4.9 Issue #97 operator-location 权限 UI 验证

- 正常：用户列表显示每个 operator 的单个、多个或“未分配地点”状态；tenant_manager 可在“配置地点”弹窗勾选多个 active location，并通过一次 `PUT` 原子保存。
- 小窗口：地点选择区在内容超高时独立滚动；在较小视口打开地点权限弹窗时，取消和保存按钮保持可见。动作码预览弹窗同样限制为当前视口高度，内容在弹窗内部滚动。
- 撤销与边界：取消任一已分配地点时必须显示立即失效的影响确认；取消确认不发送请求，确认后列表立即更新。空选择表示撤销全部。
- 停用地点：列表明确标识已有 inactive assignment；弹窗展示停用状态但不提供勾选入口，保存时只能提交 active location。
- 权限与隔离：operator 不显示用户管理入口，直接访问页面会返回工作台，且不能调用 assignment API；跨 tenant、伪造和不存在地点仍由服务端统一拒绝。
- 错误与网络：加载或保存失败显示安全提示，不把未成功的选择写入当前权限列表，也不缓存邮箱、密码、内部 UUID 或跨会话 assignment 数据。
- 回归：保存后使用目标 operator 登录，地点选择器只显示服务端返回的 assignments；撤销后重新请求工作台、人员与历史均不能看到该地点。`trial` / `active` / `expired` / `suspended` 继续沿用现有订阅门禁，不由前端权限 UI 扩大。

人工步骤：

1. tenant_manager 打开“用户管理”，确认每个 operator 的“地点权限”列与 assignment API 一致。
2. 为无权限 operator 同时勾选两个 active location 并保存，确认列表立即显示两个地点。
3. 使用该 operator 登录，确认地点选择器只显示这两个地点；用户管理入口不可见，直接访问 `/users` 会返回工作台。
4. tenant_manager 取消其中一个地点，确认弹出立即失效提示；先取消保存验证权限不变，再确认保存。
5. 复用 operator 会话刷新工作台，确认被撤销地点立即消失且相关 API 返回 not-found；保留地点仍可正常使用。
6. 停用一个地点后重新打开配置弹窗，确认其被标记为停用且不可新增勾选；模拟网络失败时确认列表不出现未保存变更。

### 4.10 Issue #104 延迟删除与恢复

- 人员与地点：active/inactive 均可安排删除，响应包含数据库时间生成的 `deleted_at` 与 14 天后的
  `purge_after`；恢复必须还原删除前状态。
- 界面：管理列表显示向上取整的剩余天数，恢复入口紧邻删除状态；小窗口下按钮仍可见。
- 权限：地点删除/恢复仅 tenant_manager；人员删除/恢复沿用 operator-location assignment。
- 业务门禁：待删除地点/人员不能扫码、写映射、新增 assignment 或发送 queued 邮件；历史仍可按授权读取。
- 到期与并发：期限边界拒绝恢复；恢复与清理并发时只能有一方原子成功；重复清理不重复匿名化或审计。
- 保留：终结清理匿名化当前地点名、人员姓名和邮箱并撤销 assignments，不删除成功 scan event、mail job
  或 audit log，公开 location/person code 不得复用。

### 4.11 ADR-013 / Issues #110–#113 平台控制面验证

- 正常：受控 bootstrap 创建唯一 active platform_admin；独立登录/refresh/logout；原子创建
  trial/active tenant、tenant_code、subscription、首个 tenant_manager 和 location_limit；
  提额、暂停和恢复成功。
- 错误：错误平台邮箱/密码统一失败；重复 bootstrap、Idempotency-Key 冲突、非法订阅时间、
  过期 version、创建部分失败、低于当前用量降额和网络中断均不产生部分数据或伪成功。
- 权限：tenant_manager/operator 不能访问 `/platform` 或 `/api/platform/*`；platform token
  不能访问 location、people、scan、mail、tenant audit 等业务 API。
- 租户隔离：平台列表只返回 tenant/subscription/额度/脱敏 manager 摘要；同一 manager 邮箱可存在
  于不同 tenant，但任何平台修改都显式限定目标 tenant，不串用 version 或 Idempotency-Key。
- 边界：MVP 同时最多一个 active platform_admin；额度 1、恰好达到上限、并发创建、active、
  inactive、pending deletion、purged 计数和 `end_at` 边界。
- 订阅：`trial` / `active` 允许现有发送链路，`expired` / `suspended` 阻断；任一 tenant 状态不影响
  platform_admin 登录，平台账号 disabled/撤销/Session 到期仍立即拒绝。
- 回归：tenant_manager/operator 的登录、Session、location、人员、扫码、邮件、历史、
  operator assignment 与延迟删除保持原权限和行为。
- 网络：refresh 重试不产生两个可用 token；tenant 创建使用相同 Idempotency-Key 可安全重放；
  UI 在登录、创建或修改失败时不缓存伪 Session/伪 tenant 状态。
- 安全：日志、审计、测试 artifact 不含平台密码、临时密码、token、完整 manager 邮箱、邮件正文或
  业务 PII；MVP 不存在未校验的 `mfa_enabled`。

人工步骤：

1. 在合成数据库执行 migration/backfill，核对既有 tenant 的 location_limit 为
   `max(1, 未终结清理 location 数量)`，且没有 location、subscription 或用户被删除。
2. 使用 `.example.local` 标识和运行时注入密码执行 platform bootstrap 两次，确认第二次拒绝覆盖；
   登录后确认 tenant/platform Cookie 与 token audience 双向隔离。
3. 创建一个 trial tenant，确认临时密码只展示一次；使用首个 tenant_manager 登录并完成强制改密。
4. 创建地点直到额度上限，确认下一次返回 `LOCATION_LIMIT_REACHED`；停用/安排删除不释放名额，
   终结清理后才释放。
5. 尝试把额度降到当前计数以下，确认返回 `LOCATION_LIMIT_BELOW_CURRENT_USAGE` 且既有地点不变；
   提额后确认可继续创建。
6. 暂停和恢复 tenant，验证租户发送门禁变化但 platform Session 不受影响；再禁用 platform_admin，
   确认全部既有平台 Session 立即失效。
7. 运行 seed 两次、API smoke、Frontend E2E 和 guarded rollback；检查日志、审计与 artifact 脱敏。

2026-07-29 Local 验证记录（未执行 Staging/Production）：

- `db:deploy` 成功应用 `20260729000000_add_platform_control_plane`；普通 `local:seed` 与显式
  opt-in 的 `platform:seed` 均连续执行两次成功。
- 只读数据库核对：active platform_admin 为 1；trial/active/expired/suspended 均有合成 fixture；
  active/inactive/pending deletion 计入额度、purged 不计入；所有 tenant 均满足当前计数
  `<= location_limit`。同时修复 seed，确保重复执行不会把额度降到既有用量以下。
- CLI：重复 bootstrap 正确拒绝覆盖；rotate、disable、recover 均成功并撤销既有 Session；
  recover 后平台 smoke 再次通过。
- Backend：`typecheck`、`lint` 通过；25 suites / 152 tests 通过。Prisma schema 测试确认安全
  backfill、单 active partial unique index、tenantless 模型与 guarded rollback 不删除既有业务数据。
- Frontend：`typecheck`、`lint`、production build 通过；6 files / 42 tests 通过。
- 运行中本地容器：PostgreSQL、Backend、Frontend 均 healthy；既有 `smoke:api` 通过；
  新 `smoke:platform` 通过；`platform-control-plane.spec.ts` 在 390×720 viewport 下 1/1 通过。
- Staging bootstrap、Secret 注入、migration、smoke 与部署未执行；仍须按人工批准的目标和
  `docs/staging-manual.md` Runbook 单独进行。

## 5. Staging seed data

Staging verification uses `npm run staging:seed` from `backend/`, or the container equivalent:

```powershell
docker compose -f docker-compose.yml -f docker-compose.staging.yml exec -T backend npm run staging:seed
```

The command is idempotent and writes only synthetic `.example.local` data. It prepares these fixed accounts:

每个表中列出的 staging operator 都只被显式分配到同一行的合成 Location ID；seed 不会为任何其他 operator 自动授权全部地点。

登录页使用 `tenant_code + identifier + password`。`tenant_manager` 没有 username，`identifier`
必须填写邮箱；operator 优先使用 username，也可以使用同一行的可选邮箱。所有 Staging 合成账号的密码均为
`PoolduckStaging123!`。

| Subscription | tenant_code | tenant_manager identifier（email） | operator identifier（username） | operator 可选 email |
|---|---|---|---|---|
| active | `5A6E000001` | `staging-active-tenant-manager@example.local` | `staging-active-operator` | `staging-active-operator@example.local` |
| suspended | `5A6E000002` | `staging-suspended-tenant-manager@example.local` | `staging-suspended-operator` | `staging-suspended-operator@example.local` |
| expired | `5A6E000003` | `staging-expired-tenant-manager@example.local` | `staging-expired-operator` | `staging-expired-operator@example.local` |

| Subscription | Location code | Person code | ENTRY action code |
|---|---|---|---|
| active | `5A6E0001` | `01K0ABC20001` | `V2E01K0ABC20001` |
| suspended | `5A6E0002` | `01K0ABC20002` | `V2E01K0ABC20002` |
| expired | `5A6E0003` | `01K0ABC20003` | `V2E01K0ABC20003` |

Expected Staging checks:

- active tenant: tenant_manager 邮箱登录和 operator username/email 登录均成功；license/check、locations、
  scan-events 和 mail-jobs send 使用 mock/sandbox provider 验证通过。
- 权限：active tenant_manager 可进入用户和地点管理；operator 不显示管理入口，直接调用管理 API 返回
  `ROLE_FORBIDDEN`。
- suspended tenant: 两种角色均可登录，license/check 返回 `can_send=false`；scan-events 返回
  `SUBSCRIPTION_NOT_SENDABLE`。
- expired tenant: 两种角色均可登录，license/check 返回 `can_send=false`；scan-events 返回
  `SUBSCRIPTION_NOT_SENDABLE`。
- 身份错误：tenant_manager 使用非邮箱 identifier，或把任一账号与其他行的 `tenant_code` 组合时，
  返回统一 `LOGIN_FAILED`，不得泄露账号、角色或 tenant 是否存在。
- 回归与网络：operator 的含 `@` identifier 只按邮箱查询、不回退 username；登录请求网络失败时，
  页面显示安全错误且不创建本地伪会话。

人工登录验证：

1. 打开 Staging HTTPS 登录页，先用 active tenant_manager 邮箱登录，确认进入工作台并可访问用户和地点管理。
2. 退出后使用 active operator username 登录，确认进入工作台但没有用户/地点管理权限。
3. 分别使用 suspended、expired 的 tenant_manager 和 operator 登录，确认允许查看订阅状态但不能提交扫码。
4. 将 active tenant_manager 邮箱与 suspended `tenant_code` 组合，确认只显示通用登录失败。

Do not run this seed against Production or any database containing real customer data.

ADR-013 的 platform_admin 合成 bootstrap/seed 已由 #113 实现；加入 Staging 流程前仍必须显式
opt-in、运行时注入凭据并检测/拒绝 Production。当前表中的 tenant seed 不代表已创建平台账号。

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
- `V2E01K0ABC19999` 返回 `SCAN_CODE_NOT_MAPPED`，不持久化、不显示历史且不创建 mail job
- `V2E01K0ABC10001` 创建 mail_job 并显示“进入”，自动触发 sandbox，按 CI matrix 验证“已发送”或“等待重试/发送失败”
- `V2X01K0ABC10001` 在冲突窗口外创建离开记录并使用“退室”正文
- 页面刷新后从 tenant-scoped API 恢复历史记录
- 当前 location 的扫码记录首列显示人员名称，不重复显示地点；缺少人员名称的历史记录安全显示 `-`
- Tenant A token 不能用 Tenant B location 查询历史
- suspended tenant 登录后扫码输入和提交按钮禁用

进入 Staging 前，GUI 黑盒结论必须明确是否存在阻塞项；UI 细节优化问题应拆分为后续 Issue，不阻塞 Staging smoke。

## 7. 质量门禁建议

- 单元测试通过率 100%（新增/改动相关）
- 高风险模块必须包含至少 1 个失败场景测试
- 关键接口必须有契约测试或集成测试覆盖

GitHub Actions 对 PR 与 `main` push 执行前后端 lint、typecheck、unit/integration tests 和 build；关键 E2E 使用 PostgreSQL 16、合成 seed、mock provider 的 success/failure matrix，并在失败时上传 Playwright trace 与服务日志。
