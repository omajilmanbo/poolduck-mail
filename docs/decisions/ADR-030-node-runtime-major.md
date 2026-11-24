# ADR-030：首次生产部署的 Node.js 主版本

- 状态：Accepted
- 日期：2026-11-24
- 相关 Issue：[#225](https://github.com/omajilmanbo/poolduck-mail/issues/225)

## Context

ADR-004 指定 Node.js 20 LTS。正式候选 `a052518` 的前后端 Dockerfile 各有两处 Node 20 基础镜像，CI 四个作业也使用 20。上游对 20 的维护已于 2026-04-30 结束。后端锁定的 `@prisma/streams-local@0.1.2` 声明 `engines.node >=22.0.0`，历史 Node 20 构建出现了相应的 `EBADENGINE` 警告。[现行 ADR-004](ADR-004-tech-stack-for-mvp.md) · [Node.js 官方维护计划](https://github.com/nodejs/Release/blob/main/schedule.json)

## Decision

2026-11-24，项目负责人批准 **D20 A，采用 Node.js 24 LTS**。前端构建与服务、后端构建与服务、CI 及本地开发统一使用 24。此决定仅取代 ADR-004 的 Decision 第 2 项和 Operational impact 部署项中的 Node.js 主版本。

Staging 与将来的生产使用同一版本。生产只可晋级最新一次实际通过 Staging 验收的候选提交及其前后端镜像对，按不可变标识复用相同工件。任何补丁更新、应用改动或重新构建均形成新的候选，须先经过 Staging 验收。本次实施范围为 Staging 功能与发布模板。生产建设和发布须另行批准。

24 与 22 在同一冻结候选上均通过两端单测、PG16 迁移、登录、授权扫码、取消及 mock 发送。选择 24 可多获得一年的上游维护期。这些本地结果用于兼容性决策，实际 Staging 发布另记环境、工件及验收回执。[冻结候选验证回执](../testing/issue-225-node-runtime-2026-11-20.md)

## Alternatives considered

| 选项 | 上游计划维护至 | 决策依据 |
| --- | --- | --- |
| A · Node 24 | 2028-04-30 | 实测 24.22.3，现有锁文件可安装，两端编译、测试及 mock 链路通过。较长的维护窗口适合首次上线。 |
| B · Node 22 | 2027-04-30 | 实测 22.23.5，通过同一矩阵，与 20 相隔一个 LTS 主版本。选 B 需在 2027 年 4 月前安排下一次迁移。 |
| 维持 Node 20 | 2026-04-30 | 20.20.2 的原始镜像有成功构建和冒烟记录，但上游安全维护已经结束，且存在锁定依赖的引擎警告。 |

## Consequences

24 和 22 都满足上述引擎声明。24 镜像附带 npm 11.19.1，安装日志提示前后端共六个依赖的生命周期脚本未配置 `allowScripts`；本轮安装、Prisma 生成、Argon2 登录和前端编译均成功。若后续 npm 策略改变，应按届时锁文件逐项验证这些脚本。22 镜像附带 npm 10.9.9。

## Migration impact

实施面限于运行时及其版本声明和说明。沿用 Debian Bookworm slim、PostgreSQL 16、现有 Prisma schema、迁移及依赖版本。两组实验各从空库应用 21 项既有迁移，数据库中完成的名称逐一匹配源码。已有数据的备份和恢复按实际部署流程执行。

## Security impact

采用受维护的主版本可继续取得上游修复，仍需更新补丁版本和重建镜像。合成操作员登录后只见一个授权地点，跨租户地点及未映射动作码均返回 404，数据库新增任务为零。真实发送开关关闭，取消任务调用 provider 零次，另一笔任务得到一条 mock 回执。

## Operational impact

本地已实测 24→22 和 22→24 成对切换，两组各自保留原 PG16 卷。Staging 发布模板按同一候选及目标架构构建一次，记录提交、前后端镜像标识、平台与实际 Node 版本。通过完整 CI 后，由操作者在获准窗口验收健康、登录、扫码与 mock 任务，保存结果。验收失败时沿用上次通过的工件对，复查健康、登录与队列。[部署与恢复决策](ADR-005-staging-deployment-trigger-and-recovery.md)

## Follow-up

1. #225 单独实施两份 Dockerfile、前后端运行时声明、四个 CI 作业、开发说明及 Staging Compose 发布模板。
2. 在实施提交上执行完整 CI，包含数据库并发与回滚门禁、Playwright 成功和失败两条路径，验证按同一候选与镜像对重复启动。
3. 在 Node 24 上游维护截止前安排下一次主版本评估。
