# ADR-017：扫码后 10 秒发送犹豫期与取消语义

- 状态：Accepted
- 日期：2026-08-06
- 相关 Issue：#123, #61, #68, #124, #125, #127, #128, #129

## Context

Issue #61 已把成功扫码后的邮件行为定义为自动发送。当前实现会在同一数据库事务内创建不可变的
`scan_event` 与唯一的初始 `queued mail_job`，事务提交后立即调用 sandbox/mock provider；
`mail_jobs.scheduled_at` 仅用于 provider 失败后的 30 秒、2 分钟、10 分钟重试，后台 worker 约每
15 秒轮询一次到期重试。用户没有在误扫后阻止首次发送的窗口。

ADR-008 与 Issue #68 另有同一 `tenant + location + person_code` 的 10 秒业务去重窗口。该窗口用于
保证同动作重放不会创建第二个事件/邮件任务、相反动作并发不会翻转事实；它不是发送延迟，也不能
作为取消截止时间。两个窗口即使暂时都是 10 秒，也必须使用独立字段、状态机、指标和测试。

引入取消会同时影响自动发信、扫码事实的有效性、派生进出状态、历史/CSV、mail job 状态机、
多 worker 领取、订阅与资源门禁、location assignment、幂等和审计。必须满足以下硬约束：

- 截止时间前 provider 绝不被调用；取消成功后该任务以后也不得调用 provider；
- 取消与发送领取在数据库中原子竞争，只能一个终态获胜；
- provider 已被领取或调用后不宣称可以撤回、召回或删除邮件；
- 原始 `scan_event`、动作/邮件快照、幂等记录、审计和 provider 回执不得删除、覆盖或伪造；
- tenant/location/role、订阅和资源生命周期继续由服务端判定，客户端倒计时不构成权限；
- MVP 仍只允许 sandbox/mock provider 与合成地址。

2026-08-06，产品、安全与运维负责人整体接受本 ADR 的推荐方案。运行时代码仍须通过后续实现 Issue
落地；本次接受本身不修改 schema、API、worker、Frontend 或部署环境。

## Decision

决定如下。

### 1. 取消同时使误扫动作失效，但保留原始证据

- 取消成功把唯一 `mail_job` 置为终态 `canceled`，永久阻止 provider 调用。
- 原始 `scan_event.action`、`action_source`、`received_at`、操作者、原始负载指纹和邮件快照保持不可变。
- `scan_event` 增加独立取消元数据，表达该原始动作已失效；派生进出状态、同状态异常和当前有效动作
  计算排除已取消事件。取消不是把原动作改成 `unknown`，也不是删除历史。
- 历史与 CSV 同时显示原始动作和 `effective_status=canceled`、取消时间；邮件快照继续可审计，不能改写
  为“未发生”。普通用户输出不暴露取消人的邮箱、姓名或内部授权关系。

该选择把“取消”解释为纠正 10 秒内确认的误扫，而不仅是静默邮件；不采用“只阻止邮件但仍让原动作
参与状态计算”的语义。

### 2. 服务端权威时间线与独立字段

- `T0` 使用创建事务中的 PostgreSQL 数据库时间，不使用客户端时间或请求携带的 `received_at`。
- 同一事务创建 `scan_event` 和唯一 `mail_job`。新任务初始状态为 `waiting`，并设置：
  - `cancel_until = T0 + 10 seconds`：取消授权截止；
  - `send_not_before = T0 + 10 seconds`：首次发送最早领取时间。
- `cancel_until` / `send_not_before` 只描述首次犹豫期；`scheduled_at` 继续只描述 provider 失败后的
  retry，不允许用同一字段同时推断首次等待与重试。
- 首次状态机为 `waiting -> canceled | processing -> sent | queued(retry) | failed`；retry 状态机仍为
  `queued(scheduled_at) -> processing -> sent | queued | failed`。`canceled`、`sent`、重试耗尽的
  `failed` 都是终态。
- `waiting` 不能由现有人工发送入口或幂等重放触发 provider。每次实际领取（首次或 retry）仍重新执行
  ADR-003 的订阅门禁以及本 ADR 的资源门禁。

### 3. 取消与 worker 的原子竞态

- 取消只能在数据库时间严格满足 `db_now < cancel_until` 且任务仍为 `waiting` 时成功；恰好等于
  `cancel_until` 时发送领取优先。
- worker 只能在 `db_now >= send_not_before` 且任务仍为 `waiting` 时原子领取为 `processing`。
- 取消事务以 `tenant_id + location_id + scan_event_id` 锁定事件及其唯一任务，并以条件更新同时写入
  事件取消元数据和 `mail_job.status=canceled`。worker 使用条件更新/行锁领取；两条路径不能都成功。
- 取消提交成功是“provider 永不调用”的证明边界。worker 一旦领取为 `processing`，取消返回冲突；
  即使 provider 尚未实际响应，也不提供虚假撤回承诺。
- 多 worker 必须依靠数据库领取而非进程内布尔锁保证唯一处理。领取记录 `claimed_at`、claim/attempt ID；
  provider 调用前持久化尝试边界。进程重启后，`waiting` 任务可继续领取；对“已标记调用但没有回执”
  的任务进入安全的 `delivery_unknown`/人工排查路径，不自动重复调用 provider。MVP sandbox provider 以
  `mail_job_id + attempt_id` 幂等；未来真实 provider 的幂等或不确定投递策略必须另行 ADR 批准。

### 4. 取消权限与原因

- 当前仍对该 location 有显式 assignment 的任一 `operator` 可取消该 location 的等待事件；不要求必须
  是原扫码人。原扫码人若 assignment、session 或账号已被撤销，也不得凭历史身份取消。
- `tenant_manager` 可取消本 tenant 任一 location 的等待事件，不要求 operator assignment。
- 取消是降低误发风险的动作，因此 person/location 在等待期间变为 inactive 或 pending deletion 时，
  不单独阻止仍具上述授权的 actor 取消；认证、tenant scope 与 assignment 仍不可绕过。
- 10 秒交互不要求用户输入自由文本原因。审计记录固定安全原因码 `OPERATOR_MISTAKE`；不记录完整邮箱、
  邮件正文、动作码、token 或自由文本。未来若需要原因分类，另行产品决定。
- 未登录/失效 session 返回统一认证错误；跨 tenant、跨 location、无 assignment、未知 ID 均返回统一
  `SCAN_EVENT_NOT_FOUND`，不得泄露目标是否存在或当前状态。

### 5. 取消 API 与幂等

- 使用事件语义 endpoint：`POST /api/scan-events/{scan_event_id}/cancel`。服务端从关联关系定位唯一
  `mail_job`，客户端不能另传 mail job、tenant、location、actor 或截止时间。
- 首次成功和重复取消均返回 `200`，重复取消复用首次 `canceled_at`，不改写 actor/原因：
  `scan_event_id`、`mail_job_id`、`effective_status=canceled`、`mail_status=canceled`、`canceled_at`。
- 截止已到但 worker 尚未领取时返回 `409 SCAN_CANCEL_WINDOW_EXPIRED`；`processing`、`sent`、
  `failed` 或 `delivery_unknown` 返回 `409 SCAN_CANCEL_NOT_AVAILABLE`。响应不暴露 provider 细节。
- 原扫码请求使用相同 `Idempotency-Key` 重放时永远返回原事件的最新只读状态；若已取消，返回已取消
  原结果，不创建新事件、不延长窗口、不再次调用 provider。
- 取消 endpoint 本身按目标事件和已持久化终态天然幂等；网络中断后客户端必须重新读取事件或安全重试，
  不能仅凭本地点击推断取消成功。

### 6. 取消后重扫与 #68 去重

- 已取消事件不再作为 Issue #68 的“有效最近事件”，也不参与派生状态或相反动作冲突。
- 收到取消成功响应后，用户可使用新的 `Idempotency-Key` 立即重扫正确动作；无论正确动作与原动作相同
  或相反，都可创建新的事件、独立 10 秒犹豫期和唯一邮件任务。
- 使用原 `Idempotency-Key` 只能重放已取消的原事件；不得把同一个物理请求身份改绑到新事件。
- 取消与新扫码按同一 `tenant + location + person_code` 数据库锁串行化。若新扫码先于取消提交，仍按
  原 #68 结果去重/冲突；UI 只在取消成功后提示重新扫描。
- 新事件的 10 秒业务去重从新 `T0` 独立计算；取消原事件不会延长、复用或重置其他有效事件的窗口。

### 7. Frontend 契约

- 扫码创建响应和历史项返回服务端 `effective_status`、`mail_status`、`can_cancel`、`cancel_until` 与
  `server_time`。`can_cancel` 是服务端按当前响应时刻和授权计算的提示，不替代取消请求时的再次校验。
- 最近扫码记录在状态右侧保留操作位。只有 `can_cancel=true` 的 `waiting` 记录启用“取消发送”；
  成功后显示“已取消”，其他终态禁用。小窗口仍保持状态与操作可读，不把按钮覆盖在状态文本上。
- 客户端可用 `server_time` 校正显示倒计时，并在本地到零时先禁用按钮、立即刷新；客户端时钟偏差、
  页面休眠或离线不能延长服务端截止时间。
- 页面至少每 1 秒更新本地倒计时，并按现有轮询/显式刷新获取权威状态。取消网络失败显示“结果未知，
  正在刷新”，不得显示成功；409 后刷新并展示安全提示，不宣称邮件已撤回。

### 8. 订阅、资源生命周期与重试

- `trial` / `active` 才能在 `T0` 创建事件与任务；`expired` / `suspended` 继续禁止新扫码。
- 订阅在等待期间变为 `expired` / `suspended` 时，仍允许授权 actor 在截止前取消；到期领取时再次检查
  订阅，失败则不调用 provider并以安全终态和 `SUBSCRIPTION_NOT_SENDABLE` 记录。
- person/location 在首次领取前变为 inactive、pending deletion 或已完成删除时，首次发送 fail-closed，
  不调用 provider并记录 `RESOURCE_NOT_SENDABLE`。截止前的取消仍按第 4 节授权处理。
- assignment 或 session 撤销立即影响取消权限，但不改变 worker 的系统身份；worker 仍执行 tenant、订阅、
  person/location 与任务关联完整性检查。operator 是否仍登录不决定已批准任务能否发送。
- provider 首次调用失败后进入现有 retry 计划；失败后的 `queued` 不再可取消，不重新开始 10 秒窗口，
  retry 不重新解释、修改或恢复原扫码动作。

### 9. 调度 SLO、数据库时间与监控

- worker 的初始轮询周期从 15 秒缩短为 1 秒，并支持多实例数据库原子领取。正常容量下，从
  `send_not_before` 到成功领取的 p95 目标不超过 2 秒、p99 不超过 5 秒；绝不允许负延迟调用 provider。
- `cancel_until`、`send_not_before`、领取条件和边界测试全部使用 PostgreSQL 时间；应用节点时钟只用于
  日志，不参与授权。时间比较精确到数据库 timestamp 毫秒。
- 监控至少包括：等待队列深度、到期至领取延迟、截止前 provider 调用（目标恒为 0）、取消成功、重复
  取消、过期、竞态失败、不可取消状态、资源/订阅阻断、stale processing 和 `delivery_unknown`。
- `send_not_before` 后超过 5 秒未领取作为 P1 告警候选阈值写入 `docs/observability.md`。指标和日志仅
  使用内部资源 ID/聚合标签，不记录 PII、正文或完整动作码。

### 10. 审计

- 每次取消尝试记录 actor 内部 ID、tenant/location/scan event/mail job 内部 ID、数据库时间、结果和稳定
  原因码：`success`、`already_canceled`、`expired`、`race_lost`、`not_available` 或 `denied`。
- provider 领取和完成记录 attempt ID、领取/完成时间、结果与安全错误码，能证明取消和发送只有一方获胜。
- 审计为 append-only；取消不得删除或覆盖原 `scan.create`、`mail.send`、retry 或 provider 回执。

## Alternatives considered

1. **只取消邮件，原扫码动作继续生效**
   - 优点是模型变化较小，历史仍把扫码当作有效动作。
   - 未推荐。Issue 的主要场景是误扫；若错误动作仍改变派生状态，用户还需要独立人工修正流程，且
     10 秒内相反动作会继续被 #68 冲突阻止。

2. **复用 Issue #68 的 10 秒去重窗口或 `scheduled_at`**
   - 未选择。去重按人员并发语义工作，retry 按 provider 失败次数工作；复用会混淆截止、重放、
     监控和 rollback，并可能提前发送或延长取消窗口。

3. **保持 `queued`，仅通过 `scheduled_at=T0+10s` 表示首次等待**
   - 未选择。无法从状态/字段稳定区分首次可取消等待与不可取消 retry，容易让发送 API 或 worker
     绕过截止。

4. **只有原扫码 operator 可取消**
   - 未选择。共享地点/工作站发生误扫时，原 actor 可能离线；同 location 当前授权 operator 已具有
     相同业务范围，审计实际取消人即可保持追溯。

5. **要求填写自由文本取消原因**
   - 未选择。10 秒窗口内会降低纠错成功率，并引入 PII/敏感文本日志风险；固定原因码已足够表达语义。

6. **客户端倒计时结束时直接宣告发送或取消成功**
   - 未选择。客户端时钟、休眠、网络和多 worker 状态均不权威，必须读取服务端结果。

7. **用进程内 timer 为每个任务安排 10 秒发送**
   - 未选择。进程重启、水平扩容和部署会丢失 timer，无法以数据库证明取消/领取竞态。

8. **provider 调用后仍允许“取消”**
   - 未选择。外部邮件通常不可撤回；这种 UI 会制造错误安全承诺，并可能覆盖真实 provider 回执。

## Consequences

正面影响：

- 用户在误扫后有明确、可审计的 10 秒纠错窗口，成功取消可证明 provider 永不调用；
- 原始证据与邮件快照保持不可变，同时当前派生状态不会继续受已确认误扫影响；
- 首次等待、provider retry 与 #68 去重成为三个独立、可测试的状态机；
- 数据库权威时间和原子领取支持多 worker、刷新、重登与进程重启；
- 取消后的新物理扫码可以立即建立正确事实，不必等待原去重窗口。

负面影响：

- 所有成功扫码至少延迟 10 秒，且实际 provider 调用还包含 0–5 秒目标调度延迟；
- schema、历史/CSV、API、worker、审计、Frontend 和测试都需要协同修改；
- 1 秒数据库轮询增加查询负载，需要容量测试和到期延迟指标；
- 进程在 provider 调用边界崩溃时仍存在不确定投递问题；推荐方案选择不自动重复调用并人工排查，
  可能造成少量漏发，但避免在无法证明幂等时重复发信；
- 旧客户端不会理解 `waiting` / `canceled`，部署和 rollback 必须按兼容顺序执行。

## Migration impact

- schema 预计增加首次等待/取消/领取字段及相应索引、检查约束；具体 DDL、字段归属和 attempt 表由后续
  schema Issue 落地，但必须保持 `cancel_until/send_not_before` 与 `scheduled_at` 的语义分离。
- 既有 `sent`、`failed`、`processing` 记录保持原状且不可取消。既有 `queued + scheduled_at != null`
  继续视为 retry；既有 `queued + scheduled_at == null` 不获得追溯取消窗口，部署时按旧行为安全处理，
  不伪造新的 T0。
- 迁移采用 expand → 回填/约束 → 兼容应用 → 启用新创建路径 → 启用新 worker 的顺序。切换 worker 前
  必须停止旧应用立即发送新任务的路径，避免新旧版本同时解释状态。
- guarded rollback 必须先回滚应用。任何未到期 `waiting` 任务存在时禁止切回会立即发送的旧 worker；
  先等待到期并处理或由授权用户取消。`canceled` 必须保持不可发送终态，rollback 不得映射回 `queued`。
- rollback 不删除取消元数据、审计、attempt 或 provider 回执；若旧读取路径无法展示新字段，可降级为
  安全终态文本，但不能恢复发送或把已取消动作重新计入派生状态。
- 本 ADR 阶段不执行 schema、数据、Local/Staging/Production 迁移。

## Security impact

- 所有取消查询从认证 tenant 和授权 location 条件开始；禁止全局按 event/job ID 查询后再比较 tenant。
- `operator` 权限使用当前 assignment fail-closed；`tenant_manager` 仍限定在当前 tenant。跨 tenant/location
  统一 not-found，不泄露状态、人员、邮箱或是否已发送。
- 客户端不能提供或修改截止、actor、tenant、location、动作、取消时间或 mail job 关联。
- 订阅、资源与关联完整性在每次实际发送前重新检查；幂等重放、retry、进程恢复均不能绕过。
- 原始事件、快照、审计和 provider 回执 append-only，避免用“取消”掩盖误扫、越权或误发证据。
- 日志、指标、测试与 Issue 证据只使用合成数据和内部 ID，不记录真实收件人、正文、完整动作码或 token。

## Operational impact

- worker 需要 1 秒轮询、批量原子领取、stale processing/不确定投递处理和延迟指标；上线前须用可控
  数据库时间覆盖截止前 1ms、恰好截止、截止后 1ms、多 worker 与进程重启。
- 运维 Runbook 必须区分 `waiting`、retry `queued`、`processing`、`canceled`、`failed`、`sent` 与
  `delivery_unknown`，不得把 canceled/unknown 任务手工改回 queued。
- 告警需要覆盖提前发送不变量、到期延迟、取消竞态、队列积压和不确定投递；误发或跨 tenant 读取仍按
  P0/P1 处理。
- 本决定不接入真实 SMTP/Gmail/Workspace provider，不部署任何环境，也不授权真实客户数据访问。

## Follow-up

ADR 接受后，按每项 1–8 小时拆分并创建以下实现 Issue；实现仍须各自通过 Scope、测试与审批门禁：

1. #124 schema/migration：首次等待、取消元数据、attempt/claim、索引/约束、backfill 与 guarded rollback；
2. #125 Backend API/auth：取消 endpoint、location assignment、统一 not-found、幂等与审计；
3. #127 worker：数据库时间、原子多实例领取、1 秒调度、订阅/资源重检、restart 与不确定投递处理；
4. #128 Frontend：历史状态右侧按钮、服务端倒计时、刷新/网络失败、小窗口与取消后重扫引导；
5. #129 test/docs/operations：可控时间与竞态矩阵、回归、合成浏览器验证、指标/Runbook 和文档对齐。

后续实现的最低测试设计：

- 正常：T0 原子创建 `waiting` 任务、截止前取消、未取消到期自动领取/发送、重复取消幂等、取消后以
  新 key 立即重扫，以及页面刷新/重登后恢复权威倒计时与“已取消”；
- 错误：未知 ID、过期、`processing`/`sent`/`failed`/`delivery_unknown`、provider 失败与三档 retry、
  取消 API 网络中断、stale claim 和数据库短暂不可用；
- 权限：同 location 当前授权 operator、非创建者 operator 与 tenant_manager 可取消；assignment、session
  或账号撤销后拒绝；inactive/pending-deletion 资源仍允许具备授权者在窗口内执行风险降低的取消；
- 租户隔离：跨 tenant/location 伪造 event ID、job ID 或重放 key 统一 not-found，不改变目标任务，日志和
  响应不泄露人员、邮箱、状态或截止；
- 边界：数据库时间截止前 1ms、恰好截止、截止后 1ms，取消/worker/new scan 三方并发，多 worker，
  worker 重启、客户端时钟快慢/休眠，以及 p95/p99 到期领取 SLO；
- 订阅：`trial`/`active` 正常；等待期间转为 `expired`/`suspended` 时取消仍可用而发送 fail-closed，
  幂等重放与 retry 均不能绕过；
- 回归：Issue #68 同动作去重/相反动作冲突、原 key 重放、retry 30 秒/2 分钟/10 分钟、动作和正文快照、
  历史/CSV、派生状态、unmapped 不创建 mail job、location access 与敏感日志过滤；
- 人工：只用合成 person/address，在浏览器观察 10 秒按钮、到期/取消竞态、刷新/重登、网络断开恢复、
  小窗口和安全错误提示；以 sandbox provider 证明确认取消的任务从未产生调用记录。

本决策 Issue 同步更新 `docs/architecture.md`、`docs/database.md`、`docs/api.md`、`docs/requirements.md`、
`docs/user-guide.md`、`docs/admin-guide.md`、`docs/operation.md`、`docs/observability.md`、
`docs/testing.md` 与 `docs/issue-archive.md`。实现 Issue 合并前，现行文档必须明确区分当前立即自动
发送行为与 ADR-017 已批准但尚未部署的目标，不能把 Accepted 决策写成已部署行为。

2026-08-06 人工接受记录：确认取消使动作失效；同 location 当前授权 operator 与 tenant_manager 可取消；
无需自由文本原因；截止边界发送领取优先；取消后可用新幂等键立即重扫；无法证明未投递时进入
`delivery_unknown` 且不自动重发；到期领取 SLO 为 p95 不超过 2 秒、p99 不超过 5 秒。
