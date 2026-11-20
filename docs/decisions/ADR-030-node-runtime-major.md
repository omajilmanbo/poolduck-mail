# ADR-030：首次生产部署的 Node.js 主版本

- 状态：Proposed
- 日期：2026-11-20
- 相关 Issue：[#225](https://github.com/omajilmanbo/poolduck-mail/issues/225)

## Context

ADR-004 指定 Node.js 20 LTS。正式候选 `a052518` 的前后端 Dockerfile 各有两处 Node 20 基础镜像，CI 四个作业也使用 20。上游对 20 的维护已于 2026-04-30 结束。后端锁定的 `@prisma/streams-local@0.1.2` 声明 `engines.node >=22.0.0`，历史 Node 20 构建出现了相应的 `EBADENGINE` 警告。[现行 ADR-004](ADR-004-tech-stack-for-mvp.md) · [Node.js 官方维护计划](https://github.com/nodejs/Release/blob/main/schedule.json)

## Decision

建议项目负责人选择 **D20 A，采用 Node.js 24 LTS**，统一前端构建与服务、后端构建与服务、CI 及本地开发的 Node 主版本。若接受，仅取代 ADR-004 的 Decision 第 2 项和 Operational impact 部署项中指定 **Node.js 20** 的部分。

24 和 22 在同一候选的 Windows 换行检出上通过完整本机矩阵，两份锁文件的 JSON 与 Git 原件完全一致。按 Git 原始字节复验时四份应用编译成功，宿主盘耗尽中断了 Node 22 后端镜像解包和两组运行复验。24 的上游维护期比 22 多一年。负责人也可选择 **D20 B，采用 Node.js 22 LTS**。选 B 时先将草案目标改为 22，再记录接受决定。[冻结候选验证回执](../testing/issue-225-node-runtime-2026-11-20.md)

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

接受后，按最终候选及部署目标架构重建前后端，记录源码、基础镜像与应用镜像摘要，执行完整 CI 和 PG16 mock 冒烟。若首发前任一门禁失败，停止提升该候选，保留上次已验证工件并排查。若在已有环境切换后发生回归，按已批准的部署流程成对恢复该环境先前获准的前后端镜像摘要，复查健康、登录与队列。首次生产尚无可恢复版本时维持暂缓发布。运行时回退无需逆向迁移或重放邮件。[部署与恢复决策](ADR-005-staging-deployment-trigger-and-recovery.md)

## Follow-up

1. 项目负责人答复 D20 A 或 B，记录选择与日期。本草案在人工接受前保持 Proposed。
2. 接受后单独实施。同步两份 Dockerfile、CI 的 backend、frontend、adr017-release-gate 和 e2e 作业，并核对后端 `engines.node` 与锁文件根元数据。更新架构、开发和部署说明，在 ADR-004 标注部分取代关系。
3. 在实施提交上跑完整 CI，包含数据库并发与回滚门禁、Playwright 成功和失败两条路径。按所选主版本在维护截止前安排下一次评估。正式发布由负责人另行批准。
