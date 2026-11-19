# 固定候选的本机 HTTPS 验收（O07）

2026-11-20 04:18 JST（11-19 19:18 UTC），候选 `a05251897d7fc11d96114606bcaa1807dd96af55` 在本机 Caddy v2.11.4 后通过 HTTP 跳转、可信 HTTPS、前后端路由和合成操作员登录验收。后端实际为 `APP_ENV=local`、`NODE_ENV=production`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。**发布判断仍为暂不可部署。**

## 版本与环境

7 月的 Staging 记录覆盖公信证书、登录 Cookie 和证书卷复用，部署提交为 `3376007`。10 月的公网入口记录来自 `158eeea`，后续后端复验为 `5072c89`。本次从上述 11 月候选的 Git 归档构建前后端镜像，并按候选 Staging Compose 指定的 `caddy:2.11.4-alpine` 运行代理。[7 月 HTTPS 验收](staging-smoke-2026-07-29.md) · [10 月部署记录](staging-smoke-2026-10-20-issue168.md) · [Staging Compose](../../docker-compose.staging.yml)

- 从候选 Caddyfile 读取配置，把站点改为 `portal.o07.test`，将 ACME issuer 替换为挂载的短期证书，并设置 `auto_https disable_certs`。从 `request_body` 起逐字节相同，保留 1 MB 上限、安全头、全部 matcher 和反向代理目标。`caddy validate` 通过。候选原文和本机配置的 SHA-256 分别为 `283c96eab3a0c04b8aa8163d675ed9692ee2cf9035f4f7d0714aaa660ecda198`、`f5d2e355b6f1ed7e728537d101c33d317cbf47199c3a28a25f695653cd520f43`。[候选 Caddyfile](../../deploy/staging/caddy/Caddyfile)
- Compose 项目用两个内部网络。客户端只与 Caddy 共享入口网络，前后端和 PostgreSQL 在应用网络。五个运行容器发布到宿主的端口合计为 0。Caddy 通过 Docker DNS 的测试别名接受请求。前端在构建时写入测试 HTTPS 地址；下载的页面脚本中核对到该地址。后端的公开 URL 与 CORS 来源也配置为这个地址。
- 一次性签发容器在无网络模式离线签名，CA 私钥只存于 tmpfs。客户端通过请求级 CA 设置校验证书链、有效期和 SAN 域名；宿主信任库保持原状。临时数据库从空租户表运行 `npm run local:seed`，登录使用其中的合成操作员。

## 通过同一入口取得的响应

| 请求或检查 | 实测结果 |
|---|---|
| HTTP `/` 与 `/health?o07=1` | 均为 308。两个 `Location` 都指向测试域名的 HTTPS 地址，分别保留 `/` 和 `/health?o07=1`。 |
| 跟随首页跳转 | TLS 1.3，证书链、域名和有效期通过；移除本次 CA 后，默认信任客户端拒绝握手。HTTPS 首页 200，HTML 含 Poolduck Mail 标题与登录按钮。 |
| HTTPS `/health`、`/healthz` | 均为 200，正文分别为 `service=poolduck-mail-backend` 和 `service=poolduck-mail-frontend`，两者 `status=ok`。 |
| 首页和两个健康端点的安全头 | 三处均有 HSTS `max-age=86400`、CSP `frame-ancestors 'none'`、`nosniff`、`DENY` 和 `strict-origin-when-cross-origin`。三处均无 `Server` 头。 |
| `OPTIONS /api/auth/login` | 允许来源返回 204、精确匹配的 `Access-Control-Allow-Origin` 及 `Access-Control-Allow-Credentials: true`；另一来源同为 204，响应省略 `Access-Control-Allow-Origin`。 |
| 合成操作员登录 | `GET /api/auth/me` 无会话时 401。`POST /api/auth/login` 返回 201，角色为 `operator`。取回的访问 Cookie 经 HTTPS 请求 `/api/auth/me` 得到 200、相同角色，`/api/license/check` 得到 200。`POST /api/auth/logout` 返回 201。 |
| 登录响应的两枚 Cookie | `poolduck_access` 的 Path 为 `/`，`poolduck_refresh` 的 Path 为 `/api/auth`。两者均有 `Secure`、`HttpOnly`、`SameSite=Lax`。 |

客户端只保留状态、属性和服务名。库内邮件任务和投递尝试均为 0。验收后按项目核对并移除五个容器、两个网络、五个卷及三个专属镜像标签；卷内包括短期证书、私钥、客户端 CA 和合成数据库。

## 正式环境仍待验证

在获批 Staging 窗口，需要从批准的外部网络核对目标 SHA、真实 DNS、80/443 和内部 3000/3001/5432 的边界、入口证书链、HTTP-01 签发与续期、Caddy 卷复用，以及正式入口的同源登录。独立部署脚本的幂等重跑、中断恢复和人工接管仍待实测。[ADR-005](../decisions/ADR-005-staging-deployment-trigger-and-recovery.md) · [ADR-012](../decisions/ADR-012-staging-tls-termination-with-caddy-and-lets-encrypt.md)

Production 的入口、邮件准入和发布授权仍待独立决策。D02 继续保留。本次本机验收仅补充 O07 的候选版本证据。[首次生产部署手册](../first-production-deployment.md) · [首次邮件准入 #180](https://github.com/omajilmanbo/poolduck-mail/issues/180)
