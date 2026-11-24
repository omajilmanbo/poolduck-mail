# P06 已持有游标时的审计空页

2026-11-20（日本时间），固定候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。在新 PostgreSQL 16.16 与真实 Chromium 会话中使用合成审计。两个标签持同一筛选，首页各返回同样的 25 条及下一页游标。下一页有两条到期平台审计，候选保留服务完成一轮真实清理后，第一页、另一组对照记录及租户审计保持原样。[矩阵 P06](business-requirements-matrix.md#P06) · [较早的平台审计验收](candidate-platform-smoke-2026-11-19.md#platform-audit-browser) · [ADR-024](../decisions/ADR-024-business-record-retention-and-destruction.md)

| 浏览器操作 | 实测 |
| --- | --- |
| 两个标签各自使用原游标翻页 | HTTP 200，空列表和空游标。两边均显示“此页记录已清理或不再符合筛选条件。”，仅上一页可用。 |
| 第一个标签返回上一页 | 无游标查询恢复原有 25 条，顺序不变。 |
| 第二个标签从空页改筛选 | 无游标查询得到 1 条对照记录并恢复表格。首次查询另一组无匹配条件时显示普通空结果提示。 |

10 次成功查询各新增一条 `platform.audit.query` 审计，元数据只含实际返回量，依次为 25、25、25、25、0、25、0、1、0、25。清理另有一条执行审计。邮件任务和尝试均为零。[查询实现](../../backend/src/platform/platform-audit-query.service.ts) · [页面实现](../../frontend/app/platform/audit/page.tsx)
