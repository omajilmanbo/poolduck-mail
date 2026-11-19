# 候选 a052518 的 P04 地点额度补验

2026-11-20（日本时间）。固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。本轮聚焦 #113 的实际额度并发与 P04 生命周期计数。此前顺序调额、暂停和恢复的证据见原平台报告。[#113](https://github.com/omajilmanbo/poolduck-mail/issues/113) · [矩阵 P04](business-requirements-matrix.md#P04) · [既有平台报告](candidate-platform-smoke-2026-11-19.md)

依据 ADR-013，平台维护的是人工地点额度。active、inactive、pending_delete 占额，终结为 purged 才释放。ADR-011 的 14 天恢复期和非 PII 墓碑语义继续有效。ADR-024 对历史保留的修订未改动上述额度或 14 天规则。[ADR-009](../decisions/ADR-009-defer-commercial-billing-from-mvp.md) · [ADR-011](../decisions/ADR-011-person-and-location-delayed-deletion.md) · [ADR-013](../decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md) · [ADR-024](../decisions/ADR-024-business-record-retention-and-destruction.md)

## 候选实测

从候选 Git archive 构建 Backend runtime。一次性 PostgreSQL 16、Nest 和 HTTP 客户端处于仅有 loopback 的网络命名空间，无宿主端口映射。环境使用 `APP_ENV=test`、`NODE_ENV=test`、`MAIL_PROVIDER=mock` 和 `REAL_MAIL_SEND_ENABLED=false`。`npm run db:deploy` 应用 21 项迁移，`npm run platform:admin -- bootstrap` 初始化合成平台账号，两个命令均退出 0。一个预先完成改密的合成租户经理以两个独立 Session 登录。本轮临时探针 `node p04-evidence.mjs` 退出 0，共七组检查通过。探针随实验清理。仓库自带的平台和清理器用例链接在下文。

两组并发各提交两次真实 HTTP 请求。独立 PostgreSQL 连接暂持候选使用的租户级事务 advisory lock，观察两个请求同时等待后释放。跨操作竞态接受任一符合不变量的执行次序。每阶段通过平台 HTTP 摘要和独立 SQL 对账，检查未终结地点用量不超过额度。[创建地点](../../backend/src/locations/locations.service.ts) · [平台调额](../../backend/src/platform/platform-tenants.service.ts) · [既有平台测试](../../backend/test/platform.spec.ts)

| 场景 | HTTP 与数据库结果 |
| --- | --- |
| 两次创建争用最后一个名额 | 从用量 1／额度 2 开始。一个请求返回 201，另一个返回 409 `LOCATION_LIMIT_REACHED`。只新增一个地点，最终用量 2／额度 2。租户审计各有一条成功与拒绝记录。 |
| 提额、旧版本请求和提额后新建 | 提额从 2 到 4 返回 200，版本从 1 到 2，成功审计关联请求 ID 和变更前后额度。旧版本调额返回 409 `PLATFORM_VERSION_CONFLICT`，额度、版本和用量不变。随后新建返回 201，用量 3／额度 4。 |
| 新建与降额同时发生 | 两个请求同时等待同一租户锁。起始用量 3／额度 4，降额目标 3。本轮新建返回 201，降额返回 409 `LOCATION_LIMIT_BELOW_CURRENT_USAGE`。最终用量 4／额度 4，版本仍为 2。 |
| 停用仍占额 | 停用返回 200，数据库为 inactive，平台摘要仍为用量 4／额度 4。再建返回 409 `LOCATION_LIMIT_REACHED`。 |
| 待删除仍占额 | 安排删除返回 201，数据库为 pending_delete，HTTP 的删除时间、截止时间与数据库一致，两者相差 14 天。用量仍为 4／4，再建返回 409 `LOCATION_LIMIT_REACHED`。 |
| 到期终结释放一个名额 | 将真实删除请求持久化的 `purge_after` 用作现有清理器的受控时间输入。截止前 1 ms 处理 0 个，仍满额。恰好截止时处理 1 个，保留同一地点码的 purged 墓碑，用量降为 3／4。随后以原名称新建返回 201，生成不同地点码，用量回到 4／4。停用、安排删除和终结各有一条成功审计。 |

14 天场景在真实 HTTP 安排删除后，直接调用候选的 `DeletionPurgeService.processDueDeletions(requestedNow)`，数据库实际执行筛选和终结事务。该步骤使用已保存截止点的毫秒值，无需改变宿主或数据库系统时钟。[清理器](../../backend/src/locations/deletion-purge.service.ts) · [既有清理器用例](../../backend/test/deletion-purge.spec.ts)

独立最终 SQL 确认额度 4、用量 4、purged 墓碑 1、平台版本 2、成功调额审计 1。邮件任务与投递尝试均为 0。专用容器、卷、临时镜像标签及探针文件已回收，剩余容器、卷和镜像标签均为 0。

## 缺口

旧版本调额和低于当前用量的并发降额均带请求 ID，平台审计分别查得 0 条。拒绝语义与数据不变量已通过，但这两次拒绝无法按请求 ID 关联平台审计。高影响额度调整的审计缺口由 [#209](https://github.com/omajilmanbo/poolduck-mail/issues/209) 跟踪。两类 409 的 HTTP 与业务数据结果已分别核对。#192 涉及 CLI 成功操作，#207 涉及租户开通失败。[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192) · [#207](https://github.com/omajilmanbo/poolduck-mail/issues/207)

### #209 的独立修复分支

[PR #210](https://github.com/omajilmanbo/poolduck-mail/pull/210) 的 `b59a446` 直接基于 `a052518`，核对时尚待合并。旧版本与低于当前用量仍分别返回原错误码和 HTTP 409。按请求 ID 对账，审计可写时两类拒绝各有一条 `platform.location_limit.update` / `denied`。撤销审计 INSERT 权限后两类请求仍各返回原 409，各查得 0 条，额度、用量和版本保持原值。恢复权限后合法调额返回 200，留下一条成功审计。[修复提交](https://github.com/omajilmanbo/poolduck-mail/commit/b59a44638808b9ad41b59fdabc5f0c13dfef2a64)

分支本地的 HTTP 与 SQL 对账在临时 PostgreSQL 16.16 中载入候选演练库的 `pg_dump --schema-only` 空表结构，无业务数据或迁移历史。该次对账没有从空库重放迁移。分支定向测试 36/36、后端全套 284/284 通过，远端五项 CI 全部通过。固定候选的两次拒绝仍各缺一条审计。[分支 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44564841090)

## 未验

本轮响应与数据库状态对应创建先落库的执行次序。另一合法结果是降额成功、创建因满额被拒，该次序未取样。额度 1 的单独场景、满额时重新启用或恢复，以及自动调度等待均未复验。
