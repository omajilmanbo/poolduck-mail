# 测试设计与执行规则

本项目为多租户 Web SaaS（扫码输入 -> 路由 -> 邮件发送），测试必须覆盖功能正确性与租户隔离安全性。

## 1. 每个功能的最小测试集

每个 Feature Issue 必须覆盖以下 7 类：

1. **正常场景（Normal cases）**
2. **异常场景（Error cases）**
3. **权限场景（Permission cases）**
4. **租户隔离（Tenant isolation cases）**
5. **边界场景（Boundary cases）**
6. **回归场景（Regression cases）**
7. **手工测试步骤（Manual test steps）**

## 2. 高风险功能附加测试

涉及 **billing / auth / license** 时，必须额外覆盖：

- expired
- active
- trial
- suspended
- cross-tenant access
- network failure

## 3. 测试层级要求

- 单元测试：核心规则（解析、路由、校验）
- 集成测试：API 到邮件服务的集成路径
- 端到端测试：用户扫码输入到邮件发送结果可观察

## 4. 提交前检查清单

- 是否记录测试数据与预期结果
- 是否提供失败时日志或截图
- 是否包含负向用例
- 是否验证跨租户不可见
- 是否更新文档中的行为描述

## 5. 建议命名

- 单元：`<module>.<behavior>.spec.*`
- 集成：`<flow>.integration.spec.*`
- E2E：`<role>-<journey>.e2e.spec.*`
