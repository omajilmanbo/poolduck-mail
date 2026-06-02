# 部署说明（Local / Staging / Production）

## 1. 环境划分

- Local：开发调试环境
- Staging：预发布验证环境
- Production：正式生产环境

## 2. 基础依赖

- Node.js 20 LTS
- npm 10+
- Docker / Docker Compose（Local PostgreSQL 16）
- PostgreSQL 16（Local 由 `docker-compose.yml` 提供；Staging/Production 使用独立数据库）
- MVP 阶段邮件 provider 使用 sandbox/mock（不接入真实邮件发送）

## 3. 环境变量

参考 `.env.example`，至少包括：
- `APP_ENV`
- `APP_PORT`
- `FRONTEND_PORT`
- `API_BASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `MAIL_PROVIDER`
- `MAIL_SMTP_HOST` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`
- `MAIL_FROM_ADDRESS`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `TENANT_CONTEXT_ENFORCED`

## 4. Local 部署

### 4.0 运行前人工检查项

- 当前环境必须可以执行 Docker / Docker Compose。
- 当前环境必须允许安装 npm 依赖。
- 当前环境必须可以访问 GitHub 仓库并创建分支/PR。
- 默认端口未被占用：PostgreSQL `5432`、Backend `3001`、Frontend `3000`。
- 如本机已有 PostgreSQL 占用 `5432`，需人工决定是否改用其他端口，例如在 `.env` 中设置 `POSTGRES_PORT=5433`。
- 不提供真实数据库密码、真实客户数据、真实邮件凭据或 OAuth refresh token。
- MVP 阶段邮件发送必须使用 sandbox/mock provider。

### 4.1 Local PostgreSQL（Docker Compose）

`docker-compose.yml` 当前只提供 PostgreSQL 16，本阶段不创建生产 Dockerfile，也不把 staging/production 纳入 compose。

1. 准备本地环境变量：
   - `copy .env.example .env`
2. 启动本地数据库：
   - `docker compose up -d postgres`
3. 检查容器状态：
   - `docker compose ps`
4. 验证 PostgreSQL 可连接：
   - `docker compose exec postgres pg_isready -U poolduck_local -d poolduck_mail`
5. 停止本地数据库：
   - `docker compose down`

默认本地配置：

- 数据库名：`poolduck_mail`
- 用户：`poolduck_local`
- 示例密码：`poolduck_local_password`
- 本机端口：`5432`
- 后端连接串：`postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail`

### 4.2 后端（当前已可运行）

1. 安装依赖：
   - `cd backend`
   - `npm install`
2. 配置环境变量（可选）：
   - 新建 `backend/.env`（或使用系统环境变量）
   - 可配置 `APP_PORT`（默认 `3001`）
   - 使用 `.env.example` 中的 `DATABASE_URL` 连接 Local PostgreSQL
3. 启动开发服务：
   - `npm run start:dev`
4. 健康检查：
   - `GET http://localhost:3001/health`
5. 运行测试：
   - `npm test`

### 4.3 前端（当前已可运行）

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

## 7. OCI Always Free Staging IaC 实施入口（Issue #48）

Staging 基础设施准备代码位于 `infrastructure/oci-staging/`。该目录只提供 Terraform 计划与人工实施入口，默认不自动部署应用。

人工实施步骤：

1. 进入 IaC 目录：`cd infrastructure/oci-staging`
2. 复制变量示例：`cp terraform.tfvars.example terraform.tfvars`
3. 人工填写 `terraform.tfvars`：`compartment_ocid`、`region`、`admin_ssh_cidr`、`ssh_public_key`。
4. 初始化与检查：`terraform init && terraform fmt -check && terraform validate`
5. 生成计划：`terraform plan -out=tfplan`
6. 人工审核计划确认无 Production 资源、无真实 secret、无公网数据库端口后，才允许执行：`terraform apply tfplan`

实施约束：

- `region` 必须由人工确认是 OCI tenancy home region，以保持 Always Free 资源资格。
- `admin_ssh_cidr` 禁止使用 `0.0.0.0/0`。
- Staging 邮件 provider 仍必须使用 mock/sandbox，不得接入真实客户投递。
- `terraform.tfvars`、`tfplan`、Terraform state 文件不得提交到仓库。
