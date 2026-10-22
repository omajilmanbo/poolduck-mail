# ADR-024 合成验收与发布执行卡（#176）

本卡只覆盖在线业务数据库。Production 清理开关保持默认关闭；生产启用、真实客户数据清理与备份生命周期均须另行人工发布审核。以下测试仅使用合成地址和本地/CI PostgreSQL，邮件 provider 保持 mock，不调用真实发信端点。

## 1. 当前验收记录（2026-10-22）

| 检查 | 命令 | 本地结果 |
| --- | --- | --- |
| Backend 构建、Prisma schema、类型与 Lint | `npm --prefix backend run build`、`db:validate`、`typecheck`、`lint` | 通过 |
| Backend 全量 Jest | `npm --prefix backend test -- --silent` | 30 套、269 项通过 |
| 平台审计鉴权、筛选、游标、敏感字段 | `npm --prefix backend test -- platform.spec.ts` | 25 项通过 |
| Frontend 全量 Vitest、类型与 Lint | `npm --prefix frontend test`、`typecheck`、`lint` | 8 文件、61 项通过；类型与 Lint 通过 |
| 平台审计页面筛选、翻页、空结果与失败 | `npm --prefix frontend test -- platform-audit.test.tsx` | 2 项通过 |
| 清理迁移、闰日 TTL、冻结/恢复、失败回滚、租户隔离 | `npm --prefix backend run test:record-retention` | 未运行：本机无可用 PostgreSQL |
| Production 到期租户终结与 10 万关联行 | `npm --prefix backend run test:platform-tenant-purge-transaction`、`test:tenant-retention-large` | 未运行：本机无可用 PostgreSQL |
| 删除/恢复 HTTP、Staging 立即清理与权限 | `npm --prefix backend run test:tenant-deletion-acceptance` | 未运行：本机无可用 PostgreSQL |

数据库测试全部通过且审核计数、告警路由、回滚路径后，才能把本卡标为已验收。不得把本地编译通过写成数据库验收完成。

## 2. 合成验收矩阵

| 场景 | 必须观察到的结果 | 覆盖入口 |
| --- | --- | --- |
| 未到期与恰好一日历年，含闰日 | 截止前不清理，截止时按数据库时间可清理 | `test:record-retention` |
| `waiting`/`queued`/`processing` 与未完成尝试 | 日常扫码家族跳过；无 provider 调用 | `test:record-retention` |
| `delivery_unknown` 的陈旧认领 | 缺少调用关闭证明时保留并报警；确认后不改写投递状态而可清理 | `test:record-retention`、`platform.spec.ts`、`mail-job-retry.spec.ts` |
| `pending_delete`、截止前恢复 | 删除窗口冻结既存记录；恢复后超期行立即重新成为候选 | `test:record-retention` |
| Production 到期终结 | 先销毁扫码、邮件、回执、幂等、业务审计，再写非 PII 墓碑；平台结果审计保留 | `test:platform-tenant-purge-transaction`、`test:tenant-retention-large` |
| 故障与重试 | FK 或触发器错误回滚整批，不留下半清理；修复后可重试 | `test:record-retention`、`test:platform-tenant-purge-transaction` |
| 平台/租户权限 | 平台审计只允许有效平台 Session；租户 token、失效 Session、非法游标拒绝；平台不读租户业务审计 | `platform.spec.ts` |
| 邮件目标与敏感信息 | 只用合成目标；不发真实邮件；API 不返回完整邮箱、正文或任意元数据 | `mail-job-retry.spec.ts`、`platform.spec.ts` |
| Staging 删除 | 立即删除，保留安全平台结果；没有一年恢复窗口 | `test:tenant-deletion-acceptance` |

## 3. 发布前与灰度

1. 核对合并的 ADR-024、迁移版本、审核过的目标环境、备份责任和恢复演练状态。备份副本的保留/清除规则尚未设计，不能宣称其已销毁。
2. 在本地/CI PostgreSQL 执行上表未运行的合成脚本，保存命令、退出码、耗时与无 PII 结果。`test:tenant-retention-large` 使用 25,000 个扫码家族、共 100,000 个关联行核对容量和事务完成时间。
3. Production 部署先应用只扩展 schema 的 `20261022000000_record_retention_scan_indexes`，保持 `RECORD_RETENTION_PROCESSOR_ENABLED=false`。确认迁移本身未删除行，查看 `backend/prisma/rollback/20261022000000_record_retention_scan_indexes.sql` 的索引回滚守卫。
4. 使用 `npm --prefix backend run retention:counts` 在启用前和每个灰度阶段取得只含内部 tenant UUID、状态和各类行数的只读快照。按 tenant 与记录类型核对到期量、`pending_delete` 冻结量、未知投递阻断量，不把姓名、邮箱、正文或原始载荷导出到验收材料。
5. 经单独发布审核后，以 `RECORD_RETENTION_BATCH_SIZE=1` 启动并观察，再按 `10`、`100` 逐阶段扩大。这个上限分别作用于每分钟的扫码家族、业务审计和平台审计；当前清理器按全局到期顺序选取，不支持限制特定 tenant，不能把批量灰度解释成单租户灰度。每阶段按 `record_retention_metrics` 的成功、阻断、积压、最老逾期秒数和失败数核对前后快照。配置只接受 1–100 的整数；无效值停止清理器并告警。
6. 告警路由须接收 `record_retention_alert`、`tenant_purge_alert`；出现 `UNSAFE_MAIL_FAMILY_OVERDUE`、`BACKLOG_OVERDUE`、`AUDIT_WRITE_FAILED`、事务错误或计数异常即停止扩大范围，依据内部 ID 排查。`delivery_unknown` 的调用关闭证明缺失时继续保留并人工核实，不能为了清理修改投递状态。
7. 停用时设 `RECORD_RETENTION_PROCESSOR_ENABLED=false` 并重启 Backend，确认没有清理事务在途；保留已迁移 schema 与业务门禁。索引回滚仅在清理停止后经显式数据库守卫执行；已销毁的行不能靠应用或索引回滚恢复。Production 租户终结处理器另由 `TENANT_PURGE_PROCESSOR_ENABLED` 控制，必须单独核对与批准。

## 4. 对外说明与保留边界

管理员操作手册和产品文案应写明：Production 在线扫码、邮件和审计在清理器启用后按一日历年到期销毁；删除窗口冻结当时尚存记录，恢复后超期记录立即重新进入清理候选；当前基本对象终结时保留非 PII 墓碑；Staging 删除立即生效且不可恢复。若清理器仍关闭，不能把目标规则描述成正在执行的现状。Production 备份生命周期另议。
