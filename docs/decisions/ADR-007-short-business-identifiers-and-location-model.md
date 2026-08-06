# ADR-007：短业务 ID 与 location 简化模型

- 状态：Accepted
- 日期：2026-07-24
- 相关 Issue：#90, #91, #92, #93

## Context

当前 `tenants`、`locations` 与 `person_mappings` 均使用 UUID 作为内部主键，所有关联表也通过 UUID 外键追溯数据。现有登录接口直接接收 tenant UUID；`locations` 另有人工提供的 `location_code`；人员扫码使用可人工维护的 `scan_code`。

Issue #90 希望降低人工输入和识别成本：

- tenant 登录标识缩短到约 8–12 位；
- location 标识由系统生成，并能在 tenant 上下文中定位；
- person 标识由系统生成、可排序，并可直接制作二维码或条形码；
- location 的 `type` 在当前阶段统一为 `location`。

短 ID 不能替代认证、授权或 tenant scope。直接缩短或替换现有 UUID 会扩大数据库主外键迁移范围，并增加历史记录断链、跨 tenant 误查和回滚失败的风险。新增公开业务 ID 则需要明确字符集、唯一范围、碰撞处理、枚举风险、迁移顺序和日志边界。

本 ADR 与以下已接受决策保持一致：

- ADR-002：扫码查询继续限定 `(tenant_id, location_id, scan_code)` 上下文；
- ADR-003：登录成功后的 tenant scope 只能来自服务端认证上下文；
- ADR-004：继续使用 PostgreSQL、Prisma 与 NestJS；
- ADR-006：短 ID 不改变 `platform_admin`、`tenant_manager`、`operator` 的权限边界。

## Decision

本 ADR 提议按对象分别处理内部主键和业务 ID。

### 1. 内部主键

- `tenants.id`、`locations.id`、`person_mappings.id` 继续使用 UUID，并继续作为数据库主键和外键目标。
- 不把短业务 ID 写入现有 `tenant_id`、`location_id` 外键列，也不级联改写历史记录。
- 服务层解析业务 ID 后必须先转换为内部 UUID；后续查询仍使用内部 UUID 与服务端 tenant scope。

### 2. tenant 公开登录 ID

- 新增 `tenants.tenant_code`，作为客户登录时输入的公开业务标识。
- `tenant_code` 固定为 10 位大写 Crockford Base32，字符集为 `0-9` 与去除 `I`、`L`、`O`、`U` 的大写字母。
- `tenant_code` 使用密码学安全随机源生成，在全局范围建立唯一约束。
- 创建 tenant 时由系统生成，不允许客户手工指定或修改。
- 插入发生唯一冲突时重新生成，单次创建最多重试 5 次；耗尽后返回内部错误并告警，不允许绕过唯一约束。
- 迁移完成后，登录接口只接受 `tenant_code`，禁止使用 UUID 登录。UUID 仍可在受控内部管理链路中使用，但不向普通登录页面暴露。

10 位 Crockford Base32 提供 50 bit 随机空间。它是公开定位符，不是认证秘密；登录仍必须验证用户名或邮箱与密码，并执行速率限制和统一失败响应。

### 3. location 业务 ID 与类型

- 保留 `locations.id` UUID 内部主键，并保留现有 `location_code` 作为业务 ID；不再新增第三个 location 标识。
- `location_code` 改为系统生成的 8 位大写 Crockford Base32，不允许客户端指定或覆盖。
- 唯一范围保持 `(tenant_id, location_code)`。任何解析都必须先使用认证上下文中的 `tenant_id` 限定 tenant，再查找 `location_code`。
- `location_code` 不嵌入 `tenant_code`、tenant 名称、顺序号或其他可推断 tenant 的前缀。location 与 tenant 的关联只保存在数据库外键和 tenant-scoped 查询中。
- 后端邮件追溯继续保存内部 `location_id`；业务码用于 API、UI 和运维识别，不作为邮件关联的外键。
- `locations.type` 在当前阶段固定为字符串 `location`。创建和更新接口不接受客户端提交其他值。
- 如果未来重新引入办公室、学校等业务分类，应通过新的 ADR 和独立的 `category` 字段实现，不复用或扩展当前固定的 `type`，以避免旧客户端把技术类型误当成业务分类。

8 位 Crockford Base32 在单个 tenant 内提供 40 bit 随机空间。创建冲突时最多重试 5 次；重试耗尽时失败并告警。

### 4. person 业务 ID 与扫码

- 保留 `person_mappings.id` UUID 内部主键，新增 `person_mappings.person_code`。
- `person_code` 固定为 12 位大写 Crockford Base32，由系统生成，不允许人工指定或修改。
- 前 7 位编码 Unix 秒时间，后 5 位为密码学安全随机值；同一进程在同一秒生成时可以从随机起点单调递增后缀，使代码大体按创建时间排序。
- `person_code` 建立全局唯一约束。数据库唯一冲突时重新生成，单次创建最多重试 5 次；分布式节点不能只依赖进程内单调状态。
- `person_code` 是二维码或 Code 128 的人员定位部分。ADR-015 已 supersede ADR-008 的负载语法，扫码写入口只接受 `V2E<person_code>` / `V2X<person_code>`，不接受 `PD1` 或裸 `person_code`；查询仍必须遵循 ADR-002 的 tenant + location 上下文，不能仅按 `person_code` 全局查人。
- `person_code` 的字典序只用于人工查看和粗略排序。API 分页、历史顺序与幂等判断继续使用 `created_at + id`，不能依赖业务码顺序。
- 代码中的时间部分会泄露大致创建时间，因此 `person_code` 不是秘密。任何能由业务码读取人员姓名、邮箱或历史的接口仍需认证、tenant/location 授权和速率限制。

### 5. 通用生成和接口规则

- 所有业务 ID 统一存储为大写，输入解析时先去除首尾空白并转为大写；不得静默删除中间字符。
- API 响应可返回对应业务 ID，但普通客户接口不返回内部 UUID，除非兼容迁移阶段明确需要。
- 短 ID 只负责定位，不参与密码校验、角色判断、订阅门禁或 tenant 授权。
- 生成器、唯一约束和冲突重试必须同时存在；只做“低碰撞概率”而不做数据库约束不满足本 ADR。

## Alternatives considered

1. 直接把 UUID 主键缩短并重写所有外键
   - 未选择。会同时影响登录、会话、订阅、location、人员、扫码、邮件、审计和导出，回滚及历史追溯风险过高。

2. tenant 继续直接使用 UUID 登录
   - 未选择。人工输入和识别成本正是本 Issue 要解决的问题，并会持续向客户暴露内部实现标识。

3. location 只保留 UUID，不保留业务 ID
   - 未选择。虽然客户当前没有直接输入 location ID 的需求，但现有 schema 和 API 已有 `location_code`；保留自动生成的业务码可避免暴露 UUID，并为 API、UI、导出和运维提供稳定标识，增量成本较低。

4. 在 location ID 中拼接 tenant ID 或 tenant 前缀
   - 未选择。它会泄露关联信息、增加 tenant 重命名和格式迁移成本，也不能替代服务端 tenant scope。

5. person 只使用 UUID 制作二维码或条形码
   - 未选择。技术上可行，但内容更长、人工核对困难，也不满足可排序短标识的目标。

6. 复用可人工编辑的 `scan_code`，不增加 person 业务 ID
   - 未选择。人工覆盖会破坏稳定身份与历史追溯；系统生成的 `person_code` 应成为二维码或条形码的规范值。

7. 使用自增整数
   - 未选择。容易枚举并暴露对象数量和创建顺序；跨环境导入、合并和回填也更容易发生冲突。

8. 使用完整 ULID 或 UUIDv7
   - 未选择为公开业务 ID。二者适合有序内部标识，但长度超过本次短 ID 目标；现有 UUID 主键也没有必要为排序性整体迁移。

## Consequences

正面影响：

- 现有 UUID 外键关系不变，迁移和回滚范围可控；
- tenant 登录输入明显缩短，UUID 登录可在切换后关闭；
- location 不向客户暴露内部 UUID，也不泄露 tenant 前缀；
- person 业务码可直接用于二维码或条形码，并能粗略按创建时间排序；
- 三类对象仍能通过内部 UUID 完整追溯历史记录。

负面影响：

- 每类对象多维护一个唯一业务 ID，服务层需要显式解析和转换；
- tenant 和 location 的随机码不能表达业务语义，客服排障需通过管理工具查询；
- person 码的时间前缀会泄露大致创建时间，且不能替代权威排序字段；
- 双读迁移期间 API、登录、seed、测试和导出需要同时理解旧 UUID 与新业务 ID。

## Migration impact

实施应拆分到 #91、#92、#93，并按以下顺序进行：

1. 扩展阶段
   - 新增 nullable `tenants.tenant_code` 与 `person_mappings.person_code`；
   - 保留现有 `locations.location_code`，先盘点其格式、重复值和外部引用；
   - 加入生成器与数据库唯一约束，但不删除或改写任何 UUID 主外键。

2. 回填阶段
   - 按稳定顺序 `created_at, id` 分批回填 tenant、location、person 业务码；
   - location 旧码如已被外部使用，保存旧值到临时兼容映射或审计表后再生成新码；
   - 每批记录回填数量、冲突次数和失败对象内部 UUID，不在日志记录人员邮箱或完整扫码载荷。

3. 双读阶段
   - tenant 登录在受控迁移窗口内同时识别 UUID 与 `tenant_code`，但 UI 只展示并提交 `tenant_code`；
   - location/person API 在兼容窗口内可解析旧标识与新业务码，响应优先返回新业务码；
   - 所有解析完成后仍使用内部 UUID 执行 tenant-scoped 查询。

4. 切换阶段
   - 验证所有记录已回填、唯一约束有效、seed/smoke/导出/UI 已切换；
   - 将业务码改为 NOT NULL；
   - 关闭 UUID 登录和普通客户 API 的 UUID 输入；
   - 保留 UUID 列、外键和历史记录，不在本轮删除兼容映射。

5. 回滚
   - 首次发布不删除旧字段或 UUID 解析代码，通过功能开关恢复旧读路径；
   - 如果新码生成或解析异常，停止新对象创建，恢复 UUID 登录/读取，并使用兼容映射追溯已发放业务码；
   - 回滚不得重新生成已对外发放的业务码，也不得复用已停用的码。

在进入实施前，必须用迁移样例证明旧 UUID、新业务 ID 与所有外键记录可以双向追溯。

## Security impact

- 短 ID 不得作为认证秘密、权限声明、tenant scope 或订阅依据。
- 登录失败响应不能区分 tenant_code 不存在、用户不属于 tenant 或密码错误；认证日志只记录 tenant_code 的哈希或掩码。
- location_code 解析必须绑定服务端 tenant scope，禁止全局查找后再比较 tenant。
- person_code 解析必须同时校验 tenant 与 location；二维码可被拍摄或转发，因此持有码者不能自动获得人员资料。
- 涉及 tenantId、locationId、人员目标邮箱的实现必须补充跨 tenant、跨 location、无权限、停用对象和碰撞重试异常测试。
- 日志、审计和错误响应不得包含完整人员邮箱、二维码原始载荷、完整 person_code 与内部 UUID 的批量对应关系。
- API 需要速率限制和统一 not-found 响应，降低 tenant、location 和 person 业务 ID 的枚举风险。

## Operational impact

- 监控业务 ID 生成冲突、重试耗尽、双读命中旧 UUID、回填失败和 UUID 登录尝试次数。
- 客服与运维工具需要支持“业务 ID → 内部 UUID”的受控查询，并记录审计；普通日志不输出完整映射。
- 备份和恢复继续以完整数据库为单位，业务 ID 唯一约束必须随 schema 一起恢复。
- seed、API smoke、GUI E2E 和导出样例要使用合成业务 ID，不得使用真实客户数据。
- 分批回填需要可重复执行、可暂停并能从最后成功游标继续。

## Follow-up

- #91：新增并回填 `tenant_code`，迁移登录、API、seed、UI 与测试，完成后关闭 UUID 登录。
- #92：把 `location_code` 改为系统生成，统一 `type=location`，补充停用/恢复与 tenant-scoped 碰撞测试。
- #93：新增并回填 `person_code`，迁移扫码入口并验证 person → location → tenant → mail job 的历史追溯。
- #101：基于稳定的 `person_code` 生成二维码与 Code 128 条形码图片，并提供安全预览和下载；不扩展 #93 的数据迁移范围。
- ADR 已人工批准；#91、#92、#93 分别按本决策同步数据库、API、架构、用户指南和管理员指南。
