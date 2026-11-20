# 首次部署候选租户审计 H04 补验（2026-11-19）

候选 `a05251897d7fc11d96114606bcaa1807dd96af55`。本报告补充 [业务矩阵 H04](business-requirements-matrix.md#H04)。通过真实页面和本机 API 验证了组合筛选、稳定分页、租户和角色边界、CSV 字段与时间限制，以及查询和导出的审计。租户审计页的后续页入口和操作者条件下的导出缺口已分别登记为 [#204](https://github.com/omajilmanbo/poolduck-mail/issues/204) 和 [#205](https://github.com/omajilmanbo/poolduck-mail/issues/205)。

## 要求与保留边界

- [#78](https://github.com/omajilmanbo/poolduck-mail/issues/78) 要求经理在本租户内按时间、动作、结果和操作者筛选审计列表，分页稳定，提供基础页面和脱敏受控导出，并记录查询及导出本身。Issue 评论将导出列限定为时间、动作、资源、结果、脱敏元数据。Issue 未规定下载失败时的具体提示样式，也未明确导出必须接受操作者条件。[#78 原确认及完成记录](https://github.com/omajilmanbo/poolduck-mail/issues/78#issuecomment-5043760737)
- 访问边界以已接受的 [ADR-003](../decisions/ADR-003-tenant-context-and-subscription-gating.md) 和 [ADR-006](../decisions/ADR-006-platform-admin-role-boundary.md) 为准。服务端从会话取租户，租户经理只读本租户业务审计，operator 无权。平台审计另有独立授权。
- 保留边界以已接受的 [ADR-024](../decisions/ADR-024-business-record-retention-and-destruction.md) 为准，涵盖 Production 的 `audit_logs.created_at + interval '1 year'` 在线记录期限。它更新了 #78 早期评论的 90 天口径。租户待删除期间冻结当时尚存的业务审计，恢复后按原期限立即重新判定，无额外导出宽限。终结时物理销毁；[ADR-023](../decisions/ADR-023-platform-tenant-deletion-and-recovery.md) 的 Staging 即时清理与备份边界继续适用。本次不运行保留清理器。下载请求的 31 天跨度限制是另一项规则。

## 浏览器与 API 实测

合成库有两个租户和 36 条已知审计记录，其中 31 条命中租户 A 的组合条件，29 条命中记录具有同一时间戳。其余记录分别用于区分操作者、结果、动作、时间和外租户。夹具刻意在元数据写入合成完整邮箱、合成 Bearer 值和敏感键，核对读取与导出时的脱敏。

| 检查 | 观察到的行为 |
| --- | --- |
| 经理登录与筛选 | 从工作台“审计”进入 `/audit`，按日本时间输入两个时间端点，再按动作、结果和经理 UUID 查询。实际请求携带转换后的 UTC 时间和全部三个条件。动作大小写变换仍可匹配。首批为预期的 25 条，元数据敏感值已脱敏。 |
| API 分页 | 用同一会话、同样的四类筛选及首批 `next_cursor` 返回剩余 6 条，末页游标为空，非法游标为 400。两个分页边界的创建时间相同，ID 决定顺序，合计 31 个唯一记录，无重叠或漏行。 |
| 页面可达性 | 页面只消费首批 `items`。实际按钮为“查询”和“导出 CSV”，链接为“返回工作台”，无后续页入口。直接以 API 取到第 2 页后，网页仍显示首批 25 条。[#204](https://github.com/omajilmanbo/poolduck-mail/issues/204) |
| 操作者条件与导出 | 保持列表筛选时点击“导出 CSV”，实际请求带 `actor_user_id`，导出接口返回 HTTP 400（未知参数），未下载文件，浏览器记录未处理的“导出失败”。清空操作者后原时间、动作和结果条件均保留，可下载 32 条。问题已登记，是否支持按操作者导出待裁定。[#205](https://github.com/omajilmanbo/poolduck-mail/issues/205) |
| CSV 与范围 | 成功文件为 `audit-logs.csv`，UTF-8 BOM，有 32 行数据和表头，字段为 UTC 时间、动作、资源类型与 ID、结果及脱敏元数据。完整邮箱、Bearer 值、密码和正文标记均未出现。超 31 天与时间倒置均为 400。 |
| 一次查询 503、一次下载 503 | 浏览器路由分别拦截一次。查询保持原表，下载产生零文件。两种情况下页面可见内容和 `alert`／`status` 均无新增。出现未处理的“请求失败”和“导出失败”，再次操作均恢复 200。该观察交总控，未作为新的交互要求。 |
| 角色与租户隔离 | 同租户 operator 无“审计”入口，直达 `/audit` 返回工作台，列表和导出 API 均为 403。租户 A 经理查询 B 的 actor 得 0 条。B 经理用同样的时间、动作与结果只看到本租户的 1 条夹具，指定 A 的 actor 得 0 条。 |
| 查询和导出自审计 | 直接查合成库，共 7 条成功 `audit.query`，A 经理 5 条、B 经理 2 条。A 的计数分别为 25（三次）、6 和 0，B 的计数分别为 1 和 0。成功 `audit.export` 为 A 的 1 条，计数为 32。未发现角色或租户归属不一致的这两类记录，也没有把失败请求计为成功导出。 |

**D11 待产品裁定。** 方案 A 让租户审计 CSV 遵循当前操作者筛选。方案 B 在选有操作者时提示经理，须由经理明确清除该条件后才能导出，不自动扩大范围。[#205](https://github.com/omajilmanbo/poolduck-mail/issues/205)保留为候选缺口，[#204](https://github.com/omajilmanbo/poolduck-mail/issues/204)单独跟踪页面分页。D09 处理扫码工作台 CSV 的导出范围。查询和下载各一次 503 只记录为本次观察。

## 复核命令与范围

使用隔离的本机 Compose 环境。前后端仅绑定 loopback，数据库无宿主端口，配置为 `APP_ENV=local`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。浏览器仅允许访问本轮两个本机来源。

当次先在 backend 容器运行仓库的[基础种子脚本](../../backend/scripts/local-seed.mjs)，再导入临时 `seed-audit.cjs` 夹具，运行 `node history-lab/check-audit.cjs`，结束后清理实验容器和卷。上述 Compose 配置、夹具和浏览器驱动仅用于本次实验。仓库自带的回归可在 `backend/` 使用 `npm test -- --runTestsByPath test/audit.spec.ts test/audit-api.spec.ts` 运行，断言范围见[服务测试](../../backend/test/audit.spec.ts)与[HTTP 契约测试](../../backend/test/audit-api.spec.ts)。

Windows 后台 Chrome 157.0.8103.79、Node 24.16.0 与 Playwright 1.51.1。浏览器脚本退出 0，耗时约 2.6 秒。库内发送尝试为 0。退出后按 Compose 项目标签确认容器、网络与数据库卷均无残留。未覆盖并发写入下分页、5,000 行导出上限实测、默认时间输入的其他时区、平台审计界面和 Production 保留销毁。
