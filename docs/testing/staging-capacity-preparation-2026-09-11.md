# Issue #116 容量测试准备记录（2026-09-11）

本记录只证明环境和工具准备，不包含容量结论，也未执行并发阶梯或 provider failure 测试。

## 环境核验

| 项目 | 结果 |
|---|---|
| 应用 commit | `eabdeb54322b2222507cc5f6444d8c86b83b2b05` |
| OCI Staging | 2 OCPU、11932 MiB 内存 |
| 根分区 | 97 GB，总用量 17%，可用约 82 GB |
| Compose | backend/frontend/PostgreSQL/Caddy 均 healthy |
| 环境/provider | `staging` / `mock` |
| Terraform | 完整 refresh plan 为 No changes |

实时规格与 Terraform 配置一致。上述资源空闲值仅是准备时快照，不能当作压测基线或容量证据。

## 工具验证

- 容量参数/分位数/动作码/目标保护测试：4/4 通过。
- `capacity:plan`：默认 1/5/10/20/40/50 阶梯可解析，输出不含密码。
- 后端 lint、typecheck：通过。
- 后端回归：25 suites / 176 tests 通过。
- Terraform `fmt -check`、`validate`：通过。
- Staging 监控采集器单次 dry-run：成功记录 host 与四个容器的 CPU、内存、网络、block IO、PIDs；
  未记录邮箱、token、动作码或内部业务 ID。
- 本地 Docker Desktop 未运行，因此未执行本地 API/数据库 seed dry-run；正式 Staging seed 和 1 用户
  负载必须等本分支合并、部署后按 Runbook 执行，不能复制未审查脚本绕过发布流程。

## 尚未执行

- 未创建容量 tenant/operator/person 数据；
- 未运行 1 用户、steady、burst 或 mixed 负载；
- 未切换 `MAIL_MOCK_SEND_RESULT=failure`；
- 未安装常驻监控组件、创建告警或产生付费资源；
- 未访问 Production、真实数据或真实邮件 provider。

正式执行前仍需人工批准无其他使用者的测试窗口和 provider failure 临时切换。执行步骤、停止条件、
脱敏和恢复检查见 [容量测试 Runbook](staging-capacity-runbook.md)，结果使用
[容量结果模板](staging-capacity-result-template.md)。
