# Staging 部署记录：ADR-023 租户删除与恢复（2026-10-20）

- 关联 PR：#168，叠加在 #167 / #156 之上。部署应用提交 `158eeeaafbe2984d103dbcec1b45b2fe3d04d4a3`；未合并 `main`。
- 目标：既有 OCI Staging 主机 `app01`，`https://app.poolducktest.com`。部署前应用为 `7c8bb9e`；仅重建并切换 Backend/Frontend，PostgreSQL、Caddy 和数据卷未重建。
- 部署前配置：`APP_ENV=staging`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`；`STAGING_TENANT_DELETE_ENABLED` 与 `TENANT_PURGE_PROCESSOR_ENABLED` 未设置，均保持默认关闭。`.env` 权限为 600；未读取或记录密钥值。
- 部署前回退快照：VM 本地 `backups/pre-deploy-20261020-issue168.dump`，33,720,810 bytes、权限 600；`pg_restore -l` 验证可读，SHA-256 `3ae5304679920163d85d0e18d4cc52b62d355cb547759b8cf9cf37f08f8e8fe4`。这是本次部署的安全快照，不承诺 Staging 数据保留期；本次未接触 Production 数据。
- 发布门禁：PR #168 的 Backend、Frontend、ADR-017 PostgreSQL 和两项 Critical E2E CI 均通过；本地 #166 验收见 [验收记录](tenant-deletion-acceptance-2026-10-20.md)。Staging `docker compose config --quiet` 与 Caddy 配置校验通过，两个应用镜像从上述提交构建成功。
- 数据库：Backend 启动时执行 Prisma migrate；随后 `npm run db:deploy` 报告 19 个 migration、无待应用项。Staging 租户 `status` 聚合为 `active: 8`，未见 `pending_delete`、`purged` 或 `staging_deleting`。
- 合成 smoke：幂等 `staging:seed` 通过；Backend 内网 `npm run smoke:api` 通过，邮件状态 `waiting → canceled`、重新扫码 `sent`，取消任务 0 次 provider 调用，重新扫码 1 次 mock provider 调用，数据库检查通过。
- 公网：`/`、`/platform`、`/health`、`/healthz` 均为 HTTPS 200 且 TLS 校验通过；HTTP 首页 308 跳转 HTTPS。平台页返回 CSP、HSTS、`nosniff`、`X-Frame-Options: DENY`；外部访问 3000、3001、5432 均未建立连接。已部署平台页面 Playwright 用例 2/2 通过，API 为测试拦截，不操作真实平台租户。
- 最终状态：Backend、Frontend、PostgreSQL、reverse-proxy 均 healthy；Backend 运行配置仍为 mock/false。Staging 物理删除入口未启用，未执行删除或恢复真实租户。
- 回滚：保留上述数据库备份及所有 Compose 卷，代码回到前一个已验证提交 `7c8bb9e`，只重建 Backend/Frontend，并复核迁移兼容性、健康和 smoke。若数据库已有租户进入删除流程，保留生命周期字段及门禁，遵循 `docs/operation.md`，不得直接撤销迁移或重新开放业务。本次未执行回滚。

## Staging 删除入口纠正

初次部署把 `STAGING_TENANT_DELETE_ENABLED` 留为关闭，与用户要求开放 Staging 即时删除不符。用户再次明确要求开放，并确认 Staging 中 4 个非 `.example.local` 邮箱均为获批的受控测试地址。修正提交 `5072c8914236528d87ee6b8624d653f8699e139b` 将该开关从 Compose 传入 Backend；主机 `.env` 显式设为 `true`，权限仍为 600。`docker compose config` 的最终值为 `true`。

仅重建 Backend 后，运行时确认 `APP_ENV=staging`、`STAGING_TENANT_DELETE_ENABLED=true`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，Backend 和其余三个容器均 healthy。公网 `/platform` 与 `/health` 返回 HTTPS 200，未登录访问 `/api/platform/auth/environment` 返回 401。认证后接口对 Staging 的 `deletion_enabled=true` 在合成平台管理员测试中验证；本次未使用现有平台管理员凭据，也未实际删除租户。Staging 删除会直接物理清理在线关联数据，没有一年保留或恢复入口。
