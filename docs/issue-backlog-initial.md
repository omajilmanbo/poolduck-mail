# 第一批 Issue（可直接开工）

> 说明：以下任务均按 1–8 小时粒度设计，可作为项目启动批次。

## Issue 1 — 扫码输入页基础能力

- **Title**: `[Feature] 扫码输入页与基础校验`
- **Background**: 需要一个最小可用输入页接收扫码枪输入，触发后续路由。
- **Scope**:
  - 提供输入框与提交动作
  - 仅支持长度与字符集基础校验
  - 错误提示展示
- **Out of scope**:
  - 邮件实际发送
  - 多步骤工作流
- **Acceptance criteria**:
  - 合法扫码内容可提交
  - 非法内容被拦截并提示
  - 页面在桌面浏览器可用
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual 全覆盖
- **Recommended labels**:
  - `type:feature`, `area:scanner-input`, `risk:low`
- **Risk labels**: `risk:low`
- **Human decision required**: `No`

## Issue 2 — 扫码结果到邮箱映射规则（内存版）

- **Title**: `[Feature] 扫码结果邮箱映射服务`
- **Background**: 需要将扫码结果映射到目标邮箱，形成最小闭环。
- **Scope**:
  - 建立内存映射表
  - 命中与未命中处理
- **Out of scope**:
  - 数据库持久化
  - 后台管理界面
- **Acceptance criteria**:
  - 命中时返回唯一邮箱
  - 未命中返回可识别错误
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual 全覆盖
- **Recommended labels**:
  - `type:feature`, `area:mail-routing`, `risk:medium`
- **Risk labels**: `risk:medium`
- **Human decision required**: `No`

## Issue 3 — 邮件发送服务抽象与沙箱实现

- **Title**: `[Feature] 邮件发送接口与沙箱发件实现`
- **Background**: 先接入可测试的发件实现，为生产发件商接入做准备。
- **Scope**:
  - 定义邮件发送接口
  - 提供沙箱 provider（记录发件请求）
  - 失败重试上限（固定次数）
- **Out of scope**:
  - 第三方供应商真实 API
  - 队列系统
- **Acceptance criteria**:
  - 可调用统一接口发信
  - 失败时有明确错误与日志
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual 全覆盖
- **Recommended labels**:
  - `type:feature`, `area:email-delivery`, `risk:medium`
- **Risk labels**: `risk:medium`
- **Human decision required**: `No`

## Issue 4 — 多租户隔离中间件雏形

- **Title**: `[Feature] 基于租户ID的请求隔离中间件`
- **Background**: SaaS 必须保证租户隔离，避免跨租户访问。
- **Scope**:
  - 请求中解析 tenantId
  - tenantId 缺失/非法拦截
  - 将 tenant 上下文注入业务层
- **Out of scope**:
  - 完整 RBAC 权限系统
  - 计费与套餐策略
- **Acceptance criteria**:
  - 缺失 tenantId 请求被拒绝
  - tenant 上下文可用于后续服务
- **Test requirements**:
  - normal/error/permission/tenant/boundary/regression/manual 全覆盖
- **Recommended labels**:
  - `type:feature`, `area:tenant`, `risk:security`
- **Risk labels**: `risk:security`
- **Human decision required**: `Yes`（安全策略阈值需人工确认）

## 建议执行顺序

1. Issue 1
2. Issue 2
3. Issue 3
4. Issue 4

达到“可以开始第一个 Issue”的标准：Issue 1 已具备明确范围、验收与测试规则，可立即创建并进入开发。
