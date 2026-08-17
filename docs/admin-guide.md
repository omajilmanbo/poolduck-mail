# 管理员操作手册（初版）

## 1. 管理员职责

- `platform_admin`：tenantless 平台最高权限，人工创建/暂停/恢复 tenant，创建首个
  `tenant_manager`，修改 subscription 与 `location_limit`
- `tenant_manager`：仅管理自身 tenant 的 operator、location、人员、历史与审计，只读查看订阅
- `operator`：仅操作明确授权 location 内的人员、扫码与历史
- 处理关键告警（登录失败、Session 重放、平台写入失败、发信失败、越权尝试）

## 2. 平台控制面

ADR-006/ADR-013 已 Accepted；运行时已由 #110–#112 在本地实现。platform_admin 使用独立
`/platform/login`、`/platform` UI、`/api/platform/*` API 和 Session，不输入 tenant_code，
也不复用 tenant_manager/operator 工作台。

- 使用受控 CLI/Runbook 初始化、轮换、禁用或恢复唯一 active platform_admin；不得通过普通 UI
  创建平台账号，不得提交默认凭据
- 人工创建 tenant 时显式填写 name、首个 tenant_manager 邮箱、trial/active 时间区间和
  正整数 location_limit；tenant_code 和一次性临时密码由服务端生成
- 临时密码只显示一次，离开页面后清除；必须通过批准的安全渠道交付并要求首次登录改密
- 暂停/恢复、subscription 和额度变更前核对 tenant name + tenant_code、影响摘要和 version，
  并完成二次确认
- platform_admin 只能查看 tenant/subscription/额度/脱敏 manager 摘要，不读取人员、扫码、
  邮件正文、收件邮箱、租户审计或 impersonate 租户用户
- platform_admin 不受 tenant subscription 到期/暂停影响，但其账号和 Session 仍可过期、禁用和
  全量撤销。MVP 延后 TOTP，使用单 active 账号、高熵密码、限流、有限 Session、独立 audience、
  审计和异常告警作为补偿控制；TOTP 见 #114

受控 CLI 在 `backend` 目录运行，凭据只能从运行时环境注入，命令不会回显：

- `npm.cmd run platform:admin -- bootstrap`：仅在不存在 active 账号时初始化
- `npm.cmd run platform:admin -- rotate`：轮换密码、增加 identity version、撤销全部 Session
- `npm.cmd run platform:admin -- disable`：禁用并撤销全部 Session
- `npm.cmd run platform:admin -- recover`：仅在没有其他 active 账号时恢复并轮换密码

Local/CI/Staging 合成账号另用显式 opt-in 的 `platform:seed`；Production 会拒绝该 seed。平台
控制台地址为 `/platform/login`，账号恢复不提供 UI。

## 3. 用户与权限管理

- `tenant_manager` 可从工作台进入“用户管理”，列出、创建、修改 username/可选邮箱、启停和重置本
  tenant 的 `operator`；`operator` 没有该入口，当前不能创建或管理其他 `tenant_manager`
- operator username 为 3–32 位小写 ASCII 字母、数字、点、下划线或连字符，首尾为字母或数字；
  `admin`、`root`、`operator` 等保留字不可使用。username 在 tenant 内唯一，邮箱可留空
- 创建或重置密码由 `tenant_manager` 直接提交新密码；至少 8 位且必须同时包含英文字母和数字，可包含额外符号
- 修改 username/email、禁用或重置密码会立即撤销目标 operator 的全部会话；API 响应和审计日志均不
  包含身份原文、密码或密码哈希
- 新建和既有 operator 默认没有 location 权限。tenant_manager 必须通过 assignment API 显式设置一个或多个 active location；空数组表示撤销全部，单地点也可单独撤销
- “用户管理”的“地点权限”列显示每个 operator 当前已分配地点；点击“配置地点”可多选当前 tenant 的 active location 并原子保存。可分配地点使用独立滚动列表，弹窗会适配较小窗口并保持取消、保存按钮可见。停用地点会明确标记且不能新增分配
- 撤销一个或多个 assignment 前页面会列出影响并要求确认；保存成功后列表立即刷新。operator 的新扫码、人员映射写入与历史请求立即被拒绝，不需要等待 token 过期或重新登录
- ADR-018 已移除未映射处理页和 case API。格式正确但没有当前 active 映射的输入只返回统一拒绝，不保存业务记录，不得把跨 tenant/location 或随机合法码当作可修正人员工单
- 页面在停用与密码重置前要求确认；新密码提交后即从表单清除，后续应通过租户批准的安全渠道交付
- 定期审查高权限账号

## 4. 订阅管理

- 只有 platform_admin 可修改 `trial` / `active` / `expired` / `suspended`、有效期和
  `location_limit`；tenant_manager 只读，operator 无权限
- 到期前由平台运营通知业务负责人；过期或暂停后禁止扫码提交、创建邮件任务、发送与重试
- location 额度统计 active、inactive 和 pending deletion，ADR-011 终结清理为 purged 后释放
- 达到额度时禁止创建新地点；提高额度立即允许后续创建；降低额度不得低于当前计数，也不会隐式
  停用、删除或冻结既有地点
- 人工额度不包含价格、付款、账单、proration 或自动扩容；商业化仍由 #102 Future 决策

## 5. 审计与合规

- `tenant_manager` 可在审计页面按时间、动作查询当前租户日志并导出 CSV；单次导出时间范围不超过 31 天
- 扫描与邮件历史也可按当前地点导出 CSV；邮箱仅以 `a***z@example.com` 形式部分脱敏
- 审计与导出不得包含邮件正文、密码、token 或 provider secret；Production 审计日志保留 90 天

## 6. 地点与人员停用

- tenant_manager 新建地点时只填写名称；8 位地点 ID 由服务端生成，类型固定为 `location`，页面不再要求代码或 office/school 分类
- “停用”只暂停人员业务使用；“删除”进入 14 天恢复期。恢复入口紧邻删除状态并显示剩余天数，
  到期后当前姓名和邮箱被匿名化，公开人员 ID 与历史记录保留且不可复用
- 已停用人员可在人员管理页“重新启用”；地点本身必须处于启用状态，重新启用不会改变人员 ID 或历史记录
- 新增人员时由服务端生成不可编辑的 12 位 `person_code`；该人员使用 `V2E<person_code>` 与 `V2X<person_code>` 两张动作码，管理员不得手工指定、复用人员 ID 或把 `PD1`/裸人员码当作扫码写入值
- 人员列表的“查看动作码”在受控浏览器内临时生成进入/离开 × 二维码/Code 128 共四张图片，支持单张 PNG 与四张图片 ZIP 下载。下载文件名仅使用 `person_code`、动作和格式；图片不得包含姓名、邮箱、tenant/location UUID 或内部人员 UUID，也不得上传到第三方图片服务或持久化
- ADR-015 已批准上线前直接使用产品名无关的 `V2E<person_code>` / `V2X<person_code>` 替换 `PD1|...`，不实施双读、旧资产重印或撤销流程。解析器与四资产必须同步切换；完成前不得混用格式。兼容验证面向 USB HID/Windows 布局，不把厂牌/型号列为应用准入前提
- 进入与离开图片除颜色外还使用方向图形和显著文字区分，便于黑白打印和人工核对；人员 ID 缺失或格式非法时不得生成或下载，也不得回退到内部 UUID
- 进入/离开由动作码显式决定，不设置操作员手动动作开关，也不按租户时区零点或每日扫码次数重置/推断
- 邮件任务保存发送时的 tenant/location/person 名称与 `person_code` 快照。后续改名不改写历史；审计和普通日志不得记录完整邮箱、邮件正文或批量 UUID/人员码对应关系
- “停用”可随时重新启用；“删除”进入 14 天恢复期，并立即停止新扫描、映射写入、地点授权和 queued
  邮件。期限内可恢复删除前状态；到期后地点名称及其当前人员 PII 被匿名化、operator 授权撤销，历史不删除
- 已停用地点可由 tenant_manager 在地点管理页重新启用；inactive 地点已经占用人工额度，因此
  重新启用不新增额度占用，仍不依赖价格、付款或商业计费配置
- `operator` 只能维护当前租户已显式授权地点内的人员映射；只有 `tenant_manager` 可新增、编辑、停用或启用地点
- 关注 denied/fail 事件峰值
- 发生安全事件时保全日志并升级处理

## 7. ADR-017 扫码取消管理边界

- ADR-017 已批准同 location 当前授权 operator 与 tenant_manager 在数据库截止前取消等待任务；不要求
  自由文本原因，审计使用固定安全原因码并保留真实 actor、时间、目标内部 ID 和结果。
- 取消同时使误扫动作不再参与当前派生状态，但不删除或覆盖原始扫码、邮件快照、幂等、审计或
  provider 回执。管理员也不能把已取消任务改回 `queued` 或在 provider 领取后宣称撤回。
- 跨 tenant/location、无 assignment 与未知 ID 统一 not-found；assignment/session 撤销立即影响取消
  权限。person/location 停用或待删除不会阻止仍具授权者在窗口内执行降低误发风险的取消。
- 本地代码和工作台已实现该能力；管理员不得直接修改数据库把 `canceled` 或 `delivery_unknown` 恢复为可发送状态。
