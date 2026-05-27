# ADR-001：MVP 采用 Web SaaS

- 状态：Accepted
- 日期：2026-05-19
- 相关 Issue：#1

## Context

Poolduck Mail 需要在多客户场景中快速验证“扫码触发邮件发送”业务闭环。当前团队资源有限，需优先保证可维护性、可迭代性与租户隔离能力。

## Decision

MVP 阶段采用 Web SaaS 架构作为唯一交付形态。

## Alternatives considered

- 本阶段不引入其他交付形态对比，聚焦 Web SaaS 路线。

## Consequences

- 需要优先建设稳定的后端 API、认证授权与租户隔离机制。
- 需要建立标准化运维监控与审计能力。

## Migration impact

- 当前为准备阶段，无存量系统迁移。
- 后续如出现历史数据导入需求，将在独立 ADR 中定义迁移策略。

## Security impact

- 强制后端进行租户隔离与权限校验。
- 通过环境变量管理密钥，禁止在仓库存放生产凭据。

## Operational impact

- 需要完善登录失败、邮件失败、订阅异常的可观测与排障流程。
- 发布流程需包含回滚预案与最小化影响的发布窗口策略。


## Follow-up

- 后续实现阶段需将本 ADR 要求映射到数据库迁移、API 契约与测试用例。
- 如业务规则变化，需通过新 ADR 明确 supersede 关系。
