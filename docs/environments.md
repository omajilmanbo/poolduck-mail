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
| 数据库 | 本地 PostgreSQL（Compose） | 独立 Staging DB | 独立 Production DB |
| Mail Provider | Mock/Sandbox | Sandbox（独立账号） | 正式 Provider（非 sandbox-only） |
| 域名与协议 | localhost（HTTP） | staging 域名（HTTPS） | 正式域名（HTTPS） |
| Secrets | 本地 `.env` | Staging secrets store | Production secrets store |
| 日志监控 | 本地日志 | 集中日志+基础监控 | 集中日志+监控+告警 |
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
