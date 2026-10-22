# ADR-023 整租户删除与恢复本地验收（#166）

日期：2026-10-20。环境：本机隔离 PostgreSQL 临时数据库、合成 tenant/账号/历史、mock 邮件 provider。每个数据库脚本自行创建并删除随机命名数据库；未连接 Staging 或 Production，也未删除真实租户。

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| 平台认证、有效 Session、重新验密、普通租户无权调用平台接口、`active` 订阅拒绝删除；`trial/expired/suspended` 可删除并恢复原状态 | `test:tenant-deletion-acceptance`、`test:platform-delete-transaction`、后端 Jest | 通过 |
| Production 删除进入 `pending_delete` + `suspended`；登录和既有历史可读，新扫码及待发送邮件被阻断且 mock provider 未调用 | `test:tenant-deletion-acceptance` | 通过 |
| 恢复原 tenant/订阅状态、不延长原订阅；到期恢复拒绝，历史未改写 | `test:tenant-deletion-acceptance`、`test:platform-restore-transaction` | 通过 |
| 到期当前对象改非 PII 墓碑、历史与外键保留；失败回滚、重试、跨租户隔离 | `test:platform-tenant-purge-transaction`、`test:tenant-deletion-acceptance` | 通过 |
| 25 个合成租户、批量调度、双 worker、重启恢复、错误环境及结构化指标 | `test:platform-tenant-purge-scheduler` | 通过 |
| Staging 验密、订阅限制、全 FK 图物理删除、故障补偿、重放、环境隔离、其他租户不变 | `test:staging-tenant-deletion`、`test:tenant-deletion-acceptance` | 通过 |
| 生命周期迁移、闰日历年、重复部署、三层 rollback 对删除中状态的守卫与逆序回滚 | `test:tenant-lifecycle-migration`、`test:tenant-deletion-rollback` | 通过 |
| 平台控制台删除确认、窄屏键盘操作和一次性凭据清理 | `frontend/e2e/platform-control-plane.spec.ts`，本机 Webpack 服务 | 2/2 通过 |

质量门禁：Backend lint、typecheck、build、Jest **30 suites / 266 tests**；Frontend lint、typecheck、build、Vitest **7 files / 56 tests**，全部通过。完整 MVP Playwright 套件依赖另行准备的后端合成 seed；本次只运行平台控制台相关 2 项。直接使用 Next.js Turbopack 本地服务时 CSS 子进程崩溃并返回 500，改用 Webpack 本地服务后两项通过；前端 Production build 通过。

上线前仍需人工审核迁移/回滚、平台确认文案、Production 清理开关、Staging 物理删除开关及 Production 告警路由，并在目标隔离环境用合成数据复验。两个后台开关默认关闭；本次没有启用或部署。当前仅输出 `tenant_purge_metrics` / `tenant_purge_alert` 结构化事件，尚未部署 Production 告警资源。
