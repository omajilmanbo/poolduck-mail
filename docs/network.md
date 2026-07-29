# 网络与通信策略（MVP）

## 1. 通信路径（SSOT）

MVP 服务间通信方向统一为：

`Browser → Frontend → Backend API → PostgreSQL / Mail Provider / Logs`

说明：
- Browser 不直接访问数据库与邮件 provider。
- 数据库仅允许 Backend API 访问。
- 邮件发送调用只能由 Backend 发起。

## 2. 端口与访问方向

### Local

- Frontend：`http://localhost:3000`
- Backend API：`http://localhost:3001`
- PostgreSQL：`localhost:5432`（仅本地开发链路）

### Staging

- Frontend 与 Backend API：`https://app.poolducktest.com`（同源 443）
- Caddy：宿主机 `80`/`443`；`80` 仅用于 ACME HTTP-01 与 HTTPS 跳转
- Frontend / Backend：宿主机 `127.0.0.1:3000` / `127.0.0.1:3001`
- PostgreSQL：不对公网开放，仅允许 Backend 所在网络访问（5432 内网）

### Production（待独立决策）

- 域名、TLS、CDN/WAF、负载均衡和 API 域名策略不从 Staging 推导。

## 3. 域名与 HTTPS

1. Staging 使用 `app.poolducktest.com`；Production 必须使用独立域名。
2. Staging 的前端与 API 通过 Caddy 的同源 HTTPS 入口访问。
3. Local 可使用 HTTP 进行开发调试。

## 4. API Base URL 约定

- Local 前端默认调用：`http://localhost:3001`
- Staging 前端调用：`https://app.poolducktest.com`
- Production 前端调用：`https://api.<domain>`

## 5. CORS 基本策略

1. 仅允许白名单来源访问后端 API。
2. Local：允许 `http://localhost:3000`。
3. Staging：仅允许 staging 前端域名。
4. Production：仅允许 production 前端域名。
5. 禁止 `*` 通配放开认证接口 CORS。
6. 后端启动时从 `CORS_ORIGIN` 读取白名单，支持逗号分隔多个 origin；未配置时默认允许 Local 前端 `http://localhost:3000`。

## 6. 数据库访问策略

- PostgreSQL 不暴露给 Browser。
- PostgreSQL 不暴露给公网。
- 仅 Backend API 使用数据库连接凭据。
- Staging 与 Production 数据库网络层必须隔离。

## 7. 日志与监控链路

- Backend 将结构化日志输出到集中日志系统。
- 关键指标（登录失败率、邮件失败率、订阅门禁拒绝）进入监控系统。
- Production 必须配置告警接收渠道。
