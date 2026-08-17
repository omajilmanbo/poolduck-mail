# ADR-018：未映射动作码的拒绝、历史与可观测性边界

- 状态：Accepted
- 日期：2026-08-06
- 相关 Issue：#75, #93, #95, #104, #117, #122

## Context

Issue #75 在人员扫码编号可以人工维护时建立了完整的未映射处理工作流。ADR-018 实施前的基线会在动作码语法正确、当前已授权 tenant/location 下找不到 active 人员映射时：

1. 创建 `scan_type=unmapped` 的 `scan_events`，保存解析后的 `person_code`、动作和接收时间；
2. 同一事务创建唯一关联的 `unmapped_scan_cases`，初始状态为 `open`；
3. 写入 `scan.unmapped` 审计；
4. 返回 `SCAN_CODE_NOT_MAPPED` 和 `scan_event_id`；
5. 不创建 `mail_jobs`，也不自动补发邮件。

`tenant_manager` 和 `operator` 都可读取未映射 case。所有查询以 token tenant 限定；operator 还必须通过 `operator_location_assignments`，没有 assignment 时 fail closed。停用地点的历史可读但不可处理。列表最多读取最近 200 条，没有游标。`resolved` / `ignored` 会记录处理人、处理时间和审计；`resolved` 还要求同 tenant/location 下已经存在同码 active 人员映射。

页面只对 `open` case 显示处理按钮；API 本身没有要求当前状态必须是 `open`，也没有 reopen 动作，因此调用方可以在 `resolved` 与 `ignored` 之间重复覆盖状态并产生新的处理审计。这是现行状态机边界，不应被解释为业务闭环已定义完整。

ADR-007 和 ADR-015 改变了 #75 的前提：

- `person_code` 由服务端在创建人员时生成、全局唯一、不可由客户端指定或修改，也不可移动或复用；
- 扫码入口只接受 `V2E<person_code>` / `V2X<person_code>`；
- 人员创建 API 只接受姓名和邮箱，现有 `/unmapped` 页的“修正映射”链接虽然传递 `scan_code`，但人员页不读取或预填该参数；
- inactive 人员重新启用、待删除人员在 14 天内恢复时会保留原 `person_code`，所以这两类 case 之后可以满足 `resolved` 条件；
- purged 人员、其他 location/tenant 的人员和随机合法码不能通过正常 API 在当前 location 创建或复用同码映射，因此“创建映射后 resolved”对这些来源不可达；
- migration、restore、seed 或人工数据修复可能让关系恢复，但这属于受控数据修复，不是租户用户应执行的日常业务动作。

ADR-018 实施前的请求路径还有以下重要边界：

- `ACTION_CODE_INVALID` 在动作码语法解析阶段返回，不创建 `scan_event`、case 或 mail job，只写脱敏拒绝审计；
- valid-but-not-active 的动作码在 active 人员查询失败后统一进入 unmapped 路径；当前查询不会跨 tenant/location 判断人员是否存在；
- location assignment、location active 状态和 subscription gate 在人员查询前 fail closed；被这些门禁拒绝时不会创建 unmapped 记录；
- unmapped 路径位于成功扫码的 10 秒去重与幂等结果持久化之前。重复或快速构造的合法随机码会逐次创建 `scan_events`、`unmapped_scan_cases` 和审计记录；
- 当前没有扫码入口专用速率限制、未映射记录保留期、聚合指标或未映射告警阈值。完整合法码不会写入审计 metadata，但会持久化在业务表和 `raw_payload` 中并显示在 case 页面。

因此需要重新判断“格式正确但没有当前 active 映射”究竟是待处理业务工单，还是统一安全拒绝和运维信号。

### 场景矩阵

| 输入/对象状态 | 当前行为 | 建议分类 | 对外响应与持久化边界 |
|---|---|---|---|
| 当前 tenant/location 的 active 人员 `V2E/V2X` | 创建成功 `scan_event` 和唯一 mail job | 正常业务 | 成功响应；继续执行幂等、10 秒去重和邮件语义 |
| 当前 location 的 inactive 人员 | 创建 unmapped event/case；重新启用后可标记 resolved | 普通业务拒绝 | 与其他未映射统一返回 `SCAN_CODE_NOT_MAPPED`；不得说明 inactive；不创建 mail job |
| 当前 location 的 pending deletion 人员 | 创建 unmapped event/case；到期前恢复后可能 resolved | 普通业务拒绝 | 与其他未映射统一响应；不得说明删除阶段；不创建 mail job |
| 当前 location 的 purged 人员旧码 | 创建 unmapped event/case；正常 API 永远不能 resolved | 永久失效资产/普通拒绝 | 与其他未映射统一响应；不得恢复或复用 code；不创建 mail job |
| 同 tenant 其他 location 的动作码 | 在当前 location 创建 unmapped event/case | 授权范围外输入 | 与随机码相同响应；禁止跨 location 查询、移动或绑定；不创建 mail job |
| 其他 tenant 的动作码 | 在当前 tenant/location 创建 unmapped event/case | 安全拒绝 | 不执行跨 tenant 存在性查询；统一响应；不创建 mail job |
| 随机构造但语法合法的 `V2E/V2X` | 每次创建 event/case | 滥用或普通拒绝 | 统一响应；限流后的审计/指标不得包含完整负载；不创建 mail job |
| `PD1`、裸 `person_code`、未知版本/动作、畸形长度/字符 | `ACTION_CODE_INVALID`，无 event/case/mail job | 格式拒绝 | 继续统一 `ACTION_CODE_INVALID`；仅限流后的脱敏审计/指标 |
| migration/restore/seed 关系异常 | 通常表现为 unmapped，来源无法由响应区分 | 数据完整性异常 | 请求仍统一响应；由离线完整性检查和运维告警定位，不在请求路径跨 scope 探测 |
| location 未授权、inactive/pending deletion/purged | 在人员查询前拒绝，无 unmapped event/case | 授权或资源状态拒绝 | 保持现有统一 not-found/inactive 语义；不泄露人员存在性 |
| subscription `expired` / `suspended` | 在人员查询前拒绝，无 unmapped event/case | 订阅门禁拒绝 | 保持 ADR-003；不创建 event/case/mail job |

## Decision

采用“停止持久化未映射业务事件与 case，以统一拒绝替代独立管理页”的方案。

2026-08-06 人工确认：服务仍未上线、没有业务数据、没有需要保留或逐条闭环的已发放动作码，也不需要保留既有未映射历史；允许直接修改服务代码和数据库结构。因此本 ADR 标记为 `Accepted`，不设置旧 API/UI 兼容期，也不保留 unmapped event/case 数据。

目标行为如下：

1. 只有成功解析且在当前已授权 tenant/location 找到 active 人员的输入才创建新的业务 `scan_event` 和 mail job。
2. 语法正确但找不到当前 active 映射时统一返回 `SCAN_CODE_NOT_MAPPED`，不返回人员状态、其他 location/tenant 是否存在或内部原因，也不创建新的 `scan_event`、`unmapped_scan_case` 或 mail job。
3. `ACTION_CODE_INVALID` 继续表示语法、版本、动作、长度或字符错误；未授权 location、inactive location 与 subscription 拒绝继续使用现有门禁错误。错误检查顺序不得通过响应差异泄露人员是否存在。
4. 请求路径不得为了分类而查询其他 tenant 或其他 location。inactive/pending deletion/purged 的内部区别也不进入对外响应。
5. 退役“修正映射”、`resolved`、`ignored` 和独立 `/unmapped` 页面。人员重新启用/恢复仍通过人员管理流程完成，但不再与历史拒绝记录建立“已修正”关系，也不补发历史邮件。
6. 删除 `unmapped_scan_cases` schema、模块、API、测试和前端页面；前向 migration 先移除 case 表，再清除 `scan_type=unmapped` 的开发/合成 scan event。历史、列表、导出和前端状态不再支持 `unmapped`。
7. 新拒绝不写 `scan_events`、`unmapped_scan_cases`、mail job 或逐请求数据库审计。可观测性使用有保留期的运行日志/指标，后续上线门禁必须补充扫码速率限制与聚合告警：
   - 指标至少区分 `invalid_format`、`not_mapped`、`authorization_denied`、`subscription_denied`、`rate_limited`；
   - 指标不得带完整动作码、`person_code`、邮箱、姓名、UUID 或可反查跨 tenant 映射的标签；
   - 后续聚合审计按批准的 actor/session、来源 IP 指纹和当前授权 location 维度限流，记录稳定错误类别、request ID 与计数，不记录原始请求体；
   - Local/Staging/Production 日志保留分别沿用 `docs/observability.md` 的 7/30/90 天基线；
   - 未映射拒绝率、限流触发和完整性检查失败进入聚合告警。具体阈值和响应责任人由独立安全/运维 Issue 在首次上线前批准，不在本次代码删除中猜测。
8. migration/restore/seed 异常由离线完整性检查识别。检查至少验证人员 tenant 与 location tenant 一致、全局 `person_code` 唯一、状态/删除时间组合有效和成功业务历史外键完整；结果只报告计数与受控内部关联 ID，不报告完整动作码或 PII。
9. tenant/location 授权继续 fail closed；未映射、拒绝、历史读取或回滚均不得创建或补发 mail job。

如果服务上线后出现需要逐条闭环的已发放失效资产，必须新建 ADR 重新定义来源、负责角色、动作、完成条件和保留期；不得恢复客户端指定/复用 `person_code`，也不得把随机或跨 scope 输入重新作为租户业务工单。

## Alternatives considered

1. **原样保留独立 case 表、API 和管理页**
   - 不选择。当前“修正映射”链接没有可执行预填路径；创建人员不能指定或复用 code；大量 case 永远无法 resolved；随机合法输入可以无界扩张业务表。

2. **保留 case，但把动作改为重新启用/恢复人员**
   - 暂不选择。它只覆盖当前 location 的 inactive 或仍在恢复期的人员，不能覆盖 purged、跨 location/tenant、随机输入或关系异常。若产品确认已发放资产需要逐条闭环，可把该方案作为新的受限 ADR 修订，但页面必须只展示服务端在当前 scope 内安全分类出的可恢复对象。

3. **保留 unmapped `scan_event`，移除 case 与页面**
   - 不作为首选。它能保留扫码历史筛选，但随机合法输入仍可无界增加业务历史，且把拒绝请求与成功业务事件混在同一表中。只有在人工作出“每次合法未映射输入都是必须长期保存的业务证据”决定后才考虑。

4. **停止新增 event/case，使用限流审计、聚合指标和离线完整性检查**
   - 推荐。它保留统一拒绝和安全可观测性，同时消除不可处理工单和持久化膨胀。代价是租户用户不再逐条查看新未映射输入，必须先确认这不是必要业务流程。

5. **按角色或异常来源缩小页面范围**
   - 单独使用不能解决问题。角色缩小不会让不可 resolved 的 case 变得可处理；来源分类若需要跨 tenant/location 查询还会扩大泄露风险。仅当产品确认某一当前 tenant/location 内的可恢复来源需要人工闭环时，才可与方案 2 组合。

6. **对所有失败都返回 `ACTION_CODE_INVALID`**
   - 不选择。语法错误与已通过语法但当前 scope 无 active 映射是稳定且有用的 API 分类；统一成一个错误会削弱排障，又不能替代授权、订阅和速率限制门禁。

## Consequences

正面影响：

- 消除无法通过正常 API 完成的“修正映射”入口和长期 open case；
- 随机合法输入不再无界扩张 `scan_events` / `unmapped_scan_cases`；
- 跨 tenant/location、inactive/deleted 和随机输入继续使用统一外部响应，不泄露存在性；
- 成功扫码历史、邮件、幂等、10 秒去重和动作语义保持独立；
- 数据异常由完整性检查和聚合告警处理，比租户用户逐条猜测来源更可执行。

负面影响：

- 新未映射输入不再出现在租户历史或独立页面；未来若出现已发放资产逐条闭环需求，需要新的产品决策；
- 支持与运维需要依赖指标、脱敏审计和完整性检查，而不是完整输入列表；
- 回滚只能重新启用旧行为，不能恢复已经删除的开发/合成 unmapped 历史；该限制由“未上线、无业务数据”的人工确认接受。

## Migration impact

按一次性直接替换执行：

1. 后端先把 not-mapped 分支改为只返回不含 `scan_event_id` 的 `SCAN_CODE_NOT_MAPPED`，不创建 event/case/mail job 或数据库审计。
2. 同一变更移除 case 模块、路由、前端导航/页面/client、`unmapped` 历史筛选与状态。
3. Prisma schema 删除 `UnmappedScanCase` 及关系；前向 migration 删除 `unmapped_scan_cases`，再删除所有 `scan_type=unmapped` 的开发/合成 scan event。
4. seed、smoke、单元/集成/E2E 和现行文档同步改为“未映射只拒绝且无持久化”。
5. guarded rollback 只重建空 case 表及约束，供旧应用代码重新启动；它不恢复已删除的开发/合成 event/case，也不得补发邮件。执行回滚前必须确认没有业务数据且停止写流量。

## Security impact

- 所有人员查找继续限定 JWT tenant、当前 location 和 operator assignment；禁止用全局 `person_code` 查询结果区分其他 tenant/location。
- 对外不得区分 inactive、pending deletion、purged、其他 location、其他 tenant 或随机合法码。
- 速率限制必须在人员存在性不会影响结果的位置执行，`429` 只表示请求频率，不表示 code 是否存在。
- 指标、日志、告警、Issue 和测试证据不得包含完整动作码、邮箱、姓名、tenant/location UUID 或跨 tenant 映射；原始请求体不得写日志。
- `trial` / `active` 与 `expired` / `suspended` 继续遵循 ADR-003；拒绝路径不能创建可发送任务。
- 历史读取继续复用 location assignment；删除 unmapped 筛选不得扩大成功业务历史的可见范围。

## Operational impact

- 新增扫码拒绝计数、速率限制计数、拒绝率和数据完整性检查结果；指标采用低基数标签。
- 告警必须聚合同一环境和稳定错误类别，避免每个随机码产生单独告警；详细排障使用 request ID 和受控内部记录，不使用完整动作码。
- 现有日志保留基线为 Local 7 天、Staging 30 天、Production 90 天。数据库历史保留不在本 ADR 中擅自缩短。
- 扫码限流阈值、通知渠道、值班责任和误报处理必须在首次上线前由独立安全/运维 Issue 批准；本次通过停止业务持久化先消除随机合法码扩张 event/case 的风险。
- 不操作 Staging/Production 或真实客户数据；实现与验证只使用合成 tenant/location/person/action code。

## Follow-up

人工已明确授权在 #122 延续任务中直接完成 Backend、Frontend、migration、测试和文档删除，不再为已完成的同一变更创建重复实施 Issue。

上线前安全/运维由 Issue #126 跟踪：

1. **安全/运维（4–6 小时）：定义并实现扫码速率限制、聚合指标与告警**
   - Background：停止 event/case 持久化后，仍需在首次上线前控制认证用户快速随机输入和运行日志噪声。
   - Scope：人工批准 actor/session/source fingerprint/location 维度、窗口、阈值、`429` 契约、低基数指标、聚合告警、通知责任人和网络/指标出口失败降级。
   - Out of scope：不恢复 case/page，不记录完整动作码、PII、UUID 或跨 tenant 映射，不改变成功扫码邮件语义。
   - Acceptance：阈值有负责人批准；限流不依赖人员是否存在；指标/日志无敏感标签；监控失败不放宽授权或允许发信。
   - Tests：normal、invalid、not-mapped、cross-location/tenant、burst、trial/active/expired/suspended、network failure、并发和窗口边界。
   - Recommended labels：`type:task`, `role:backend`, `role:test`；Risk labels：`risk:auth`, `risk:data`；Human decision required：Yes。

Issue #126 的完整 Scope、Out of scope、Acceptance criteria、Test requirements、labels 和讨论留在 GitHub；本 ADR 仅保留决策边界。
