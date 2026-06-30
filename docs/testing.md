# 测试策略（MVP）

## 1. 测试目标

- 覆盖核心业务闭环：登录 → 扫码事件 → 邮件任务
- 保证租户隔离、权限控制、订阅校验正确性
- 降低高风险模块（auth/billing/data）上线风险

## 2. 必测类型

### 2.1 单元测试
- 认证逻辑（密码校验、token 解析）
- 订阅状态判断（trial/active/expired/suspended）
- 邮件任务状态流转

### 2.2 集成测试
- API 与数据库交互
- 扫码事件创建到邮件任务生成链路
- 重试机制与失败记录

### 2.3 权限与安全测试
- RBAC 角色访问边界
- 未授权访问拦截
- 输入参数校验与错误码一致性

### 2.4 租户隔离测试（重点）
- Tenant A 无法读取/操作 Tenant B 数据
- 跨租户 ID 访问必须返回拒绝
- 审计日志记录越权尝试

### 2.5 订阅与计费相关测试（重点）
- 订阅过期禁止关键业务接口
- `trial` / `active` 允许扫码与发信，`expired` / `suspended` 禁止扫码提交、创建邮件任务、发送与重试
- license check 结果与订阅状态一致

## 3. 回归基线

每次发布前至少执行：
- 登录相关回归
- 租户隔离回归
- 订阅状态回归
- 邮件发送成功/失败回归

## 4. 本地 seed 与 API 冒烟

进入 GUI 黑盒或 Staging 前，需要先完成本地 API 冒烟验证。

### 4.1 准备本地数据库

1. 启动本地 PostgreSQL：`docker compose up -d postgres`
2. 进入后端目录：`cd backend`
3. 生成 Prisma Client：`npm run prisma:generate`
4. 执行 migration：`npm run db:migrate`
5. 写入安全示例 seed：`npm run local:seed`

seed 数据仅使用 `example.local` 邮箱和固定 UUID，不包含真实客户数据、真实收件邮箱或真实邮件凭据。

核心 seed 值：

- `tenant_id`: `11111111-1111-4111-8111-111111111111`
- `manager@example.local` / `PoolduckLocal123!`
- `root-admin@example.local` / `PoolduckLocal123!`
- `location_id`: `66666666-6666-4666-8666-666666666666`
- active `scan_code`: `SCAN-LOCAL-001`
- unmapped `scan_code`: `SCAN-LOCAL-UNMAPPED`

### 4.2 API happy path 冒烟

1. 使用默认 sandbox success 启动后端：`npm run start:dev`
2. 另开终端执行：`npm run smoke:api`

脚本验证链路：

`health -> login -> license/check -> locations -> people -> unmapped scan -> mapped scan -> mail-jobs send`

预期结果：

- unmapped scan 创建异常 `scan_event`，不创建 `mail_job`
- mapped scan 创建 `queued` mail_job
- sandbox success 将 `mail_job` 更新为 `sent`

### 4.3 API failure path 冒烟

1. 设置 `MAIL_MOCK_SEND_RESULT=failure` 后启动后端。
2. 执行 smoke，并声明预期发送状态为 failed：
   - Windows PowerShell: `$env:API_SMOKE_EXPECT_SEND_STATUS='failed'; npm run smoke:api`
   - macOS/Linux: `API_SMOKE_EXPECT_SEND_STATUS=failed npm run smoke:api`

预期结果：

- mapped scan 仍创建 `queued` mail_job
- sandbox failure 将 `mail_job` 更新为 `failed` 并写入 `error_message`

### 4.4 Local Compose 容器组冒烟

Issue #60 后，本地 GUI 黑盒前应额外验证容器组形态：

1. 构建并启动容器组：`docker compose up -d --build`
2. 查看状态：`docker compose ps`
3. 验证健康检查：
   - `GET http://localhost:3000/healthz`
   - `GET http://localhost:3001/health`
4. 写入 seed：`docker compose exec backend npm run local:seed`
5. 执行 API smoke：`docker compose exec backend npm run smoke:api`
6. 查看日志：
   - `docker compose logs -f backend`
   - `docker compose logs -f frontend`
7. 停止容器组：`docker compose down`

该流程仍使用 sandbox/mock mail provider，不得接入真实邮件 provider 或真实客户数据。

## 5. GUI 黑盒与 E2E 冒烟

Issue #57 的本地 GUI 黑盒测试记录：

- `docs/testing/gui-black-box-2026-06-30.md`

最小 Playwright E2E smoke：

```powershell
cd frontend
npm run test:e2e
```

覆盖范围：

- active tenant 登录进入扫码工作台
- location 与人员映射展示
- `SCAN-LOCAL-001` 创建 `queued` mail_job 并显示“发送中”
- 手动触发 sandbox send 后显示“已发送”
- suspended tenant 登录后扫码输入和提交按钮禁用

进入 Staging 前，GUI 黑盒结论必须明确是否存在阻塞项；UI 细节优化问题应拆分为后续 Issue，不阻塞 Staging smoke。

## 6. 质量门禁建议

- 单元测试通过率 100%（新增/改动相关）
- 高风险模块必须包含至少 1 个失败场景测试
- 关键接口必须有契约测试或集成测试覆盖
