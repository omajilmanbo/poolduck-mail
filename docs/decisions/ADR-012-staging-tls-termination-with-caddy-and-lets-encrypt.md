# ADR-012：Staging TLS 终止与证书自动化采用 Caddy 和 Let's Encrypt

- 状态：Accepted
- 日期：2026-07-29
- 相关 Issue：#86, #107

## Context

当前 OCI Staging 采用单 VM + Docker Compose：

- Nginx reverse proxy 是唯一公网应用入口，但当前只监听 HTTP `80`。
- `/` 与 `/healthz` 由 Frontend 处理，`/api/*` 与 `/health` 由 Backend 处理。
- Frontend、Backend 与 PostgreSQL 应只通过回环地址或 Docker 内部网络访问，不直接暴露到公网。
- `app.poolducktest.com` 已指向 Staging VM，并可通过 HTTP 访问；Issue #86 要求在扩大外部测试前补齐有效 HTTPS、证书生命周期、安全头与访问控制。

需要决定由哪个组件承担 Staging 的公网 TLS 终止，以及如何签发和续期证书。方案需满足以下约束：

- 优先使用免费或低成本方案，不购买对当前 Staging 没有必要的商业 DV 证书。
- 证书私钥、ACME 账户资料和 DNS/provider 凭据不得进入 Git、Issue、PR 或部署日志。
- 保持单域名、同源访问，避免在没有业务需要时新增独立 API 域名和第二套证书。
- 保持 ADR-003 的认证与租户隔离边界，不让反向代理代替应用鉴权。
- 保持 ADR-004 已确定的 Frontend、Backend、数据库、认证、测试与 CI 技术栈。
- 保持 ADR-005 的部署边界：cloud-init 只做主机 bootstrap；应用变更经人工批准后通过 Compose Runbook 或未来幂等部署脚本实施。
- Production TLS、CDN、WAF、负载均衡和发布方式不在本决定范围内。

与现有 ADR 的关系：

- ADR-004 没有指定 Nginx、Apache、Caddy 或其他公网反向代理，因此采用 Caddy 不替换 ADR-004 的核心应用技术栈。本 ADR 仅补充 Staging 的边缘代理、TLS 和证书自动化技术选择。
- ADR-005 要求应用部署由人工批准触发。Caddy 的证书自动签发和续期属于运行期证书生命周期维护，不等同于 Git commit、镜像、migration 或应用版本的自动发布。
- 本 ADR 不 Supersede ADR-004 或 ADR-005；若被接受，三者同时生效。

## Decision

采用以下方案：

1. 适用范围
   - 仅适用于 OCI Staging 的 `app.poolducktest.com`。
   - Local 环境继续使用现有本地入口。
   - Production 必须通过独立 ADR/Issue 决定。

2. 公网入口
   - 在 Staging Compose 中使用 Caddy 替换现有 Nginx reverse proxy。
   - Caddy 是唯一允许绑定公网 `80`/`443` 的应用容器。
   - 不采用“Caddy → Nginx → 应用”的双层反向代理。

3. 证书来源和验证方式
   - 使用 Let's Encrypt 作为批准的公开证书颁发机构。
   - 使用 ACME HTTP-01 完成域名控制验证，不在 VM 保存 DNS provider API 凭据。
   - Caddy 配置必须显式使用经批准的 Let's Encrypt issuer，避免在未记录的情况下自动切换到其他公开 CA。
   - 本阶段不申请 wildcard 证书。

4. HTTP 与 HTTPS 行为
   - 保留公网 `80`，仅用于 ACME HTTP-01 验证和 HTTP 到 HTTPS 跳转。
   - 正常业务访问使用 `443`。
   - 证书成功签发并完成 HTTPS smoke 后，HTTP 请求重定向到 `https://app.poolducktest.com`。

5. 路由
   - `/api/*` 与 `/health` 转发到 `backend:3001`。
   - `/`、`/healthz` 与其他 Frontend 路由转发到 `frontend:3000`。
   - 保持请求路径，不在反向代理层重写 tenant、用户、location 或 API 业务标识。

6. 证书和配置持久化
   - Caddy 的 `/data` 使用专用 Docker named volume 持久化，保存证书、私钥和 ACME 状态。
   - Caddy 的 `/config` 使用独立 named volume。
   - Caddyfile 可以进入 Git；证书、私钥和实际 ACME 账户状态不得进入 Git。
   - Caddy 数据卷不得被当作构建缓存清理。

7. 应用公开 URL
   - `CORS_ORIGIN=https://app.poolducktest.com`。
   - `API_BASE_URL=https://app.poolducktest.com`。
   - `NEXT_PUBLIC_API_BASE_URL=https://app.poolducktest.com`，并重新构建 Frontend，避免客户端 bundle 保留旧 HTTP 地址。
   - 不使用 `*` CORS origin。

8. 网络暴露
   - OCI NSG、主机防火墙和 Compose 共同保证公网仅开放应用 `80`/`443`。
   - SSH 继续只允许人工批准的管理员 CIDR。
   - Frontend `3000`、Backend `3001` 和 PostgreSQL `5432` 不得向公网开放。
   - 本 ADR 不决定外部测试人员的允许来源；公开访问、固定 CIDR allowlist 或外部身份代理必须在实施 #86 前由人工单独批准。

9. 安全头
   - Caddy 负责统一设置 `X-Content-Type-Options`、防 iframe 策略和 `Referrer-Policy`。
   - Content Security Policy 必须按当前 Next.js 行为验证后再收紧，不使用未经测试的复制模板。
   - 初次上线不启用 HSTS preload 或 `includeSubDomains`；只有在 HTTPS 与所有相关子域行为验证后，才能通过后续人工批准扩大 HSTS 范围。

10. 部署与回滚
    - Caddy 作为应用 Compose 的一部分，由 ADR-005 规定的人工批准部署路径实施；不加入 cloud-init 的完整应用部署。
    - 证书自动续期无需单独的应用发布审批，但必须保留可观察的续期日志和有效期检查。
    - 回滚到旧 Nginx HTTP 入口前，必须停止外部测试，并同步回滚公开 URL/CORS 配置和 Frontend 构建；HTTP 回滚只能恢复此前的内部验证状态，不能继续作为扩大外部测试后的长期入口。

## Alternatives considered

1. 保留 Nginx 并增加 Certbot
   - 优点：不替换当前 reverse proxy，Nginx 生态成熟。
   - 未选择原因：容器化环境需要额外处理首次签发、ACME webroot、证书共享卷、定时续期和 Nginx reload，证书生命周期由多个组件共同负责。对当前单域名单 VM Staging，运维复杂度高于 Caddy 内置 ACME。

2. Caddy 放在 Nginx 前面
   - 优点：可保留现有 Nginx 配置。
   - 未选择原因：形成职责重叠的双层代理，增加一次转发、两套日志和故障定位路径，没有当前业务收益。

3. Cloudflare Free Universal SSL + Origin TLS
   - 优点：可增加边缘 TLS、DDoS 防护，并可选用 Cloudflare Access。
   - 未选择原因：需要引入新的 DNS/代理控制面，并决定 Full (strict)、源站证书、源站直连限制和自动 smoke 身份。Issue #86 当前只需补齐 Staging TLS；外部身份访问控制仍需人工决定。

4. OCI Load Balancer + 证书
   - 优点：可使用 OCI 托管入口、健康检查与访问控制规则。
   - 未选择原因：当前只有一台 Staging VM；增加 Load Balancer、backend set、listener、证书关联和 Terraform 状态会显著扩大基础设施范围。

5. 购买商业 DV 证书并人工配置
   - 优点：可能提供供应商支持。
   - 未选择原因：对当前 Staging 的浏览器信任和传输加密没有必要优势，同时增加费用与人工续期风险。

## Consequences

正面影响：

- 使用已有域名和 VM 即可实现有效 HTTPS，证书本身无额外购买成本。
- 证书签发、续期和 HTTP 跳转由一个反向代理组件负责，减少 Certbot、定时任务和 reload 的组合维护。
- 继续沿用单域名和现有 `/api/*` 路由，不新增跨域和第二张证书。
- Caddy 配置、Compose 变更和证书状态的职责边界明确。

负面影响：

- Staging 的 reverse proxy 从 Nginx 切换为 Caddy，团队需要维护新的配置语法和排障方法。
- 现有 Nginx 日志、healthcheck 和运行手册不能直接照搬，必须更新。
- Caddy 数据卷成为重要运行状态；误删会触发重新签发并可能碰到 CA rate limit。
- 若未来 Production 继续采用 Nginx、托管负载均衡或 CDN，Staging 与 Production 的边缘组件可能不同。
- 外部测试人员访问策略尚未由本 ADR 决定，接受本 ADR 不等于 #86 的全部人工决策已完成。

## Migration impact

- 不修改数据库 schema、migration、seed 或现有数据。
- 不修改 Frontend/Backend 业务框架、认证模型、tenant scope 或邮件 provider。
- 接受后需要修改 Staging Compose、反向代理配置、环境参数、healthcheck、部署 Runbook 和测试记录。
- `NEXT_PUBLIC_API_BASE_URL` 是 Frontend 构建时参数，切换到 HTTPS 时必须重新构建 Frontend。
- 初次切换需要短维护窗口，避免 Nginx 和 Caddy 同时竞争主机 `80`。
- 本 ADR 已于 2026-07-29 被人工接受；迁移由 Issue #107 按 ADR-005 的人工批准 Runbook 实施。

## Security impact

- 浏览器到 Caddy 的公网流量使用有效 TLS；Caddy 到同一 VM Docker 网络内的 Frontend/Backend 暂时使用 HTTP。
- 如果未来上游服务迁移到其他主机或不受信任网络，必须重新评估 upstream TLS 或 mTLS。
- 证书私钥保存在 Caddy 数据卷，不打印、不复制到仓库、不写入 Issue/PR。
- HTTP-01 避免在 VM 保存 DNS API token；域名 DNS 变更仍由人工在 DNS 管理平台完成。
- Caddy 不替代应用登录、JWT/session、RBAC、operator location 授权或 tenant 隔离。
- 公开端口检查必须验证 `3000`、`3001`、`5432` 不可从公网访问。
- 日志不得记录密码、token、完整 Cookie、客户 PII 或真实邮件凭据。

## Operational impact

- 前置条件：DNS A/AAAA 记录正确，OCI NSG 和主机防火墙允许 `80`/`443`，Caddy 可以绑定端口，数据卷可写且持久化。
- 发布前运行 Caddy 配置验证和 `docker compose config`。
- 发布后验证：
  - HTTP 按批准策略跳转到 HTTPS；
  - TLS 证书链、域名和有效期正确；
  - `/`、`/healthz`、`/health` 和 `/api/*` 路由正确；
  - 登录、扫码、CORS 和 Staging smoke 通过；
  - 公网端口暴露符合批准范围；
  - Caddy 容器重建后仍复用证书状态。
- 记录 Caddy/ACME 日志用于签发和续期排障，但不在本 ADR 中扩大 #39 的集中监控范围。
- 测试配置应优先使用 Let's Encrypt staging endpoint，避免反复试验触发公开 CA rate limit；正式签发只在配置验证完成后执行。
- Runbook 必须包含 DNS、端口占用、ACME challenge、证书存储、CORS、上游健康状态和回滚排障。

## Follow-up

- Issue #107：按本 ADR 为 OCI Staging 接入 Caddy、Let's Encrypt 和 HTTP-01。
- 在实施 #86 前，单独批准外部测试人员访问策略和允许来源；不得由 Agent 猜测公开访问、CIDR allowlist 或外部身份代理方案。
- 在 #107 Scope 内实现 Caddy Compose 服务、Caddyfile、持久化卷、HTTPS 环境参数、安全头和回滚步骤。
- 更新实际受影响的 `docs/architecture.md`、`docs/deployment.md`、`docs/staging-manual.md`、`docs/network.md`、`docs/environments.md`、`docs/inventory/` 与测试记录。
- 执行 TLS、重定向、CORS、health、登录、扫码、外网端口和 Staging smoke 验证，并记录部署 commit 与结果。
- Production 的域名、TLS、CDN/WAF、负载均衡和发布方式另建 ADR/Issue，不从本 Staging 决定推导。
