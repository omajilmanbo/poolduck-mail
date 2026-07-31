# ADR-013：platform_admin 平台控制面与人工租户开通

- 状态：Accepted
- 日期：2026-07-29
- 相关 Issue：#82, #100, #102, #109

## Context

ADR-006 已接受不绑定 tenant 的 `platform_admin`，并明确它负责创建、暂停、恢复 tenant
以及查看和修改订阅；同一 ADR 也明确平台身份存储、认证、初始化、撤销、平台 API 和后台 UI
必须由后续 Issue 决定。当前运行时只有绑定 tenant 的 `tenant_manager` 与 `operator`，
不能安全地把其中任何一个角色提升为跨租户管理员。

Issue #100 规划未来的客户自助注册、真实邮箱验证与首个 `tenant_manager` 创建，但明确排除
platform_admin 控制台。Issue #102 保留未来商业计费讨论；当前尚不实现价格、付款、账单、
发票、退款或自动扩容。

在自助注册、自助付费和自动扩容上线前，平台仍需要受控入口完成以下运营操作：

- 人工创建 tenant，并原子创建其首个 `tenant_manager`；
- 设置 tenant 的 subscription 状态和有效期；
- 设置和调整 tenant 可使用的 location 数量；
- 暂停或恢复 tenant；
- 在不读取租户业务明细的前提下查看上述平台级状态和审计记录。

ADR-009 原决定 MVP 不引入商业 allowance，且 location 创建不依赖套餐额度。Issue #109
的人工评论进一步确认：即使租户暂不能自助调整，MVP 阶段仍有必要由 platform_admin
限制和调整订阅额度。本 ADR 因此必须区分“人工运营额度”与“商业计费”，并明确对
ADR-009 的局部 supersede 范围。

`platform_admin` 不属于任何 tenant，不受任一 tenant 的 `trial` / `active` / `expired` /
`suspended` 状态或 `end_at` 门禁影响。“不受租户订阅失效影响”不能解释为账号或 Session
永不过期、不可禁用或不可撤销；最高权限身份仍需要更严格的凭据、Session 和恢复控制。

## Decision

本节已于 2026-07-29 获得人工批准，后续实现必须遵守以下规则。

### 1. 独立平台身份

- 新建独立的 `platform_admins` 身份存储；记录不包含 `tenant_id`，也不复用 `users` 表的
  nullable tenant 变体。
- MVP 只允许一个 active platform_admin。增加、替换、禁用或恢复该账号只能通过受控的
  运维 CLI/Runbook 完成，不能通过 tenant 注册、tenant_manager 页面或普通平台 UI 创建。
- platform_admin 使用独立的邮箱标识和由受控 bootstrap 流程生成的高熵密码。邮箱按
  trim + ASCII lowercase 规范化；密码继续使用 Argon2 哈希，不允许提交默认凭据。
- TOTP MFA 不作为本 ADR 的 MVP 实现门禁。当前认证栈没有 OTP 绑定、secret 加密、恢复码、
  重放防护或丢失设备恢复能力；安全完成这些能力需要独立 ADR/Issue。MVP 必须保留可扩展的独立
  platform auth 边界，但不得创建未实际校验的 `mfa_enabled` 标记或宣称已启用 MFA。
- 首个账号只能由部署环境中的一次性 bootstrap 命令创建。命令必须显式输入合成或人工批准的
  标识、从安全输入读取凭据、拒绝覆盖现有 active 账号，并产生不含原始凭据的审计记录。
- 不提供公开的 platform_admin 注册、邀请、忘记密码或邮件恢复入口。MVP 恢复使用受控
  运维 Runbook，执行前备份并撤销全部既有 Session。

### 2. 独立认证、Session 与 UI

- 平台登录页使用独立路由 `/platform/login`，平台控制台使用 `/platform`；租户登录页继续使用
  `tenant_code + identifier + password`，两者不得自动回退或互相发现账号。
- 平台 API 使用 `/api/platform/*` namespace、独立 guard 和独立 token audience。平台 token
  调用租户业务 API，或租户 token 调用平台 API，均默认拒绝。
- platform_admin 不执行 subscription gate，但账号必须为 active，且 Session 必须有有限 TTL、
  可主动撤销，并在密码、账号状态或身份版本变化后立即失效。
- 平台 Session 的 access/refresh TTL 不得长于租户 Session；refresh token 轮换、重放检测、
  登录限流、失败统一响应和 CSRF/CORS 保护沿用不低于租户认证的安全基线。
- 平台 UI 使用独立 layout、导航与状态模型，不显示扫码、人员、邮件、location 业务管理或
  tenant_manager/operator 工作台入口。

### 3. platform_admin 可见范围

平台控制台只返回完成平台运营所需的最小 tenant 摘要：

- tenant name、`tenant_code`、tenant 状态和创建时间；
- subscription plan 标识、`status`、`start_at`、`end_at`；
- `location_limit`、当前计入额度的 location 数量；
- 首个 tenant_manager 的脱敏邮箱和账号状态；
- 最近平台操作的时间、结果和内部审计 ID。

platform_admin 默认不得读取或导出人员、扫码历史、邮件任务、邮件正文、收件邮箱、租户审计
明细或其他业务数据；不得 impersonate tenant_manager/operator。未来支持访问必须使用新的 ADR，
并建立显式、限时、可审计的授权机制。

### 4. 人工创建 tenant

- `POST /api/platform/tenants` 作为原子写操作，同时创建 tenant、系统生成的 `tenant_code`、
  subscription、首个且唯一的 `tenant_manager` 以及 location 额度。
- 请求必须包含：tenant name、首个 tenant_manager 邮箱、初始 subscription 状态、
  `start_at`、`end_at` 和正整数 `location_limit`。不得由客户端指定内部 UUID 或
  `tenant_code`。
- 新 tenant 的初始 subscription 只允许 `trial` 或 `active`；`end_at` 必须晚于 `start_at`。
  若需要创建后立即禁止业务使用，应先原子创建，再通过单独且经确认的暂停操作进入
  `suspended`，不能用部分初始化的 tenant 表达失败。
- tenant_manager 邮箱遵循 ADR-010；服务端生成一次性临时密码，只在成功响应中显示一次，
  数据库只保存哈希，并要求首次登录修改密码。不得通过日志、审计或 Issue 传递临时密码。
- 请求要求 `Idempotency-Key`。相同 key 和相同规范请求返回原结果；相同 key 对应不同请求时
  返回冲突。tenant、subscription、tenant_manager 或额度任一创建失败时整笔事务回滚。
- 同一规范 tenant_manager 邮箱在不同 tenant 仍可复用，符合 ADR-010；平台 UI 必须明确展示
  目标 tenant，不能仅凭邮箱定位或修改租户。

### 5. subscription 人工管理

- platform_admin 可修改 `trial` / `active` / `expired` / `suspended`、`start_at` 和 `end_at`；
  所有写操作必须要求确认、使用乐观并发版本，并记录旧状态、新状态、目标内部 tenant ID、
  actor platform_admin ID、请求 ID 和结果。
- `trial` / `active` 必须有有效时间区间；到达 `end_at` 后由现有门禁视为不可发送。
  `expired` 表示有效期已结束；`suspended` 表示人工暂停，并保留原时间区间供恢复判断。
- 暂停、过期和恢复后的扫码/邮件行为继续遵守 ADR-003；修改 subscription 不删除历史业务数据，
  也不取消 tenant scope。
- `tenant_manager` 只能读取自身 tenant 的基础 subscription 状态；`operator` 不获得订阅管理权限。

### 6. 人工 location 额度

- 在 tenant 平台配置中新增正整数 `location_limit`。MVP 不设置平台默认值；创建 tenant 时
  platform_admin 必须显式填写。
- 额度按尚未终结清理的 location 数量计算，包括 active、inactive 和 pending deletion。
  只有 ADR-011 的终结清理完成后才释放名额，防止通过停用或安排删除绕过额度。
- 创建 location 时，如果当前计数大于或等于 `location_limit`，返回稳定错误
  `LOCATION_LIMIT_REACHED`，且不创建任何数据。
- inactive location 已经计入额度，因此重新启用本身不新增占用；pending deletion location
  恢复也不新增占用。二者仍继续执行既有状态、订阅和权限门禁。
- platform_admin 可以提高额度。降低额度时，新值不得小于当前计数；否则返回
  `LOCATION_LIMIT_BELOW_CURRENT_USAGE`，不修改原额度。平台不能通过降额隐式停用、删除或阻断
  既有 location。
- 创建 location 与调整额度必须使用数据库事务和并发安全条件；并发创建不能让计数超过额度，
  并发调整不能覆盖较新的版本。
- location 额度只表示人工授权容量，不包含价格、币种、付款、账单、折扣、proration、
  自动续订或退款，也不能生成应收记录。

本节在 ADR Accepted 后 supersede ADR-009 中“MVP 不引入 allowance”以及“location 创建不依赖
套餐 allowance”的部分决定，仅限 platform_admin 人工维护的 `location_limit`。ADR-009
延后商业价格、付款、账单、发票、proration 和自动扩容的其余决定继续有效；Issue #102
仍保持 P3/Future。

### 7. tenant 生命周期

- platform_admin 可以创建、暂停和恢复 tenant；MVP 不提供物理删除 tenant。
- 暂停 tenant 使用 subscription `suspended` 表达，不新增含义重叠的 tenant 停用状态。
  恢复时必须显式选择 `trial` 或 `active` 并提供有效时间区间。
- 平台操作不得修改人员、location 状态、扫码历史或邮件记录；租户恢复后这些数据继续按自身状态
  和权限规则工作。
- 所有破坏性或高影响操作必须显示目标 tenant name + `tenant_code`、影响摘要和二次确认，
  网络失败时 UI 不得假定成功。

### 8. 后续实现测试门禁

后续实现必须覆盖：

- 正常：平台登录、原子创建 tenant/首个 tenant_manager、设置 subscription/额度、暂停和恢复；
- 错误：重复/非法输入、部分失败回滚、错误密码、禁用账号、token audience 错误和网络失败；
- 权限：tenant_manager/operator 不能访问平台路由/API，platform_admin 不能访问租户业务 API；
- 租户隔离：所有平台写入显式限定目标 tenant，列表不返回租户业务明细；
- 边界：额度 1、达到额度、并发创建、低于当前用量的降额、inactive/pending deletion 计数；
- 订阅：`trial` / `active` / `expired` / `suspended` 及 `end_at` 边界；
- 回归：既有租户登录、location、人员、扫码、邮件、历史和 operator assignment 不扩大权限；
- 人工：使用合成 `.example.local` 数据验证独立 UI、确认、审计、Session 撤销和恢复 Runbook。

## Alternatives considered

1. 继续复用 `users`，允许 `tenant_id` 为 null
   - 未选择。大量租户查询和约束需要理解 nullable tenant，容易把平台身份误送入租户 guard，
     也会削弱 ADR-006 的独立控制面边界。
2. 把 platform_admin 放入一个“平台 tenant”
   - 未选择。ADR-006 已否决；这会用普通租户伪装平台控制面，并允许 subscription 或 tenant
     状态意外阻断最高权限身份。
3. 只使用数据库脚本或 SSH，不建设平台 UI/API
   - 未选择。人工操作难以提供一致校验、幂等、确认、最小可见范围和审计，也不适合常规租户开通。
4. 继续完全不设 location 额度
   - 未选择。Issue #109 的人工决定要求 MVP 在自助付费前由平台限制和调整租户容量。
5. 只统计 active location
   - 未选择。租户可通过停用、创建、再启用绕过额度，pending deletion 也会形成同类旁路。
6. 允许把额度降低到当前用量以下并冻结既有地点
   - 未选择。它会让已有业务资源突然失效，且无法确定应冻结哪些地点。必须先由租户清理并终结
     足够地点，再降低额度。
7. 使用永不过期、不可撤销的 platform_admin token
   - 未选择。最高权限凭据泄露后的影响不可接受；不受 tenant subscription 门禁不等于身份无限期有效。
8. 在本阶段实现价格、付款和自动扩容
   - 未选择。继续遵守 ADR-009 和 #102 的商业化延后边界。
9. 把 TOTP MFA 作为 platform_admin MVP 的强制前置
   - 本阶段暂不选择。当前代码没有 OTP 库、secret 加密、绑定/轮换、恢复码、同时间窗重放防护或
     丢失设备恢复流程；只验证 6 位验证码会形成不可恢复或可重放的伪安全实现。TOTP 必须由后续
     独立安全 ADR/Issue 完整实现，不能以本 ADR 的简化子任务替代。

## Consequences

正面影响：

- 平台最高权限与租户身份在存储、路由、token 和 UI 上清晰隔离；
- 在没有自助注册/付费的阶段，租户开通、订阅与容量调整有可审计入口；
- location 额度不能通过停用或待删除状态绕过，也不会因降额随机冻结既有资源；
- 商业计费继续延后，运营容量不会静默演变为价格或账单模型；
- platform_admin 不受任一租户 subscription 故障影响，同时保留账号和 Session 撤销能力。

负面影响：

- 需要新增平台身份、平台 Session、平台审计和 tenant 额度数据；
- tenant 创建、location 创建与恢复路径需要新的事务和并发检查；
- 独立 UI/API 会增加部署、监控、E2E 和运维 Runbook 成本；
- MVP 只允许一个 active platform_admin，日常可用性依赖受控恢复流程；
- 首次登录改密与一次性密码交付需要额外的认证状态和界面。

## Migration impact

- 新增独立 platform admin、平台 Session/恢复、平台审计所需表；不把现有 tenant 用户迁移为
  platform_admin。
- 为 tenant 增加 `location_limit` 与乐观并发版本。既有 tenant 回填为
  `max(1, 当前未终结清理 location 数量)`，避免迁移立即产生超额或删除既有数据；迁移后由
  platform_admin 人工调整。
- 为首次 tenant_manager 登录增加一次性密码/强制改密状态；既有 tenant_manager 不自动进入
  强制改密。
- 迁移前必须备份并预检 tenant/location 计数、subscription 异常和 platform identity 冲突。
- 应用采用 expand → backfill → enable guards → enable platform UI 的顺序。未完成 backfill 或
  bootstrap 时，租户业务继续运行，但平台路由保持关闭。
- 回滚先关闭平台 UI/API 与额度写门禁，再回滚应用。数据库回滚不得删除已创建 tenant、
  tenant_manager、平台审计或额度变更记录；存在平台创建数据时只允许保留字段或导出归档后
  执行受控回滚。

## Security impact

- platform_admin 是最高风险身份，必须使用独立存储、独立 token audience、高熵密码、短且有限的
  Session、refresh 轮换/重放检测、限流、撤销和异常登录告警。
- MVP 暂无 MFA 是明确接受的残余风险。补偿控制包括：单 active 账号、CLI bootstrap/恢复、
  不提交默认密码、登录限流、有限 Session、即时全量撤销、独立 token audience、平台操作审计和
  异常告警。Production 或扩大平台控制台访问范围前必须单独评审是否先完成 TOTP。
- 平台列表和审计只暴露完成运营所需的最小字段；tenant_manager 邮箱默认脱敏，禁止记录密码、
  token、完整邮箱或租户业务 PII。
- 平台 API 每次写入都显式接收并校验目标 tenant，使用内部 UUID 执行；公开 `tenant_code`
  只用于显示和定位，不能替代授权。
- platform token 与 tenant token 必须双向拒绝错误 audience；不得依赖 `tenant_id = null`
  推断平台权限。
- bootstrap、恢复、禁用和替换账号必须由受控 Runbook 执行并产生审计/告警；不得提交默认
  platform_admin 密码或 Production seed。
- subscription 或额度调整不得绕过 ADR-003、ADR-006、ADR-011 的租户隔离、发送门禁和删除保留。

## Operational impact

- 部署需要新增 platform identity/Session secrets；Secret 必须通过既有受控部署流程注入，
  不进入 Git、Issue、日志或镜像。
- 首次启用平台控制面必须执行备份、migration、额度 backfill、单账号 bootstrap 和合成 smoke，
  并验证 platform/tenant token 双向拒绝。
- 监控至少覆盖平台登录失败、Session 重放、账号禁用、tenant 创建失败/回滚、
  subscription 变更、额度拒绝/调整、并发冲突和异常平台数据访问。
- 每个高影响平台操作必须携带 request ID，并记录可追溯但不含 PII 的审计事件；告警不得包含
  完整身份标识。
- Runbook 必须覆盖 platform_admin 初始化、轮换、禁用、恢复、Session 全量撤销、
  tenant 创建部分失败、额度异常和平台 UI 紧急关闭。
- 平台控制面故障不得阻断既有 tenant 工作台；只有 platform_admin 新操作暂停，tenant 业务继续
  按已有 subscription 与权限状态运行。

## Follow-up

- 2026-07-29 已人工接受本 ADR，包括独立身份、单 active 账号、MVP 延后 TOTP 的残余风险、
  tenant 创建输入、subscription 状态转换、location 计数与降额规则，以及对 ADR-009 的局部
  supersede。
- #110：数据库迁移、platform identity、Session、bootstrap/recovery CLI。
- #111：tenant/subscription/location-limit 平台 API 与 location 并发门禁。
- #112：独立 platform_admin 登录与控制台 UI。
- #113：合成 seed、权限/订阅/额度 E2E、Staging smoke、部署与恢复 Runbook。
- #114（P3/Future）：使用独立 ADR 定义 TOTP enrollment/验证、secret 加密、恢复码、轮换、
  重放防护和丢失设备恢复；不得只增加验证码输入框，也不阻塞 #110–#113 的 MVP 实施。
- Accepted 后同步 `docs/architecture.md`、`docs/database.md`、`docs/api.md`、
  `docs/admin-guide.md`、`docs/testing.md` 与 `docs/issue-archive.md`。
- #100 继续负责未来客户自助注册与真实邮箱验证；#102 继续保持商业定价和结算的 Future scope。
