# 环境定义与差异（Local / Staging / Production）

## 1. 环境用途

- Local：开发者本地开发与调试。
- Staging：预发布验证，验证功能、配置与发布流程。
- Production：正式对外服务。

## 2. 环境差异矩阵

| 维度 | Local | Staging | Production |
|---|---|---|---|
| 用户对象 | 开发者 | 内部测试/验收 | 真实客户 |
| 数据类型 | 本地测试数据 | 非真实客户数据 | 真实业务数据 |
| 数据库 | 本地 PostgreSQL（Compose） | Staging VM 内 PostgreSQL 16 容器（与 Production 隔离） | 独立 Production DB |
| Mail Provider | Mock/Sandbox | Sandbox（独立账号） | 正式 Provider（非 sandbox-only） |
| 域名与协议 | localhost（HTTP） | 当前 public IP（HTTP，仅内部验证）；目标为域名（HTTPS） | 正式域名（HTTPS） |
| Secrets | 本地 `.env` | 当前 VM 本地 `.env`（仓库外）；目标为 Staging secrets store | Production secrets store |
| 日志监控 | 本地日志 | 当前容器日志；集中日志与基础监控待补齐 | 集中日志+监控+告警 |
| 变更风险 | 低 | 中 | 高 |

## 3. 强制隔离规则

1. Staging 与 Production 必须使用独立数据库，不允许共享实例/Schema。
2. Staging 与 Production 必须使用独立 secrets，不允许同名同值复用。
3. Staging 与 Production 必须使用独立环境变量集合（至少 `DATABASE_URL`、`JWT_SECRET`、`MAIL_*` 分离）。
4. Staging 禁止导入真实客户 PII 数据。
5. Production 禁止启用 mock provider 或 sandbox-only secret。

## 4. 配置基线建议

- `APP_ENV`：`local` / `staging` / `production`。
- `APP_PORT`：按部署平台分配。
- `DATABASE_URL`：环境独立。
- `JWT_SECRET`：环境独立、定期轮换。
- `MAIL_PROVIDER`：Local/Staging 允许 sandbox/mock；Production 指向正式通道。
- `FRONTEND_BASE_URL`、`API_BASE_URL`：按环境域名区分。

## 5. 验收检查清单（文档级）

- [ ] Local/Staging/Production 用途明确。
- [ ] Staging/Production DB 与 Secrets 隔离写清楚。
- [ ] Production 非 sandbox-only 约束明确。
- [ ] 环境变量最小集合已定义。

## 6. Staging environment baseline (Issue #37)

Staging is an internal verification environment. It validates configuration, deployment steps, tenant isolation, subscription gates, scan-to-mail-job flow, and sandbox/mock mail behavior before Production exists.

### 6.1 Access model before a domain exists

- The initial OCI Always Free Staging environment may be accessed by the compute instance public IP.
- Current temporary public entry: `http://<staging-public-ip>` through the Nginx reverse proxy.
- Frontend and Backend container ports `3000` / `3001` stay bound to loopback on the VM and are not the public entry.
- When a Staging domain and TLS are available, switch to HTTPS URLs and update `CORS_ORIGIN`, `API_BASE_URL`, and `NEXT_PUBLIC_API_BASE_URL`.
- Lack of a domain does not block Staging design, but any workflow that requires HTTPS must stop until DNS/TLS is available.

### 6.2 Isolation rules

- Staging and Production must not share a database, schema, secret, mail provider account, or customer data source.
- Staging data must be synthetic or manually seeded test data.
- Staging secrets must be generated separately from Production secrets.
- Staging mail must use `mock` or `sandbox`; real customer delivery is prohibited.
- `TENANT_CONTEXT_ENFORCED=true` is mandatory for Staging.

### 6.3 Staging variable baseline

| Variable | Staging value policy | Secret | Notes |
|---|---|---|---|
| `APP_ENV` | `staging` | No | Fixed environment marker. |
| `APP_PORT` | `3001` unless the host reverse proxy changes it | No | Backend listener. |
| `FRONTEND_PORT` | `3000` unless the host reverse proxy changes it | No | Frontend listener. |
| `API_BASE_URL` | `http://<staging-public-ip>` before domain; HTTPS base URL after domain | No | Nginx routes API requests. |
| `NEXT_PUBLIC_API_BASE_URL` | Same public base URL used by the frontend | No | Required by the current frontend client. |
| `CORS_ORIGIN` | `http://<staging-public-ip>` before domain; HTTPS frontend URL after domain | No | Do not use wildcard origins. |
| `DATABASE_URL` | Secret Staging PostgreSQL URL | Yes | Isolated Staging database only. |
| `JWT_SECRET` | Generated Staging-only secret | Yes | Do not reuse Local or Production. |
| `REFRESH_TOKEN_SECRET` | Generated Staging-only secret | Yes | Do not reuse Local or Production. |
| `MAIL_PROVIDER` | `sandbox` or `mock` | No | Production provider is out of scope. |
| `MAIL_FROM_ADDRESS` | Staging placeholder or sandbox sender | Yes/Placeholder | Must not be a production sender. |
| `LOG_LEVEL` | `info` | No | `debug` only for temporary troubleshooting. |
| `TENANT_CONTEXT_ENFORCED` | `true` | No | Must not be disabled. |

### 6.4 Agent stop conditions

Agents must stop and report blockers if any required Staging input is missing:

- OCI access, `compartment_ocid`, `region`, admin SSH CIDR, or SSH public key.
- Staging database location or secret storage location.
- JWT / refresh token secret generation path.
- Mail provider choice or sandbox credentials.
- Domain/TLS details when the requested deployment path requires HTTPS.
- Permission to modify GitHub Actions workflows or GitHub Environments.
