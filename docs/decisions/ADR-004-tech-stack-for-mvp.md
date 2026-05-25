# ADR-004：MVP 技术栈定版（Cloudflare 方案）

- 状态：Proposed
- 日期：2026-05-25
- 相关 Issue：#17

## Context

进入实现前，需要锁定统一技术栈，避免后续目录结构、运行时与部署目标分裂。
上一个版本 ADR 已给出 Node/NestJS 方向，但本轮经产品与工程侧讨论，MVP 目标改为优先 Cloudflare 原生栈，以降低基础设施运维复杂度并提升边缘部署效率。

约束与前提：

- 仍处于 MVP 阶段，必须优先可交付与低运维复杂度；
- 邮件能力在 MVP 期间不得默认直连真实生产通道，需通过可控 adapter 与环境隔离；
- 保持既有租户隔离、订阅状态门禁、固定邮件正文规则不变；
- 本阶段仅完成技术栈定版与文档对齐，不实现业务代码。

## Decision

MVP 技术栈统一为 Cloudflare 方案：

1. 平台与前端托管
   - Cloudflare Pages / Workers Static Assets
   - 前端静态资源由 Cloudflare 边缘网络分发

2. 后端 API
   - Cloudflare Workers API
   - 采用 Workers 运行时提供 REST API

3. 数据库
   - Cloudflare D1
   - 延续单库多租户逻辑隔离（tenant_id）策略

4. 异步任务
   - Cloudflare Queues
   - 邮件发送任务通过队列异步消费，避免同步阻塞

5. 邮件 Provider 抽象
   - Mail Provider Adapter（统一接口）
   - 可选后端供应商：AWS SES / OCI Email Delivery / Gmail API
   - MVP 默认使用 sandbox/mock adapter（非生产真实投递）

6. 认证与授权
   - 继续采用 JWT + RBAC（root_admin / manager）
   - tenant scope 由认证上下文注入，不允许前端切换 tenant

7. 测试与 CI 基线
   - 单元/集成/E2E 测试策略保持既有文档分层
   - CI 维持最小门禁：lint、typecheck、tests、文档一致性检查

## Alternatives considered

1. Node.js + NestJS + PostgreSQL + Prisma
   - 优点：生态成熟、工程模板丰富。
   - 未选择原因：与本轮 Cloudflare 原生部署目标不一致，平台整合复杂度更高。

2. Cloudflare + 同步直发邮件（无队列）
   - 优点：链路更短，初期实现更快。
   - 未选择原因：易受上游邮件接口抖动影响，不利于重试与失败隔离。

## Consequences

正面影响：

- 平台栈统一到 Cloudflare，部署入口更集中；
- Workers + Queues 更适合扫码后异步邮件任务模型；
- Provider adapter 降低后续切换 AWS SES / OCI / Gmail API 成本。

负面影响：

- 团队需熟悉 Workers/D1/Queues 的运维与调试模式；
- D1 能力边界与传统数据库能力存在差异，后续设计需谨慎评估。

## Migration impact

- 当前仓库尚未初始化业务代码，无代码迁移成本；
- 需要同步更新 `docs/architecture.md` 与 `README.md` 技术栈描述；
- 后续实现 Issue（#18/#19 等）须遵循本 ADR，不得偏离 Cloudflare 方案。

## Security impact

- 多租户隔离策略不变：tenant scope 强制注入，默认拒绝跨租户访问；
- 邮件能力通过 adapter + 环境隔离控制，降低误发与敏感信息泄露风险；
- 关键审计项（登录失败、权限拒绝、发送失败）继续保留。

## Operational impact

- 运行环境聚焦 Cloudflare（Pages/Workers/D1/Queues）；
- 需要建立 Cloudflare 资源配置与发布流程规范；
- 邮件供应商凭据按环境分离管理，生产凭据禁止用于开发/测试环境。

## Follow-up

- Issue #18：初始化前端（Pages/Static Assets 适配）
- Issue #19：初始化 Workers API 与 D1 连接
- Issue #20：接入 Queues 邮件任务异步处理
- Issue #21：实现 Mail Provider Adapter（AWS SES / OCI / Gmail API）与 sandbox/mock 默认策略
- 更新 `docs/deployment.md`：补充 Cloudflare 部署与环境配置流程
- 更新 `docs/testing.md`：补充 Workers/D1/Queues 测试约定
