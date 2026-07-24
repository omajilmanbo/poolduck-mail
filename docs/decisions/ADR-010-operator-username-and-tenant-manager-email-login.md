# ADR-010：operator 用户名与 tenant_manager 邮箱登录规则

- 状态：Accepted
- 日期：2026-07-24
- 相关 Issue：#98, #99, #100

## Context

当前 `users` 模型要求所有登录用户提供邮箱，并在 tenant 内对邮箱建立唯一约束。登录接口使用
`tenant_id + email + password`，`tenant_manager` 管理 `operator` 时也必须为其提供邮箱。

Issue #98 希望让不需要邮件能力的 `operator` 使用用户名登录，并允许其不绑定邮箱；`tenant_manager`
仍必须使用邮箱登录。登录页面只保留一个“用户名/邮箱”输入框，因此必须同时定义身份字段的唯一范围、
规范化、冲突消解、防枚举、迁移和恢复规则。

本 ADR 只定义认证身份规则，不修改 schema、API 或前端。它与以下已接受决策保持一致：

- ADR-003：登录仍需显式提供 tenant 标识；登录成功后的 tenant scope 只能来自服务端认证上下文。
- ADR-006：`tenant_manager` 只能管理本 tenant 的 `operator`；身份字段不能改变角色或授权边界。
- ADR-007：tenant 标识迁移到 `tenant_code` 由 #91 负责；本 ADR 不改变 tenant 标识格式。

Issue #100 的 tenant 注册、首个 `tenant_manager` 创建、邮箱验证与恢复流程不属于本 ADR。

## Decision

本节已于 2026-07-24 获得人工批准，#99 必须按以下规则实施。

### 1. 角色与身份字段

- `operator` 必须有 `username`，`email` 可为 `null`。设置了邮箱的 `operator` 可使用用户名或邮箱登录。
- `tenant_manager` 必须有 `email`，不设置 `username`，只能使用邮箱登录。
- `username` 和 `email` 都只是凭据定位字段。角色只能来自数据库用户记录，并在登录后写入服务端签发的
  session/token；任何输入形式都不能把 `operator` 解析为 `tenant_manager`。
- 当前租户用户表不承载 ADR-006 中未来的 tenantless `platform_admin`；平台身份规则另行决策。

### 2. 唯一范围与规范化

所有唯一性判断均使用规范值，而不是用户输入原文。

`username` 规则：

- 在单个 tenant 内大小写不敏感唯一；不同 tenant 可使用相同用户名。
- 去除首尾空白后转为 ASCII 小写并存储；长度为 3–32 个字符。
- 必须匹配 `^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$`。
- 不允许 `@`、空白、控制字符或任何非 ASCII/Unicode 字符；不执行会把 Unicode 字符折叠为 ASCII 的
  NFKC 自动转换，避免视觉相似字符被静默改写。
- 保留字按规范值比较，初始集合为：`admin`、`administrator`、`root`、`system`、`support`、
  `tenant_manager`、`operator`、`platform_admin`、`poolduck`。
- 保留字集合新增内容只影响后续创建和修改，不静默重命名既有账号；需要处理既有冲突时另建迁移计划。

`email` 规则：

- 在单个 tenant 的所有角色间大小写不敏感唯一；不同 tenant 可使用相同邮箱。
- 去除首尾空白后整体转为 ASCII 小写并存储，长度为 3–254 个字符，并通过统一邮箱格式校验。
- MVP 不接受 Unicode 本地部分或 Unicode 域名，不删除 `+tag`，也不执行 Gmail 点号等 provider 特定归并。
- `tenant_manager.email` 为非空；`operator.email` 可空，但非空时使用相同格式和唯一约束。

数据库实现必须以 tenant 范围的规范列或等效函数/部分唯一索引强制上述规则，不能只依赖应用层检查：

- 非空 `username` 的 `(tenant_id, username_normalized)` 唯一；
- 非空 `email` 的 `(tenant_id, email_normalized)` 唯一；
- 角色约束保证 `operator.username` 非空，以及 `tenant_manager.email` 非空且 `username` 为空。

### 3. 单一登录输入与冲突消解

登录 UI 统一显示“用户名/邮箱”，API 使用单一 `identifier` 字段：

- 去除首尾空白后，输入包含 `@` 时只按规范邮箱查询，不回退到用户名查询。
- 输入不包含 `@` 时只按规范用户名查询，且只可能匹配 `operator`。
- 用户名禁止 `@`，邮箱必须包含 `@`，所以两个命名空间不会产生查询优先级或多用户命中。
- tenant 标识必须先参与服务端查询范围。解析身份后仍使用内部 `tenant_id + user_id` 创建 session。
- 如果迁移期同时接受旧 `email` 字段与新 `identifier` 字段，两者同时出现且规范值不相同时直接返回
  通用登录失败，不能任选其一。

冲突矩阵：

| 场景 | 结果 |
| --- | --- |
| 同 tenant 的 `Alice` 与 `alice` 用户名 | 拒绝，规范值相同 |
| 不同 tenant 使用相同 `alice` 用户名 | 允许，由 tenant 输入隔离 |
| 同 tenant 的 operator 与 tenant_manager 使用同一邮箱 | 拒绝，邮箱在所有角色间唯一 |
| 不同 tenant 使用同一邮箱 | 允许，由 tenant 输入隔离 |
| 用户名含 `@`、全角字符或其他 Unicode | 拒绝，不自动改写 |
| operator 用户名为 `alice`，tenant_manager 邮箱为 `alice@example.com` | 允许；前者按用户名、后者按邮箱路由 |
| 无邮箱的 operator 输入用户名 | 可登录 |
| 无邮箱的 operator 输入任意邮箱 | 通用登录失败 |
| 使用另一 tenant 中存在的用户名或邮箱 | 通用登录失败，不跨 tenant 回退 |

### 4. 登录失败、防枚举与限流

- tenant 不存在、身份不存在、身份不属于该 tenant、账号停用或密码错误，对外统一返回 HTTP 401、
  `code=LOGIN_FAILED` 和相同响应结构/文案。
- DTO 格式错误可返回统一的 400 校验错误，但不得透露账号、角色或 tenant 是否存在。
- 不存在 tenant 或用户时仍执行固定的伪密码哈希校验路径，降低明显的响应时间差；不能声称网络层时间完全一致。
- 登录限流至少同时考虑来源 IP、tenant 标识的 keyed hash 和规范 identifier 的 keyed hash，避免攻击者
  通过切换单一维度绕过。原始 tenant 标识、用户名和完整邮箱不得写入普通日志。
- 审计可记录内部失败原因枚举和不可逆 keyed hash，但对外响应不区分原因。未知用户不得伪造
  `actor_user_id`；成功登录才记录真实用户 ID。

本 ADR supersede ADR-003 `Decision` 第 1 项中“先校验 tenant，再校验用户”的对外可观察错误语义：
服务端仍在 tenant 范围内完成校验，但客户端不能获知具体失败阶段。ADR-003 `Operational impact`
中的登录失败分类只允许作为受控内部指标，不得出现在 API 响应或含原始身份值的日志中。

本 ADR 也 supersede ADR-004 `Decision` 第 4 项的
`tenant_id + username(email) + password` 身份字段描述；tenant 标识的 UUID 到 `tenant_code` 切换仍以
ADR-007/#91 为准。

### 5. 创建、修改、密码重置与恢复

- #99 中只有 `tenant_manager` 可创建或修改本 tenant 的 `operator` 身份字段；`operator` 不可自改用户名。
- operator 用户名可修改但不可清空；operator 邮箱可增加、修改或清空。修改任何登录身份字段后撤销目标用户
  的全部 session，并记录不含旧值/新值原文的审计事件。
- 账号管理 API 可向已认证且有权限的同 tenant `tenant_manager` 返回明确的字段冲突错误；登录 API
  始终使用通用失败语义。
- operator 的可选邮箱在本阶段不用于自助密码重置或账号恢复。密码仍由 `tenant_manager` 重置，并通过
  tenant 批准的安全渠道交付；重置后撤销目标用户全部 session。
- `tenant_manager` 邮箱不可通过 #99 的 operator 管理 API 修改。当前如需修改，必须使用单独、受控、
  可审计的管理流程；未来自助变更、邮箱验证和恢复规则由 #100 或独立 ADR 定义。
- 任何恢复流程都不得只凭“知道用户名/邮箱”改变角色、tenant 归属或绕过密码验证。

### 6. UI 与 API 契约边界

- 登录页字段标签为“用户名/邮箱”，不要求用户选择角色；帮助文案说明 tenant_manager 使用邮箱、
  operator 使用用户名或已绑定邮箱。
- `POST /api/auth/login` 在 #91 完成前使用 `{ tenant_id, identifier, password }`，在 #91 完成后使用
  `{ tenant_code, identifier, password }`。tenant 字段的兼容窗口由 #91 确定，本 ADR 只约束
  `identifier`。
- 登录成功响应可返回当前用户的 `username` 与可选脱敏邮箱；不得假设每个用户都有邮箱。
- #99 必须同步用户管理 API、前端类型、seed、smoke 和认证测试；本 ADR 不提前修改这些接口。

## Alternatives considered

1. 所有角色继续使用必填邮箱
   - 未选择。operator 不需要真实邮箱，强制伪造或复用邮箱会增加管理和恢复风险。

2. 用户名或邮箱在平台全局唯一
   - 未选择。登录已经要求 tenant 标识，全局唯一会泄露跨客户身份占用关系并增加无业务价值的冲突。

3. 允许用户名包含 `@`，查询时先用户名后邮箱或先邮箱后用户名
   - 未选择。查询结果依赖隐式优先级，可能让新增账号改变既有账号的登录解析。

4. 接受任意 Unicode 用户名并做 NFKC/大小写折叠
   - 未选择。MVP 难以可靠处理同形字符、脚本混用和规范化版本差异；可在独立 ADR 中重新评估国际化。

5. operator 完全禁止设置邮箱
   - 未选择。已有 operator 使用邮箱登录，保留可选邮箱可降低迁移风险并支持租户自行选择登录方式。

## Consequences

正面影响：

- operator 不再需要虚构邮箱，tenant_manager 仍保留明确的邮箱身份边界。
- `@` 语法分区让单一输入框的解析确定且可测试，不会因查询顺序产生账号冒充。
- tenant 内唯一性与现有 tenant-scoped 登录模型一致，不暴露跨 tenant 身份占用。
- 通用失败响应、伪哈希路径、限流和脱敏审计降低账号枚举风险。

负面影响：

- 用户表、DTO、响应类型、seed、用户管理、登录和 session 撤销逻辑都需要迁移。
- ASCII-only 用户名限制国际化体验，保留字也需要长期维护。
- operator 邮箱从必填变为可空后，依赖 `user.email` 非空的代码和报表必须逐一修正。
- tenant_manager 邮箱恢复仍依赖后续受控流程，本 ADR 不提供自助恢复。

## Migration impact

#99 应使用可中断的 expand → backfill → dual-read → cutover → contract 流程：

1. 预检
   - 查找同 tenant 内仅大小写不同的邮箱、无效邮箱和异常角色数据。
   - 发现冲突时停止，不自动合并用户、改角色或删除邮箱。

2. Expand
   - 新增 nullable `username` 及实现规范值唯一性的列/索引。
   - 暂时保持现有 `email` 非空和旧邮箱登录可用，不立即允许清空 operator 邮箱。

3. Backfill
   - 为每个既有 operator 生成 `op-` 加 10 位小写 Crockford Base32 的非语义用户名，使用密码学安全随机源，
     在 tenant 内碰撞时最多重试 5 次。
   - 不从邮箱本地部分推导用户名，避免把 PII 复制到新标识。生成值只能通过有权限的用户管理界面交付，
     不得批量写入日志。
   - 本地、CI 和 Staging seed 使用明确的合成用户名和保留域邮箱，不使用真实客户邮箱。

4. Dual-read 与 cutover
   - 新 UI 只提交 `identifier`；受控兼容窗口内后端可接受旧 `email` 字段。
   - 统计旧字段命中、用户名登录失败、邮箱登录失败和冲突，但只记录聚合值或 keyed hash。
   - 确认所有 operator 都已有用户名、所有实例均支持新契约后，再允许 operator 邮箱为 `null` 并启用角色约束。

5. Contract
   - 兼容窗口结束后移除旧 `email` 请求字段，保留 `identifier`。
   - 在 schema、API、前端、seed、smoke、管理页和测试全部切换前，不删除任何兼容路径。

允许 operator 邮箱为 `null` 后，不能直接回滚到 email-only 代码或把列改回 `NOT NULL`。回滚应先停止清空邮箱，
保留 username-capable 登录版本，并由 tenant_manager 为无邮箱账号补充邮箱；只有预检确认无空值后才可恢复旧约束。
不得通过删除无邮箱账号完成回滚。

## Security impact

- 所有身份查询必须同时限定服务端解析的 tenant；禁止先全局查用户名/邮箱再比较 tenant。
- 同一邮箱跨 tenant 可复用，因此密码、session 和恢复操作必须始终绑定 `tenant_id + user_id`。
- 用户名、邮箱、tenant 标识、密码和 token 均不得写入普通日志；审计中的身份字段使用 keyed hash 或脱敏值。
- 身份字段修改、密码重置、账号停用必须撤销目标用户 session，并覆盖跨 tenant、错误角色和并发修改测试。
- 登录、账号管理和恢复测试不得使用真实客户邮箱；继续使用 sandbox/mock 邮件 provider。

## Operational impact

- 需要监控通用登录失败率、限流触发、旧请求字段命中、用户名生成冲突、迁移预检失败和 session 撤销失败。
- 客服 Runbook 需区分：operator 由本 tenant 的 `tenant_manager` 重置；tenant_manager 恢复升级到受控平台流程。
- 排障工具按内部 user ID 查询，不在日志或告警中显示完整用户名/邮箱。
- 数据库迁移前必须备份；切换和回滚 Runbook 必须明确“存在无邮箱 operator 时禁止回滚到 email-only”。

## Follow-up

- 已人工确认三项核心规则：tenant 内唯一、operator 邮箱可空、按 `@` 语法分区且不回退查询。
- #99 实现 schema、登录 API、用户管理、前端、seed、迁移和异常测试。
- #99 实现时同步更新 `docs/architecture.md`、`docs/database.md`、`docs/api.md`、
  `docs/user-guide.md`、`docs/admin-guide.md`、`docs/development.md` 和 `docs/issue-archive.md`。
- #100 单独定义 tenant 注册、首个 tenant_manager、邮箱验证和 tenant_manager 恢复，不把这些能力并入 #99。
