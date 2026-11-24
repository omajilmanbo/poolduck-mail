# 候选 a052518 租户生命周期数据库补验

2026-11-19（日本时间）。测试对象为 `origin/main` 候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。五个补验入口均退出 0。对应要求及剩余门禁见[业务矩阵的租户生命周期条款](business-requirements-matrix.md#RET01)。

## 已有的候选证据

- 候选 CI 的 PostgreSQL 门禁已通过生命周期迁移及其单层回退守卫、日常保留事务、租户终结事务、十万关联行和 ADR-017 并发、SLO 与回退验证。本轮沿用对应结果。[CI 44474610784 数据库作业](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135392615224)
- 本机部署演练已对同一候选运行 `tenant-deletion-acceptance-test.mjs`，退出 0，覆盖 HTTP 平台与租户鉴权、删除后的订阅及扫码/邮件门禁、恢复、到期终结及即时删除。[同一候选的部署演练记录](https://github.com/omajilmanbo/poolduck-mail/blob/012f85cfb98ffe316d87ff996e8c8f8f386ed7cd/docs/testing/first-deployment-rehearsal-2026-11-19.md)

## 本轮实测

在独立工作树从候选 Git archive 构建测试镜像，沿用仓库 Dockerfile 的构建阶段并复制候选测试脚本。环境为本机 Docker、Node.js 20.20.2 和 PostgreSQL 16.16。数据库数据目录使用临时内存文件系统，服务仅监听其容器的 `127.0.0.1:5432`，未发布宿主机端口。测试进程共享数据库容器的网络命名空间，核实其中只有 loopback，且入口配置为 `APP_ENV=test`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。脚本先检查测试环境和本机地址，再用专用实例内的 `postgres` 库创建独立的随机合成库，在其中迁移和执行业务断言，最后删除该库。脚本内的 `production` 和 `staging` 仅用于选择本地业务分支。

| 在候选 `backend/` 中执行 | 退出码 | 耗时 | 相对于已有证据补齐的场景 |
| --- | ---: | ---: | --- |
| `npm run test:platform-delete-transaction` | 0 | 3.73 秒 | 并发删除只写入一次并重放原时间戳，订阅更新与删除竞态下保持一致，active 订阅拒绝删除，注入失败后回滚。 |
| `npm run test:platform-restore-transaction` | 0 | 3.49 秒 | 固定 SQL 时间戳验证截止前 1 ms、恰好截止及后 1 ms 的严格比较，恢复与模拟清理认领的条件更新竞争、并发恢复只成功一次，恢复原状态且不解除独立人员/地点删除、不给已过期订阅续期、不重排失败邮件，注入失败后回滚。 |
| `npm run test:platform-tenant-purge-scheduler` | 0 | 3.66 秒 | 25 个合成租户由两个 worker 首轮处理 20 个，重建调度器后处理剩余 5 个，仅产生 25 条成功审计。另注入一个事务失败并验证重试、错误环境拒绝和结构化日志。 |
| `npm run test:staging-tenant-deletion` | 0 | 4.67 秒 | 验密及开关、环境与 active 订阅门禁。注入外键图删除失败后验证 `staging_deleting`、暂停订阅和禁止当前对象写入，解除故障后补偿清理完整关联，保留单条脱敏结果审计，验证重放及另一租户不受影响。 |
| `npm run test:tenant-deletion-rollback` | 0 | 1.15 秒 | `staging_deleting` 阻挡即时删除写入守卫回退，`pending_delete` 分别阻挡当前对象写入守卫和生命周期迁移回退。清除合成删除状态后，按逆序执行三层回退并验证生命周期列已移除。 |

每个命令运行后，数据库清单与初始清单的差异均为 0。起始库最终仍有 0 张 public 表。测试及数据库容器、临时测试镜像标签和构建目录已清理，本轮标记下剩余容器和卷均为 0。恢复事务运行时出现一条 `pg` 的并发 `client.query()` 弃用警告，相关断言全部通过，记为非阻塞观察。

## 待补的目标环境证据

目标环境的部署后合成演练、清理开关与告警路由仍须按原验收要求复核。Production 清理启用仍需人工放行，备份副本的保留与销毁仍属独立决策。本轮未连接 Staging 或 Production，未发送真实邮件，未使用客户数据。[ADR-023 合成验收](tenant-deletion-acceptance-2026-10-20.md) · [ADR-024 发布执行卡](adr024-release-acceptance.md)
