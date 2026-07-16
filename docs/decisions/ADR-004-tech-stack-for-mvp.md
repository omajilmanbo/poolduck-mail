# ADR-004：MVP 技术栈定版

- 状态：Accepted
- 日期：2026-05-25
- 相关 Issue：#17

## Context

在 ADR-001/002/003 已确认产品形态、扫码邮箱映射策略与租户隔离/订阅规则后，项目即将进入实现阶段。
当前文档对技术实现仍存在“可选项”（例如数据库类型、认证落地方式、邮件发送接入方式），如果不先定版，后续实现 Issue 可能出现以下问题：

- agent 或开发者各自选择不同框架，导致目录结构和编码风格不一致；
- 测试框架与 CI 管线难以统一，PR 可验证性下降；
- 在 MVP 阶段误接入真实邮件服务，增加误发与泄露风险；
- 租户隔离、权限、订阅校验等安全关键点缺少统一落地约束。

约束条件：

- 目前仅推进 MVP，优先可交付与低运维复杂度；
- 需保持与既有架构文档、数据库/API 草案一致；
- 邮件能力必须优先 sandbox/mock provider，真实供应商接入后置；
- 本阶段只做技术栈定版与文档对齐，不实现业务代码。

## Decision

MVP 技术栈统一如下：

1. 前端
   - 框架：Next.js（App Router）+ TypeScript
   - UI：Tailwind CSS + Headless UI（或 Radix UI，按组件可用性择一）
   - 状态与数据请求：React Query（TanStack Query）
   - 表单与校验：React Hook Form + Zod

2. 后端
   - 运行时与语言：Node.js 20 LTS + TypeScript
   - API：NestJS（REST）
   - 数据校验：class-validator + class-transformer（输入边界）
   - 鉴权：JWT（access token）+ 刷新 token 轮换策略（MVP 可先用短周期 access + 服务端可撤销 refresh）

3. 数据库
   - PostgreSQL 16
   - ORM：Prisma
   - 多租户策略：单库多租户（shared DB + tenant_id），并在 repository/service 层强制 tenant scope

4. 认证与授权
   - 登录方式：tenant_id + username(email) + password
   - 密码存储：Argon2id 哈希
   - 权限模型：RBAC（root_admin / manager）

5. 邮件 provider
   - MVP 默认 provider：Sandbox/Mock Mail Provider（仅记录发送请求与结果，不发真实邮件）
   - Provider 抽象接口在后端保留，真实 SMTP/第三方 API 接入作为后续 Issue

6. 测试框架
   - 前端：Vitest + Testing Library
   - 后端：Jest + Supertest
   - E2E（关键链路）：Playwright（登录→扫码→任务状态）

7. CI 基础方案
   - 平台：GitHub Actions
   - 最小流水线：
     - lint
     - typecheck
     - unit/integration tests
     - docs link / markdown 基础校验（可选）
   - 合并门禁：主分支需通过 CI，PR 必填测试结果

## Alternatives considered

1. 全栈使用 Python（FastAPI + Jinja/前后端同仓轻前端）
   - 优点：后端开发效率高，生态成熟。
   - 未选择原因：当前团队与既有文档更偏向 Web SaaS 分层前后端，且前端交互页需求明确，使用 Next.js + NestJS 更利于职责分离与后续扩展。

2. 后端使用 Go（Gin/Fiber）
   - 优点：性能高、二进制部署简单。
   - 未选择原因：MVP 阶段开发效率与脚手架完备性优先，TypeScript 全栈可减少上下文切换成本，测试与 DTO 校验体系更统一。

3. 邮件直接接入真实第三方（SendGrid/SES 等）
   - 优点：可直接验证真实投递链路。
   - 未选择原因：MVP 安全风险更高，且违反“优先 sandbox/mock provider”的阶段要求。

## Consequences

正面影响：

- 后续实现 Issue 的目录结构、依赖选择、测试与 CI 标准统一；
- 租户隔离/订阅校验等安全关键路径可在统一技术框架下落地；
- 通过 sandbox provider 降低误发邮件风险，便于本地和 CI 稳定测试。

负面影响：

- 技术选型灵活性下降，后续若切换栈会产生迁移成本；
- Next.js + NestJS + Prisma 对新成员有学习曲线；
- 需要在早期投入 CI 与测试基建工作，短期内增加文档与工程配置负担。

## Migration impact

- 对现有代码：当前仓库尚未初始化业务代码，无代码迁移成本。
- 对现有文档：需同步更新 `docs/architecture.md` 与 `README.md` 的技术栈描述。
- 对后续实现：Issue #18/#19 等实现任务必须遵循本 ADR，不得自行替换核心框架。

## Security impact

- 认证：采用 Argon2id + JWT，配合 token 生命周期与刷新策略，降低凭据泄露风险。
- 多租户：通过 tenant scope 强制约束查询，减少跨租户访问风险。
- 邮件：MVP 强制 sandbox/mock provider，避免真实误发与 PII 外泄。
- 审计：继续沿用既有架构要求，记录登录失败、权限拒绝、发送失败等关键事件。

## Operational impact

- 部署：需提供 Node.js 20 与 PostgreSQL 16 运行环境。
- CI：需建立 GitHub Actions 基础流水线并维护依赖缓存。
- 运维：MVP 不涉及真实邮件通道运维，但需保留 provider 抽象以便后续平滑接入。

## Follow-up

- Issue #18：初始化前端工程骨架（Next.js + TypeScript + Tailwind）。
- Issue #19：初始化后端工程骨架（NestJS + Prisma + PostgreSQL 连接配置）。
- Issue #20：认证与租户上下文中间件最小实现（遵循 ADR-003）。
- Issue #21：Sandbox Mail Provider 与邮件任务最小闭环。
- 更新 `docs/testing.md`：补充与本 ADR 对齐的测试分层与命令约定。
- 更新 `docs/deployment.md`：补充 Node/PostgreSQL 基础运行要求与 CI 约束。

> 历史编号说明（2026-05-27）：本节 Issue 编号反映 ADR 编写当时的计划，已不作为当前 Issue 映射。
> 后续实际拆分为 #20 CI、#21 数据库迁移、#26 sandbox mail provider、#33 认证与租户上下文。
> Issue 的当前 Scope 与状态以 GitHub Issue 为准；本说明只修正追溯口径，不改变本 ADR 的技术决策。
