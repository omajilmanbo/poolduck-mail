# 部署说明（Local / Staging / Production）

## 1. 环境划分

- Local：开发调试环境
- Staging：预发布验证环境
- Production：正式生产环境

## 2. 基础依赖

- Node.js 20 LTS
- npm 10+
- Docker Desktop / Docker Compose（推荐的 Local 容器环境）
- PostgreSQL 16（Local 可由 Docker Compose 启动；后续数据库功能启用时使用）
- MVP 阶段邮件 provider 使用 sandbox/mock（不接入真实邮件发送）

## 3. 环境变量

参考 `.env.example`，至少包括：
- `APP_ENV`
- `APP_PORT` / `FRONTEND_PORT` / `POSTGRES_PORT`
- `NEXT_PUBLIC_API_BASE_URL` / `API_BASE_URL`
- `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET` / `REFRESH_TOKEN_SECRET`
- `MAIL_PROVIDER` / `MAIL_FROM_ADDRESS`
- `MAIL_SMTP_HOST` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`
- `CORS_ORIGIN` / `LOG_LEVEL` / `TENANT_CONTEXT_ENFORCED`

## 4. Local 部署

### 4.1 Docker Compose（推荐）

1. 确认 Docker Desktop 已启动，且本机可执行 `docker compose version`。
2. 从仓库根目录启动本地容器环境：
   - `docker compose up --build`
   - 或后台启动：`docker compose up -d --build`
3. 服务地址：
   - Frontend：`http://localhost:3000`
   - Backend：`http://localhost:3001`
   - PostgreSQL：`localhost:5432`
4. 健康检查：
   - Frontend：`GET http://localhost:3000/healthz`
   - Backend：`GET http://localhost:3001/health`
5. 常用维护命令：
   - 查看容器状态：`docker compose ps`
   - 查看日志：`docker compose logs -f backend frontend postgres`
   - 停止服务：`docker compose down`
   - 清理本地数据库与依赖缓存卷：`docker compose down -v`

Compose 编排仅面向 Local 开发环境；Staging / Production 不允许复用本地占位 secret、mock-only 邮件配置或本地数据库卷。

### 4.2 后端手工启动（可选）

1. 安装依赖：
   - `cd backend`
   - `npm install`
2. 配置环境变量（可选）：
   - 新建 `backend/.env`（或使用系统环境变量）
   - 可配置 `APP_PORT`（默认 `3001`）
3. 启动开发服务：
   - `npm run start:dev`
4. 健康检查：
   - `GET http://localhost:3001/health`
5. 运行测试：
   - `npm test`

### 4.3 前端手工启动（可选）

1. 安装依赖：
   - `cd frontend`
   - `npm install`
2. 启动开发服务：
   - `npm run dev`
3. 构建验证：
   - `npm run build`
4. 健康检查：
   - `GET http://localhost:3000/healthz`
5. 运行测试：
   - `npm test`

## 5. Staging 部署

- 使用独立数据库与邮件沙箱配置
- 自动化部署后执行 smoke test
- 验证订阅、权限、扫码链路

## 6. Production 部署

- 必须经过 staging 验证
- 执行数据库 migration（先备份）
- 配置监控告警（登录失败率、邮件失败率）
- 逐步发布或低峰发布
