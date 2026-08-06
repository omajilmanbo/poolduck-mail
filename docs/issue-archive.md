# Issue 与产品改进归档

本文集中记录项目开发里程碑、当前跟进项和产品改进 Issue。README 不再维护 Issue 编号、执行顺序或开发历史。

GitHub Issue 是 Scope、状态、验收标准和讨论记录的权威来源；本文是仓库内的阶段性索引，不替代 GitHub。Issue 状态可能变化，执行前必须打开对应 GitHub Issue 确认。

## 1. 维护规则

- 新建产品功能、体验改进或业务流程变更 Issue 时，必须在“产品改进”登记。
- 新建缺陷、工程改进、运维或基础设施 Issue 时，登记到对应分类。工程改进指不直接新增产品功能，但用于改善代码质量、依赖版本、可维护性或内部结构的工作。
- Issue 拆分、合并、关闭或 Scope 变化后，同步更新本文件的摘要和分类。
- 摘要只说明目标，不复制完整 Scope、Out of scope、验收标准或讨论内容。
- 没有 Issue 编号的候选项标记为“待建 Issue”，不得直接进入实现。
- 涉及行为或架构决策的项目需标明是否需要人工确认；重要决策仍按 ADR 流程处理。

建议登记格式：

| Issue | 分类 | 摘要 | 阶段备注 | 人工确认 |
|---|---|---|---|---|
| `#<id>` | 产品改进 / 缺陷 / 工程改进 / 运维 / 基础设施 | 一句话目标 | 实时状态见 GitHub | 是 / 否 |

## 2. 产品改进

| Issue | 摘要 | 阶段备注 | 人工确认 |
|---|---|---|---|
| #61 | 自动处理扫码后创建的 `queued` mail job，并移除 GUI 手动发送按钮；真实 SMTP/provider 不在该项范围内 | 已完成并关闭 | 是，改变邮件发送行为 |
| #73 | 实现 tenant_manager 的 location 管理 API 与安全停用规则 | 已完成并关闭；不依赖商业配额或计费配置 | 是，停用行为与 queued 任务处理已确认 |
| #83 | 商业订阅概览、location allowance 与续订提醒 | 已关闭为 `not_planned`；MVP 仅保留 #64/#65 的安全门禁与页面修正 | 是，商业化范围延后 |
| #90 | 用 ADR 定义 tenant、location、person 的短业务 ID、内部主键与 location 简化模型 | ADR-007 Accepted，已关闭 | 是，已确认 |
| #91 | 按批准的 ID ADR 引入 8–12 位 tenant 公共 ID 并迁移登录入口 | 已完成并关闭；纳入本次阶段 PR | 是，涉及认证与数据迁移 |
| #92 | 自动生成 location ID，将类型统一为 `location`，简化创建并补充地点/人员重新启用 | 已完成并关闭；纳入本次阶段 PR | 是，ADR-007 已 Accepted |
| #93 | 引入有序人员 ID，并固化 person → location → tenant 的邮件上下文追溯 | 已完成并关闭；纳入本次阶段 PR | 是，涉及历史数据迁移 |
| #94 | 用 ADR 定义人员扫码进入、离开及异常场景的动作判定规则 | ADR-008 Accepted，已关闭 | 是，已确认 |
| #95 | 按批准规则记录进出动作，并同步扫码历史与固定邮件正文 | 已完成并关闭；纳入本次阶段 PR | 是，动作 ADR 已确认 |
| #96 | 实现 operator-location assignment 模型及所有服务端业务路径的授权门禁 | 已完成并关闭；纳入本次阶段 PR | 是，已确认 fail-closed 迁移 |
| #97 | 在用户管理页配置 operator 的 location 权限并验证实际可见范围 | 已完成并关闭；纳入本次阶段 PR | 是，涉及权限 UI |
| #98 | 用 ADR 定义 operator 用户名、可选邮箱与 tenant_manager 邮箱登录规则 | ADR-010 Accepted，已关闭 | 是，已确认 |
| #99 | 实现用户名/邮箱双模式登录及相应的 operator 账号管理 | 已完成并关闭；纳入本次阶段 PR | 是，ADR-010 已确认 |
| #100 | 用 ADR 规划真实邮箱注册 tenant 与首个 tenant_manager 的流程 | 已登记，实时状态与 Scope 见 GitHub | 是，涉及真实邮箱与注册安全 |
| #101 | 基于已批准的 `person_code` 生成人员二维码与 Code 128 条形码图片，并支持安全预览和下载 | 已完成并关闭；纳入本次阶段 PR | 否，依赖 #90 与 #93 |
| #102 | 用 ADR 定义按启用 location 数量与单据点活动人员计算的边际阶梯计费模型 | P3/Future；仅服务未来商业化，不阻塞任何 MVP 功能 | 是，涉及计费口径、proration 与安全上限 |
| #104 | 为人员与地点增加 14 天可恢复删除和到期终结清理 | 已完成并关闭；纳入本次阶段 PR | 是，ADR-011 Accepted |
| #109 | 用 ADR 定义 tenantless `platform_admin` 平台控制面、人工租户开通、订阅状态与 location 额度管理 | ADR-013 Accepted，已完成并关闭 | 是，已确认人工额度、独立控制面及 ADR-009 局部 supersede |
| #110 | 实现 platform_admin 独立身份、Session、bootstrap 与恢复 CLI | 本地已实现并验证；尚未提交或部署 | 是，涉及最高权限认证、Secret 与恢复 |
| #111 | 实现平台 tenant/subscription/location_limit API 与并发安全额度门禁 | 本地已实现并验证；尚未提交或部署 | 是，涉及租户创建、订阅、额度和迁移 |
| #112 | 建立独立 platform_admin 登录与平台控制台 UI | 本地已实现并验证；尚未提交或部署 | 是，涉及最高权限 UI 与一次性凭据 |
| #113 | 建立平台合成 seed、E2E、Staging smoke 与恢复 Runbook | Local/CI 资产与 Staging Runbook 已实现；按用户范围未执行 Staging | 是，涉及 Staging 身份、Secret、迁移和恢复 |
| #114 | 用独立 ADR 定义 platform_admin TOTP MFA、恢复码与丢失设备恢复 | P3/Future；不阻塞 ADR-013 MVP | 是，涉及最高权限 MFA 与 break-glass |
| #117 | 用 ADR 检讨扫码枪兼容的动作码负载格式 | ADR-015 Accepted；本地已直接切换 `V2E` / `V2X`、Docker 部署并完成 smoke | 是，涉及动作码/API 契约 |
| #118–#121 | 原双读、四资产迁移、发布迁移与旧解析器移除任务 | 已关闭为 not planned；上线前无业务数据，迁移链路被 ADR-015 直接替换决策取代 | 否，不再执行 |
| #122 | 用 ADR 检讨自动生成 `person_code` 后未映射扫码状态与独立管理页面是否仍有必要 | ADR-018 Accepted；服务上线前直接移除未映射 event/case、API/UI 与历史状态，本地实现和验证已完成 | 是，已确认无业务数据且无需保留历史 |
| #123 | 用 ADR 定义扫码后 10 秒可取消发送的犹豫期、竞态和历史语义 | ADR-017 Accepted；已完成并关闭，后续代码拆分为 #124、#125、#127–#129 | 是，已确认取消语义、角色、边界、重扫、未知投递与 SLO |
| #124 | 建立 ADR-017 waiting/canceled/delivery_unknown 状态、首次等待字段与可回滚迁移 | 本地已实现并验证；尚未部署 | 是，涉及 schema、backfill 与 guarded rollback |
| #125 | 实现扫码取消 API、location 授权、原子竞态与幂等重扫 | 本地已实现并验证；尚未部署 | 是，涉及 auth、tenant isolation、历史有效性与审计 |
| #126 | 定义并实现扫码速率限制、聚合指标与告警 | 上线前安全/运维门禁；不恢复未映射 case/page | 是，需批准阈值、通知责任人与失败降级 |
| #127 | 实现到期发送 worker、多实例原子领取、订阅/资源重检与安全恢复 | 本地已实现并验证；尚未部署 | 是，涉及自动发信、故障恢复与 SLO |
| #128 | 实现扫码记录右侧取消按钮、服务端倒计时与历史终态 | 本地已实现并验证；尚未部署 | 是，涉及安全 UX 与服务端权威状态 |
| #129 | 完成 ADR-017 竞态/E2E/smoke、迁移回滚、文档与运维准入 | 本地自动化、人工浏览器与 Compose 验证已完成；尚未部署 | 是，需人工审核完整准入证据 |

后续所有产品能力、用户体验和业务流程改进 Issue 均追加到本节。

## 3. 当前运维与工程补强

| Issue | 分类 | 摘要 | 阶段备注 | 人工确认 |
|---|---|---|---|---|
| #38 | 运维 | PostgreSQL 备份与恢复策略 | 当前跟进项，实时状态见 GitHub | 是 |
| #39 | 运维 | 日志、监控与告警策略 | 策略文档已完成并关闭；集中采集与真实告警仍待独立实施 | 是 |
| #116 | 运维 | 测量 OCI Always Free 单机的最大可持续并发扫码发信容量，并检讨低成本性能监控方案 | 已登记，实时状态与 Scope 见 GitHub | 是，涉及 Staging 压测窗口、资源边界与监控责任 |
| 待建 Issue | 工程改进 | 按 ADR-005 实现幂等 Staging 部署脚本；人工审批触发，并保留恢复 Runbook | 已批准设计，尚未实现 | 是 |
| #86 | 基础设施 | Staging 域名、TLS 与访问控制 | ADR-012 Accepted；总体跟踪，Caddy/Let's Encrypt 实施见 #107 | 是 |
| #107 | 基础设施 | 按 ADR-012 为 Staging 接入 Caddy、Let's Encrypt、HTTPS 路由与证书续期 | 已完成并部署；80/443 公网入口于 2026-07-29 人工批准 | 是，ADR-012 与公网入口已确认 |

## 4. 已完成的 MVP 基线里程碑

本节只保留阶段成果索引，不作为 Issue 当前状态依据。

| Issue | 阶段成果 |
|---|---|
| #17 | MVP 技术栈 ADR 定版与文档对齐 |
| #18 / #19 / #20 | Frontend、Backend 工程骨架与 CI 基线 |
| #31 | 阶段成果与文档一致性审查 |
| #35 / #36 | 三环境基础设施设计与 Local Docker Compose |
| #37 / #48 | Staging 部署设计与 OCI Always Free Terraform 基线 |
| #41 / #43 | Issue 人工前提模板与基础设施参数台账 |
| #21 | Prisma 数据库迁移与初始模型 |
| #22 / #33 | 租户登录、认证与 tenant context |
| #23 | 订阅状态检查与扫码/发送门禁 |
| #24 | location 与人员映射只读 API |
| #25 | 扫码事件与固定邮件任务生成 API |
| #26 | mock/sandbox provider 与手动发送触发 API |
| #55 | 本地 seed 与 API smoke |
| #56 | MVP 登录与扫码工作台 |
| #60 | Frontend、Backend、PostgreSQL 本地容器组 |
| #57 | GUI 黑盒与 E2E smoke |
| #58 | Staging 部署、seed 与环境 smoke |

## 5. 实施依赖摘要

- 数据模型、认证与 tenant context 是订阅门禁、location 映射、扫码和邮件任务的前置。
- 订阅门禁和 location/person mapping 是扫码邮件任务生成的前置。
- 本地 seed、API smoke、GUI 与容器基线共同构成 Staging 验证前置。
- Staging 扩大测试范围前仍需备份恢复、集中监控告警、域名、TLS 与访问控制。
- 真实邮件 provider、Production 发布和自动化部署必须使用独立 Issue，并经过人工确认。

## 6. 历史编号说明

ADR-004 的 Follow-up 保留了 ADR 编写时的旧编号映射。后续实际拆分为 #20 CI、#21 数据库迁移、#26 sandbox mail provider、#33 认证与租户上下文。当前 Scope 始终以 GitHub Issue 为准。
