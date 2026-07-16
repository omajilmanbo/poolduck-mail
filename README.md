# Poolduck Mail（暂定名）

Poolduck Mail 是面向企业客户的 Web SaaS。用户使用扫码枪提交条码或二维码后，系统会在当前租户和 location 范围内识别目标人员，创建邮件任务并记录处理结果。

## 产品目标

- 用统一系统承载扫码、人员邮箱匹配和邮件通知流程。
- 在多租户环境中保证数据隔离、角色权限和订阅门禁。
- 让扫码记录、邮件任务和异常结果可追踪。
- 以最小可用产品验证企业扫码通知业务闭环。

## 核心流程

1. 用户使用 `tenant_id + email + password` 登录。
2. 用户选择当前办公室、学校或校舍（统一抽象为 `location`）。
3. 扫码枪提交扫码编号。
4. 系统在当前 tenant 和 location 内查找启用的人员邮箱映射。
5. 匹配成功时创建扫码记录和邮件任务；匹配失败时记录异常扫码事件。
6. MVP 通过 mock/sandbox provider 验证邮件处理和状态展示，不向真实客户投递。

## MVP 产品能力

- 租户账号登录与基础角色控制（`root_admin` / `manager`）
- 订阅状态检查与功能门禁
- location 与人员邮箱映射查询
- 扫码事件和异常事件记录
- 固定邮件正文的邮件任务创建
- mock/sandbox 发送触发与结果展示
- 基础扫码工作台和操作记录

## 当前产品状态

MVP 核心业务链路已完成本地和 Staging 冒烟验证。目前仍使用 mock/sandbox 邮件 provider 和合成测试数据；真实邮件投递、自动任务处理、完整后台管理、生产级备份监控及正式对外发布仍需后续迭代。

## MVP 边界

- 不支持桌面客户端或离线模式。
- 不支持前端自定义邮件正文。
- 不接入真实客户邮件凭据或生产数据。
- 不包含复杂工作流、全量 BI、多区域容灾或企业级合规认证实施。

## 产品文档

- 产品范围：`docs/product.md`
- 功能需求：`docs/requirements.md`
- 用户手册：`docs/user-guide.md`
- 管理员手册：`docs/admin-guide.md`
- 产品改进与 Issue 归档：`docs/issue-archive.md`
- 开发入口：`docs/development.md`
- 完整文档职责：`docs/documentation.md`
