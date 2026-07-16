# ADR-005：Staging 部署触发与恢复策略

- 状态：Accepted
- 日期：2026-07-10
- 相关 Issue：待建（Staging 可重复部署脚本与人工审批触发）

## Context

OCI Staging 的基础设施由 Terraform 创建，cloud-init 当前负责安装 Docker、配置用户与防火墙并创建应用目录，不负责克隆应用仓库、注入真实 secrets 或启动应用容器。

此前 Staging 首次部署和 VM 重建后，应用部署由操作者或 Agent 通过 SSH 执行：准备仓库与 `.env`、运行 Docker Compose、执行 migration/seed 和 smoke。由于最终使用者没有亲自输入命令，这一过程容易被误认为是 cloud-init 自动部署。

需要同时满足以下约束：

- 实例重建后可以重复恢复 Staging，不依赖临时记忆或零散命令。
- cloud-init 失败不能与应用发布失败混成一个难以重试的步骤。
- Staging secrets 不进入 Terraform user data、Git 仓库或日志。
- 部署前保留人工确认，避免误操作 Production、真实数据或真实邮件 provider。
- 自动化步骤失败时，仍有可审计的人工恢复路径。

## Decision

采用“cloud-init bootstrap + 部署步骤自动化 + 人工审批触发 + 手动恢复 Runbook”的混合方案：

1. cloud-init 只负责主机 bootstrap：安装 Docker/Compose、配置系统用户与目录、启用基础防火墙；不克隆应用、不注入真实 secrets、不运行应用 Compose。
2. Staging 应用部署由独立、幂等的部署脚本承担。脚本应检查目标环境和 `.env`、确认 Git commit、执行 `docker compose config`、构建/启动服务、应用 migration、按需写入合成 Staging seed、执行健康检查与 smoke，并返回明确结果。
3. 当前阶段由人工批准后，再由操作者或 Agent 通过 SSH 触发部署。部署脚本尚未实现前，以 `docs/staging-manual.md` 的命令链作为当前可执行路径。
4. 人工 Runbook 永久保留，并与部署脚本步骤保持一致；用于脚本失败、部分服务恢复、环境排障和回滚。
5. 部署脚本稳定后，可在独立 Issue 中接入 GitHub Actions `workflow_dispatch`，继续保留环境审批。当前不启用 merge-to-main、tag 或无审批自动发布。
6. Production 发布方式不由本 ADR 决定，必须在独立 ADR/Issue 中评估 secrets、备份、回滚、监控和发布门禁。

## Alternatives considered

1. 在 cloud-init 中完成完整应用部署
   - 未选择：网络、包、Git、镜像构建、secrets 或应用启动任一步失败，都可能形成“基础设施已创建但应用只完成一部分”的状态；重试和单独发布应用也不方便。
2. 长期依赖人工逐条执行 Compose 命令
   - 未选择：容易遗漏配置检查、migration、health check、smoke 或部署记录，重复性不足。
3. `main` 合并后立即自动部署
   - 未选择：当前备份、监控、TLS、正式 secret store 和回滚门禁尚未完备，自动触发风险过高。

## Consequences

正面影响：

- 主机初始化与应用发布职责清晰，失败可以独立重试。
- 日常部署步骤可重复、可审计，同时保留人工审批。
- Runbook 与脚本共用同一操作顺序，降低自动化失效时的恢复成本。
- 后续迁移到 `workflow_dispatch` 时无需重写核心部署逻辑。

负面影响：

- 需要新增并维护部署脚本及其验证测试。
- 部署脚本落地前，仍需要操作者或 Agent 按 Runbook 执行 SSH/Compose 命令。
- Runbook、脚本和未来 workflow 必须同步维护，避免再次漂移。

## Migration impact

- 本 ADR 不修改数据库 schema、运行中容器或 OCI 资源。
- 现有 cloud-init 保持 bootstrap-only 行为。
- 当前文档恢复为“人工批准、操作者/Agent 触发”的真实部署口径。
- 后续 Issue 实现部署脚本后，再把手册中的命令链改为脚本入口，并保留底层恢复命令。

## Security impact

- 真实 secrets 不进入 cloud-init、Terraform state、Git、Issue、PR 或部署日志。
- 部署脚本只能读取已批准的 Staging `.env`/secret source，不打印 secret 值。
- 部署前必须确认目标为 Staging、邮件 provider 为 mock/sandbox、数据库不含 Production 或客户数据。
- SSH、GitHub Environment 和未来 workflow 权限遵循最小权限原则。

## Operational impact

- cloud-init 日志用于主机 bootstrap 排障；应用部署日志由部署脚本或 Runbook 单独记录。
- 部署结果必须包含 commit SHA、Compose 状态、migration、health check、smoke 和阻塞项。
- 脚本失败时不得反复重建 VM，应先根据 Runbook 定位配置、Docker、数据库或应用问题。
- 后续接入 `workflow_dispatch` 前，必须验证脚本幂等性、失败退出码和恢复路径。

## Follow-up

- 创建工程改进 Issue：实现 Staging 幂等部署脚本及最小测试。
- 脚本实现后更新 `docs/deployment.md`、`docs/staging-manual.md` 和 `docs/issue-archive.md`。
- 单独评估 GitHub Actions `workflow_dispatch`、Staging Environment 审批与 secrets 权限。
- 在备份、监控、TLS 和回滚策略完备前，不启用无审批自动发布。
