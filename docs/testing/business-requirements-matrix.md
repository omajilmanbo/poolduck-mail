# 业务要求与候选版本验证矩阵

本次核对 `origin/main` 的 [a05251897d7fc11d96114606bcaa1807dd96af55](https://github.com/omajilmanbo/poolduck-mail/commit/a05251897d7fc11d96114606bcaa1807dd96af55)，取证日期为 2026-11-19（JST）。合成租户从登录、按授权地点扫码，到等待、取消、mock 处理及历史回读，已有候选 CI 证据。同一候选另在本地隔离 PostgreSQL 上通过平台开通和整租户删除／恢复 HTTP 验收，以及删除、恢复、终结调度、即时删除补偿和迁移回退五项补验。平台首次开通的本地浏览器专项也已通过 7/7。动作修正、现场输入及部分运维门禁仍有具体缺口。

## 优先处理

| 顺序 | 影响与解除条件 |
| --- | --- |
| 1 | **不可逆的数据处理**。候选 CI 已验证迁移、记录保留和整租户终结事务。同 SHA 的本地 HTTP 验收和[五项数据库补验](candidate-tenant-database-2026-11-19.md)均已通过。上线前仍需核对日常清理的 1／10／100 灰度与前后计数、目标环境清理开关及人工放行、告警接收回执和备份副本的保留与销毁。见 [RET05](#RET05)–[RET08](#RET08)、[O06](#O06)、[O08](#O08)。 |
| 2 | **扫码后的历史解释**。[S08](#S08)、[S09](#S09) 的同状态异常提示、管理员纠错／漏扫补录已有 Accepted 规则，候选未实现完整流程。[#181][issue181]、[#182][issue182]、[#183][issue183] 分别跟踪。现场设备输入的证据边界另见 [S02](#S02)。 |
| 3 | **权限、审计与导出反馈**。平台 CLI 四种正常动作与会话撤销已验证，四条成功审计均缺 `request_id`，由[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192)跟踪。[P03](#P03) 已验证真实浏览器的首次开通与 CSV，仍需上线人员核对接收人并通过批准渠道交付。[P02](#P02)、[P04](#P04) 的并发及 P02 的开通故障回滚仍待验。[H03](#H03) 已复现两个导出按钮对空结果和单次 503 都缺反馈，由[#190](https://github.com/omajilmanbo/poolduck-mail/issues/190)跟踪。D09 单独裁定按钮采用页面条件（实测 28 行）还是当前地点近 30 天（33 行）。另补 S04、S06、S07 的隔离与并发边界，以及 H04 的租户审计翻页和导出。 |
| 4 | **对外开放与真实服务**。Q07 的 [#180][issue180] 跟踪首次正式通知。候选生产环境没有可获准使用的发信配置。O01–O08 列出扫码限流、完整性检查、备份恢复、通知、实际配额、IAM 和容量的证据边界。真实邮件窗口、商业计费、群发及 MFA 各有独立范围。这些事项不妨碍隔离 mock 回归。 |

## 如何读取与维护

按流程定位：[租户身份与基础资料](#A01) · [扫码与取消](#S01) · [邮件](#M01) · [历史、导出与手册](#H01) · [平台](#P01) · [删除与保留](#RET01) · [运维依赖](#O01) · [待定事项](#Q01)。

一行对应一个可单独验收的行为。**实现位置**链接到源码或明确标记缺失。**已核证据**用 B、F、DB、E 标出此 SHA 的 CI 断言。独立补验、历史报告与静态核对另有标记。**历史**带日期或来源，**静态**表示只核对代码／配置，**待定**表示仍缺决定。最后一列列出差异和可关闭它的验证，未列冲突的行按所引现行规则验收。优先顺序只用于安排补证，不构成发布批准。

更换候选时先固定 SHA 和 main run，逐个核对 checkout、job 日志、执行命令和测试断言，再更新受影响行。沿用行号，新增要求另起行。碰到改义或延期，保留旧来源和取代它的决定。Issue 状态以 GitHub 为准，提出日期、测试通过、合并与环境启用分别记录。保留聚合结果即可。

**来源范围**包括 [README](../../README.md)、[产品范围](../product.md)、[功能需求](../requirements.md)、[决策目录](../decisions/)、[架构](../architecture.md)、[API](../api.md)、[数据库](../database.md)、[用户手册](../user-guide.md)、[管理员手册](../admin-guide.md)、[操作手册](../operation.md)、[可观测性](../observability.md)、[测试策略](../testing.md)、[发布检查](../release.md)、[Issue 归档](../issue-archive.md) 与下表所引验收卡、GitHub Issue、评论和 PR。历史 [首批任务草案](../issue-backlog-initial.md) 的四个目标已分别落入工作台、地点映射、provider 和认证上下文。其中的内存原型和旧角色称谓不覆盖后续 ADR。

## 候选 CI 的实际执行范围

[main CI 44474610784](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784) 的五个 job 均成功，checkout 日志均指向上述 SHA。各步见 [候选 workflow](../../.github/workflows/ci.yml)。下文 B、F、DB、E 对应该表的 job。

| Job | 执行与结果 | 可作何种证据 |
| --- | --- | --- |
| [B · Backend checks](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135391998550) | Node 20，`npm ci`、build、typecheck、lint、Jest。30 套 273 项通过 | 服务、注入假 Prisma／provider 的 HTTP 契约，以及 schema／迁移文本断言。真正的 PostgreSQL 行为见 DB / E。 |
| [F · Frontend checks](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135391998213) | `npm ci`、Vitest、typecheck、lint、Next build。9 文件 72 项通过 | 组件、客户端、手册同步、四图生成／解码、分页等。该 job 没有单独的 `help:check` 步骤。 |
| [DB · ADR-017 PostgreSQL release gate](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135392615224) | PostgreSQL 16，依次完成 `test:tenant-lifecycle-migration`、`test:record-retention`、`test:platform-tenant-purge-transaction`、`test:tenant-retention-large`、`validate:adr017` | 租户迁移／受保护回滚、闰日／冻结与整批回滚、终结、25,000 个家族共 100,000 个关联行。取消截止前 1 ms 可取消，恰好截止和后 1 ms 可领取。3 worker 得 1 次领取和 1 次 attempt。40 个任务／2 worker 的领取 p95 634 ms、p99 647 ms、提前领取 0。 |
| [E · Critical E2E (success)](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135393096145) | PostgreSQL 16 + 合成 seed + Chrome。`test:e2e`，10 项通过 | 工作台用模拟成功结果看见“可取消等待中”到“已发送”。 |
| [E · Critical E2E (failure)](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784/job/135393096086) | 同一组浏览器场景，模拟失败。10 项通过 | 配置期望 `queued`，页面断言为“发送中”。此处未等待三次退避耗尽，也未断言数据库终态 `failed`。退避断言见 M03。 |

两组 E 各运行同样 10 项。[工作台 8 项](../../frontend/e2e/mvp-workspace.spec.ts) 包括登录／拒绝与命中扫码／刷新、跨租户历史 404、取消后刷新重登及断网、暂停订阅、人员管理、地点管理、operator 账号、地点授权与撤销。[平台 2 项](../../frontend/e2e/platform-control-plane.spec.ts) 拦截平台身份及关键写 API，验证窄屏操作、一次性凭据下载清除和删除确认。它们没有用实际平台账号走开通或删除事务。两组都使用模拟投递，job 依赖本身不能证明下游用户行为。

### 候选本地补验（2026-11-19）

同一候选的历史与导出补验使用后台 Chrome 和独立 PostgreSQL。34 条历史分为 25 条和 9 条。扫码、邮件两种 CSV 的工作台下载各得 33 条，按页面条件直接调用 API 各得 28 条。跨租户、角色拒绝和每种导出最新 5,000 行的上限均有实测。同日另验空地点及单次 503，两种导出均缺少可见反馈。见 [H01](#H01)–[H03](#H03) 和[浏览器与 CSV 补验](candidate-history-exports-2026-11-19.md)。

官方 `npm run smoke:platform` 在仅有 loopback 的本地 HTTP 服务与 PostgreSQL 16.16 上退出 0。脚本断言了平台／租户会话跨用均返回 401、trial 开通及顺序重放、首次改密后重登、地点额度和订阅变更。独立 CLI 验收另验证顺序初始化、轮换、禁用和恢复，恢复后四个旧会话的读取与刷新均返回 401。恢复账号前制作的备份在新 PostgreSQL 16 实例中完成 19 张表的行数及内容摘要比对。真实前后端的本地 Chromium 开通专项 7/7 通过，已覆盖成功页、CSV、清除后再进入、已检查的浏览器存储及首登改密。见 [P01](#P01)–[P04](#P04) 及[平台补验报告](candidate-platform-smoke-2026-11-19.md)。

部署任务从同一 SHA 构建镜像，用独立 PostgreSQL、合成资料、`MAIL_PROVIDER=mock` 和 `REAL_MAIL_SEND_ENABLED=false` 执行 `node scripts/tenant-deletion-acceptance-test.mjs`，退出码为 0。该脚本走真实 HTTP 验证平台鉴权、订阅及扫码／发送阻断、恢复、到期终结，以及临时数据库中模拟的 Staging 删除。取消的任务为 0 次 mock 调用，重新扫码的任务为 1 次（独立 `smoke:api`）。备份恢复和应用回退的结果见 O08。[候选验收脚本](../../backend/scripts/tenant-deletion-acceptance-test.mjs) · [本机演练记录（012f85c）](https://github.com/omajilmanbo/poolduck-mail/blob/012f85cfb98ffe316d87ff996e8c8f8f386ed7cd/docs/testing/first-deployment-rehearsal-2026-11-19.md)

同一 SHA 在隔离的 PostgreSQL 16.16 上另行验证删除事务、恢复事务、整租户终结调度、Staging 即时删除的故障补偿和三层迁移回退。五个入口均退出 0，各项执行后数据库清单相对起始清单的差异均为 0。恢复事务出现一条 `pg` 并发 `client.query()` 弃用警告，作为非阻塞观察保留。命令、耗时、断言和清理结果见[五项数据库补验](candidate-tenant-database-2026-11-19.md)。


## 租户身份、地点和人员

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="A01"></a>A01 | Web SaaS，登录后只在会话 tenant 下读取业务数据。前端不能通过 tenant 参数切换。[ADR-001][adr001]、[ADR-003][adr003]、[ADR-004][adr004]，[#6][issue6]、[#22][issue22]、[#33][issue33] | [jwt-auth.guard.ts](../../backend/src/auth/jwt-auth.guard.ts)、[auth.service.ts](../../backend/src/auth/auth.service.ts)、[扫码工作台](../../frontend/app/page.tsx) | B [auth-context.spec.ts](../../backend/test/auth-context.spec.ts) 验证两个角色、伪造 tenant 参数及非法角色。E 的实际 API 拒绝另一租户的地点历史。 | 跨租户覆盖按资源读写继续看 A05、S04、H01、P01。产品范围为在线浏览器，无离线或桌面客户端验收。 |
| <a id="A02"></a>A02 | 公开 tenant_code 为 10 位 Crockford Base32，规范化后解析内部 UUID。UUID 登录默认拒绝，显式回退窗口例外。[ADR-003][adr003]、[ADR-007][adr007]，[#90][issue90]、[#91][issue91] | [tenant-code.generator.ts](../../backend/src/tenants/tenant-code.generator.ts)、[auth.service.ts](../../backend/src/auth/auth.service.ts)、[schema.prisma](../../backend/prisma/schema.prisma) | B [tenant-code.spec.ts](../../backend/test/tenant-code.spec.ts) 测空白／大小写、碰撞重试与 5 次失败。[auth.spec.ts](../../backend/test/auth.spec.ts) 测正常模式和受控 UUID 回退。 | B [prisma-schema.spec.ts](../../backend/test/prisma-schema.spec.ts) 核对回填 SQL。已有租户在相应旧版本迁移前后的登录需带旧数据夹具验证。 |
| <a id="A03"></a>A03 | operator 用用户名或可选邮箱。tenant_manager 仅邮箱。按 @ 分区、租户内规范值唯一、拒绝保留名、无跨字段回退。[ADR-010][adr010]，[#98][issue98]、[#99][issue99] | [identity.ts](../../backend/src/auth/identity.ts)、[auth.service.ts](../../backend/src/auth/auth.service.ts)、[users.service.ts](../../backend/src/users/users.service.ts) | B [auth.spec.ts](../../backend/test/auth.spec.ts)、[users.spec.ts](../../backend/test/users.spec.ts) 验证无邮箱 operator、可选邮箱、manager 登录、非法名、规范化与重复身份。 | 同邮箱分属两个租户和旧身份迁移应以双租户真实 DB 复核。这与跨 tenant 会话授权分别取证。 |
| <a id="A04"></a>A04 | 统一登录失败提示。登录按 IP、tenant、identifier、组合指纹限流。服务不可达显示连接错误。[#59][issue59]、[#64][issue64]，[ADR-010][adr010] | [login-rate-limiter.service.ts](../../backend/src/auth/login-rate-limiter.service.ts)、[auth.service.ts](../../backend/src/auth/auth.service.ts)、[frontend/src/api/client.ts](../../frontend/src/api/client.ts)、[backend/src/main.ts](../../backend/src/main.ts) | B [auth.spec.ts](../../backend/test/auth.spec.ts) 对重复标识限流及失败形状取证，[cors.spec.ts](../../backend/test/cors.spec.ts) 检查允许 origin、PUT 和拒绝通配。F [smoke.test.tsx](../../frontend/test/smoke.test.tsx) 验证网络异常提示。 | 计数存于进程内。单测不能证明多实例共享计数或重启后持续生效。扫码限流另见 O01。 |
| <a id="A05"></a>A05 | access 15 分钟，refresh 7 天轮换，HttpOnly Cookie。退出当前设备，改身份／停用／重置撤销全部相关会话。[#64][issue64]、[#76][issue76]、[#80][issue80] | [auth.service.ts](../../backend/src/auth/auth.service.ts)、[auth.controller.ts](../../backend/src/auth/auth.controller.ts)、[users.service.ts](../../backend/src/users/users.service.ts)、[frontend/src/api/client.ts](../../frontend/src/api/client.ts) | B [auth.spec.ts](../../backend/test/auth.spec.ts) 验证 Cookie、轮换、单会话退出、停用拒绝。[users.spec.ts](../../backend/test/users.spec.ts) 检查批量撤销。E 验证退出重登。 | [#80][issue80] 评论期望值守 24 小时无需重新登录。用可控时钟串起到期透明刷新、重放、两设备及网络中断。Secure 的历史 HTTPS 证据见 O07。 |
| <a id="A06"></a>A06 | 每 tenant 当前一名 manager。只能管理本 tenant 的 operator。新增、修改／清空可选邮箱、启停、重置。密码至少 8 位含字母数字，停用／重置前确认。[ADR-006][adr006]、[ADR-010][adr010]，[#76][issue76]、[#77][issue77]、[#99][issue99] | [users.controller.ts](../../backend/src/users/users.controller.ts)、[users.service.ts](../../backend/src/users/users.service.ts)、[/users](../../frontend/app/users/page.tsx) | B [users.spec.ts](../../backend/test/users.spec.ts) 验证角色、跨 tenant／manager 目标相同 404、弱密码及撤销。F [users-page.test.tsx](../../frontend/test/users-page.test.tsx) 验证字段和确认。E 走账号管理流程。 | 另有 [#76][issue76] 评论要求讨论多 manager 及相互管理。现行方案已定，扩大权限待建 Issue，见 Q04。 |
| <a id="A07"></a>A07 | manager 原子替换 operator 的多个地点授权。零授权默认无地点，拒绝停用／外租户／重复地点。撤销后新请求立即生效。[#96][issue96]、[#97][issue97] | [location-access.service.ts](../../backend/src/location-access/location-access.service.ts)、[users.service.ts](../../backend/src/users/users.service.ts)、[/users](../../frontend/app/users/page.tsx) | B [operator-location-assignments.spec.ts](../../backend/test/operator-location-assignments.spec.ts)、[location-access.spec.ts](../../backend/test/location-access.spec.ts) 测替换、撤销、拒绝形状和审计。F [users-page.test.tsx](../../frontend/test/users-page.test.tsx) 测保存失败保留原值。E 重新登录后地点列表反映撤销。 | E 有重登。补两浏览器同时在线、旧会话继续读历史／写映射／取消的组合验证。 |
| <a id="A08"></a>A08 | trial/active 且未到 end_at 可发。expired/suspended、缺订阅或已到期禁止新扫码、创建、发送和重试。暂停仍能登录及按权限读历史。[ADR-003][adr003]、[ADR-009][adr009]，[#23][issue23]、[#64][issue64]、[#65][issue65] | [license.service.ts](../../backend/src/license/license.service.ts)、[scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts)、[扫码工作台](../../frontend/app/page.tsx) | B [license.spec.ts](../../backend/test/license.spec.ts)、[scan-events.spec.ts](../../backend/test/scan-events.spec.ts)、[mail-jobs.spec.ts](../../backend/test/mail-jobs.spec.ts)。DB 验证四种订阅领取结果及阻断不调 provider，E 验证暂停仍登录但输入禁用。 | 独立复核排队期间恰逢 end_at 的跨步骤边界。扫码页无续订提醒，商业规则见 Q02。 |
| <a id="A09"></a>A09 | manager 新增地点只填名称，生成 8 位 Crockford ID、类型固定 location。可编辑、停用及原 ID 重启用。[ADR-002][adr002]、[ADR-007][adr007]，[#24][issue24]、[#73][issue73]、[#74][issue74]、[#92][issue92] | [location-code.generator.ts](../../backend/src/locations/location-code.generator.ts)、[locations.service.ts](../../backend/src/locations/locations.service.ts)、[/locations](../../frontend/app/locations/page.tsx) | B [location-code.spec.ts](../../backend/test/location-code.spec.ts)、[management.spec.ts](../../backend/test/management.spec.ts) 验证重名、拒绝客户端 ID／类型、碰撞和重启用。F [management-pages.test.tsx](../../frontend/test/management-pages.test.tsx)，E 验证角色导航与管理操作。 | 停用时已排队邮件的门禁见 M02。人工地点额度独立见 P04。 |
| <a id="A10"></a>A10 | manager 和已获地点授权的 operator 可在当前地点维护人员姓名、邮箱、状态，不可跨地点移动。列表邮箱脱敏，受控编辑可见完整值。[#71][issue71]、[#72][issue72]、[#92][issue92]、[#93][issue93] | [locations.service.ts](../../backend/src/locations/locations.service.ts)、[/people](../../frontend/app/people/page.tsx) | B [locations.spec.ts](../../backend/test/locations.spec.ts)、[management.spec.ts](../../backend/test/management.spec.ts) 测角色、非法邮箱、跨 tenant 和移动拒绝。F [management-pages.test.tsx](../../frontend/test/management-pages.test.tsx) 测脱敏与受控表单。E 走创建、编辑、停用、重启用。 | 变更邮箱后旧任务和新任务应分别使用各自创建时的目标，见 M01。 |
| <a id="A11"></a>A11 | 人员公码 12 位，7 位 Unix 秒前缀加 5 位后缀。服务端生成、全局唯一、不随改名、停用或恢复更换。[ADR-007][adr007]，[#93][issue93] | [person-code.generator.ts](../../backend/src/locations/person-code.generator.ts)、[locations.service.ts](../../backend/src/locations/locations.service.ts)、[schema.prisma](../../backend/prisma/schema.prisma) | B [person-code.spec.ts](../../backend/test/person-code.spec.ts) 测不同秒排序、同进程同秒不重复，[management.spec.ts](../../backend/test/management.spec.ts) 测碰撞重试和审计不泄码。[prisma-schema.spec.ts](../../backend/test/prisma-schema.spec.ts) 核对回填与约束。 | 多实例同秒碰撞与既有表回填后逐条关系仍需数据库证据。 |
| <a id="A12"></a>A12 | 人员与地点独立删除，立即停止业务使用。14 天内恢复删除前状态。地点恢复不取消人员独立期限，到期匿名化当前资料、公码不可复用。[ADR-011][adr011]，[#104][issue104] | [locations.service.ts](../../backend/src/locations/locations.service.ts)、[deletion-purge.service.ts](../../backend/src/locations/deletion-purge.service.ts)、[frontend/src/deletion.ts](../../frontend/src/deletion.ts) | B [management.spec.ts](../../backend/test/management.spec.ts)、[deletion-purge.spec.ts](../../backend/test/deletion-purge.spec.ts) 测权限、截止拒绝、地点连带清理、撤销 assignment、人员幂等。F [management-pages.test.tsx](../../frontend/test/management-pages.test.tsx) 测剩余天数向上取整及恢复按钮。 | 用 DB 核对父子先后到期与同时恢复／清理。邮件资源门禁见 M02。在线历史的最终保留按 RET05–RET07。 |

## 扫码、动作与取消

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="S01"></a>S01 | 工作台须有当前授权地点、有效订阅和非空输入。扫码枪回车提交，显示动作、结果及异常，无正文预览／编辑。[#7][issue7]、[#55][issue55]–[#57][issue57]、[#65][issue65]，需求 §3.3.3 | [扫码工作台](../../frontend/app/page.tsx) 扫码表单、[frontend/src/api/client.ts](../../frontend/src/api/client.ts) | F [smoke.test.tsx](../../frontend/test/smoke.test.tsx) 验证禁用逻辑和请求形状。E 的工作台测试填入动作码后点击提交，断言等待、进入、结果、刷新。 | 页面通过表单 submit（回车或按钮）提交。无终止符的键盘流自动提交是否属于现场需求，见 Q05。 |
| <a id="S02"></a>S02 | 一人两种动作，各有 QR 与 Code 128，共四张本地 PNG。方向文字／图形、预览、单张与 ZIP 下载。载荷及文件名不含姓名、邮箱或内部 ID。[ADR-008][adr008]、[ADR-015][adr015]、[ADR-022][adr022]，[#101][issue101]、[#117][issue117]、[#150][issue150] | [person-action-codes.ts](../../frontend/src/codes/person-action-codes.ts)、[PersonActionCodesDialog.tsx](../../frontend/app/people/PersonActionCodesDialog.tsx) | F [person-action-codes.test.tsx](../../frontend/test/person-action-codes.test.tsx) 四图软件往返解码、文件名、PNG／ZIP、生成失败禁下载。E 人员流程下载资产。 | 代表性 Windows 布局尚缺候选输入记录。如需定位现场问题，可抽查实际设备及黑白打印件，[ADR-015][adr015] 未设型号准入。旧 V2 图片需更换，候选 CI 未验证实物重印。 |
| <a id="S03"></a>S03 | 严格 13 位 E/X + 12 位 Crockford 公码，可去掉一个终止符。拒绝旧 V2、PD1、裸码、非法动作／字符。[ADR-015][adr015] → [ADR-022][adr022]，[#118][issue118]–[#121][issue121]、[#150][issue150] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `parseActionCode`、[person-action-codes.ts](../../frontend/src/codes/person-action-codes.ts) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 多组畸形输入、旧格式和 CR、LF、CRLF。F [person-action-codes.test.tsx](../../frontend/test/person-action-codes.test.tsx) 反解现行语法。 | 保留旧格式失败回归。无双读、后台迁移或重新推断历史动作的验收项。 |
| <a id="S04"></a>S04 | 格式正确但在当前授权 tenant/location 找不到 active 人员时统一 SCAN_CODE_NOT_MAPPED。不写 event、case、job 或逐请求数据库审计，不补发。无权地点先过授权。[ADR-002][adr002]、[ADR-018][adr018]，[#66][issue66]、[#75][issue75]、[#122][issue122] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `createScanEvent`、[location-access.service.ts](../../backend/src/location-access/location-access.service.ts)、[20260806000000_remove_unmapped_scan_cases](../../backend/prisma/migrations/20260806000000_remove_unmapped_scan_cases/migration.sql) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 测查找范围、无持久化、跨 tenant 地点拒绝。E 验证未命中提示、历史中无该码。 | 补同一真实 DB 下 inactive／pending_delete／purged／外地点／外租户／随机合法码的响应与零写入逐项对账。登录或非法格式的安全审计另计。 |
| <a id="S05"></a>S05 | 成功时事务内创建扫码证据和唯一 waiting 任务，固化 action/source、原 person/location/tenant 及发送上下文。旧记录保留 unknown/legacy_unknown。[ADR-007][adr007]、[ADR-008][adr008]、[ADR-017][adr017]，[#25][issue25]、[#93][issue93]、[#95][issue95]、[#124][issue124] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts)、[schema.prisma](../../backend/prisma/schema.prisma) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 核对入／离动作与关联快照，[history.spec.ts](../../backend/test/history.spec.ts) 测旧记录不反推。E 命中后等待，再刷新回读。 | 补事务部分失败时无孤立 event/job 的端到端负例。有效期内改名与快照分离见 M01、M04。 |
| <a id="S06"></a>S06 | 24 小时请求幂等，按 tenant／路由／key 绑定规范地点、人员和动作。同请求返回原结果，不同指纹冲突。重放不重新发送。[ADR-008][adr008]、[ADR-017][adr017]，[#68][issue68]、[#125][issue125] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `findIdempotentReplay`、[frontend/src/api/client.ts](../../frontend/src/api/client.ts) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 测订阅变更前后重放、动作指纹改变、地点失效和非法 key。F [smoke.test.tsx](../../frontend/test/smoke.test.tsx) 核对提交。 | 补有效期刚到与双连接同 key、换地点／人员、取消后原 key 重放的同库计数。 |
| <a id="S07"></a>S07 | 独立的 10 秒去重按 tenant/location/person 串行。同动作返原记录、相反动作拒绝，取消后新 key 可立即重扫。[ADR-008][adr008]、[ADR-017][adr017]，[#68][issue68]、[#125][issue125] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `createScanEvent`、[scan-cancellation.sql.ts](../../backend/src/scan-events/scan-cancellation.sql.ts) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 同动作与相反动作。E 取消后重扫。DB 的三 worker 竞争测的是发送领取。 | 补双客户端并发提交、恰好 10 秒和跨租户／地点互不干扰的 DB 案例，核对 event、job、attempt 数。 |
| <a id="S08"></a>S08 | 10 秒窗口外连续同动作仍独立记录，在历史提示可能漏扫／误选。派生状态按 tenant/location，跨日不重置，取消动作排除。[ADR-008][adr008] §3、[ADR-017][adr017] §1，[#94][issue94]、[#95][issue95] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) 有显式动作及取消标记。[扫码工作台](../../frontend/app/page.tsx) 展示动作。未见同状态异常判定／提示。 | B [history.spec.ts](../../backend/test/history.spec.ts) 证实旧动作 unknown。[export.spec.ts](../../backend/test/export.spec.ts) 证实取消证据。两者均未断言连续动作异常。 | **候选实现缺口，[#181][issue181] 跟进。** 用首次 exit、跨午夜连续 entry、取消后重扫和不同地点的时间线验证，原邮件不得改写。 |
| <a id="S09"></a>S09 | 仅 tenant_manager 在授权范围内追加不可变 replace_action 或 insert_missing_action，含原因、操作者及声明时间。展示原值／修正标记，不创建或重发邮件。[ADR-008][adr008] §5，[#94][issue94]、[#95][issue95] | [scan-events.types.ts](../../backend/src/scan-events/scan-events.types.ts) 预留 manual_adjustment。[schema.prisma](../../backend/prisma/schema.prisma)、[scan-events.controller.ts](../../backend/src/scan-events/scan-events.controller.ts)、[扫码工作台](../../frontend/app/page.tsx) 未见 adjustment 表、写入口或界面。 | [#95][issue95] 与 [PR #103][pr103] 的实现记录覆盖动作、幂等及邮件。候选 B/F/E 均无修正闭环断言。 | **候选实现缺口。** [#182][issue182] 跟踪后端，[#183][issue183] 跟踪授权历史与操作 UI。 分别验错扫更正、漏扫补录、operator／外租户拒绝及 provider 零调用。10 秒取消解决的是另一操作。 |
| <a id="S10"></a>S10 | 以 DB 时间设置 cancel_until/send_not_before。10 秒截止前允许当前同地点任一获权 operator 或本租户 manager 取消。原动作保留并失效，重复取消幂等。恰好截止领取优先。[ADR-017][adr017]，[#123][issue123]–[#125][issue125]、[#127][issue127] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `cancelScanEvent`、[scan-cancellation.sql.ts](../../backend/src/scan-events/scan-cancellation.sql.ts)、[mail-job-claim.sql.ts](../../backend/src/mail-jobs/mail-job-claim.sql.ts) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 核对成功、重放、越权安全 404。DB [adr017-release-validation.mjs](../../backend/scripts/adr017-release-validation.mjs) 断言 ±1 ms、取消胜时 0 attempt、领取胜时 1 次。 | 补同地点非原操作者、撤权旧 session 和等待中订阅变更仍可取消的 HTTP 对照。 |
| <a id="S11"></a>S11 | 状态右侧倒计时以服务端时差为准。刷新、休眠或重登不延时。冲突／断网显示结果待确认并重新读取。[ADR-017][adr017]，[#128][issue128]、[#129][issue129] | [扫码工作台](../../frontend/app/page.tsx)、[frontend/src/api/client.ts](../../frontend/src/api/client.ts) | F [history-page.test.tsx](../../frontend/test/history-page.test.tsx) 测时间漂移、未知响应和刷新。E 390px 窗口验证按钮可达、取消持久化并模拟断网。 | 历史响应与取消 API 的时钟来源在多实例时需校核。最终成功以取消 API／数据库为准。 |

## 邮件内容、发送和追溯

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="M01"></a>M01 | 单个收件人取任务创建时持久化的映射邮箱。普通客户端不能指定或覆盖收件人、发件人、region、header 或正文。[#25][issue25]、[#26][issue26]、[#93][issue93]、[#136][issue136]、[#140][issue140]，[ADR-019][adr019] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts)、[oci-email-delivery.provider.ts](../../backend/src/mail-jobs/oci-email-delivery.provider.ts) | B [mail-jobs.spec.ts](../../backend/test/mail-jobs.spec.ts) 测覆盖字段／越权，[oci-mail-contract.spec.ts](../../backend/test/oci-mail-contract.spec.ts) 以 fake client 核对快照、单 To 和同 tenant attempt，[mail-job-retry.spec.ts](../../backend/test/mail-job-retry.spec.ts) 测新增地址快照。 | 扩充改名／换地址后旧任务、重试与新任务的两租户端到端对账，仅用合成地址。 |
| <a id="M02"></a>M02 | 初次 waiting 到期后 worker 自动领取，每次实际调用前重检订阅及地点／人员。手动处理 API 也不能越过等待窗、权限或终态。[ADR-003][adr003]、[ADR-011][adr011]、[ADR-017][adr017]，[#26][issue26]、[#61][issue61]、[#127][issue127] | [mail-job-processor.service.ts](../../backend/src/mail-jobs/mail-job-processor.service.ts)、[mail-job-claim.sql.ts](../../backend/src/mail-jobs/mail-job-claim.sql.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) | DB [adr017-release-validation.mjs](../../backend/scripts/adr017-release-validation.mjs) 验证多 worker 单 attempt、四态订阅、停用／删除中资源、恢复后可发。B [mail-jobs.spec.ts](../../backend/test/mail-jobs.spec.ts) 禁止跨 tenant、已发、提前手动触发。 | 合成领取 SLO 见 CI 表。这批次覆盖的 resource 组合与全流程权限撤销分开核对。 |
| <a id="M03"></a>M03 | 确认未接受的临时失败按 30 秒、2 分、10 分最多重试三次，耗尽 failed。queued 的 scheduled_at 独立于首次等待。[#69][issue69]、[#138][issue138]，[ADR-017][adr017]、[ADR-019][adr019] | [mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts)、[sandbox-mail.provider.ts](../../backend/src/mail-jobs/sandbox-mail.provider.ts) | B [mail-job-retry.spec.ts](../../backend/test/mail-job-retry.spec.ts) 按 retry_count/退避及耗尽断言，[mail-jobs.spec.ts](../../backend/test/mail-jobs.spec.ts) 测首次 mock 失败。E failure 只断言页面出现发送中。 | 候选浏览器无耗尽到终态、显示安全错误的全链证据。可用受控时钟验四次 attempt 与终态页面。 |
| <a id="M04"></a>M04 | 后端生成固定日文纯文本 v2。入室／退室、称呼、全角标点与换行按 [#151][issue151]，时刻取 DB 扫码时间转 Asia/Tokyo。UTC 原值保留，主题最多 255 字符，历史 v1/v2 重试均用原快照。[#5][issue5]、[#65][issue65]、[#95][issue95]、[#151][issue151]。[PR #156][pr156]、[PR #179][pr179] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `buildMailSubject/buildMailBody/formatJapanTimestamp`、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 验证两动作模板、东京午夜／跨年、UTC、补充平面字符与主题单行。[mail-job-retry.spec.ts](../../backend/test/mail-job-retry.spec.ts) 验证 fake 429 后 v1/v2 主题正文原样复用。 | [#151][issue151] 正文已说明如何修订原评论。候选断言覆盖模板与重试。真实客户端收件排版与 OCI 最终投递超出这些断言。 |
| <a id="M05"></a>M05 | 崩溃前未调用 provider 的旧领取可恢复。已越过调用边界但结果不明进入 delivery_unknown，不能自动或手动重发。[#127][issue127]、[#138][issue138]，[ADR-017][adr017]、[ADR-019][adr019] | [mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) `recoverStaleProcessingJobs`、[mail-job-processor.service.ts](../../backend/src/mail-jobs/mail-job-processor.service.ts) | DB [adr017-release-validation.mjs](../../backend/scripts/adr017-release-validation.mjs) 模拟调用前／后中断，B [mail-job-retry.spec.ts](../../backend/test/mail-job-retry.spec.ts) 验证 unknown 拒绝重试。[oci-mail-contract.spec.ts](../../backend/test/oci-mail-contract.spec.ts) 测异常和脱敏。 | 实际供应商异步对账为 O04。清理 unknown 时还需调用已结束证明，见 RET05。 |
| <a id="M06"></a>M06 | 默认 mock。OCI HTTPS 提交仅限经许可的 Staging，显式 provider、enable、身份和发件参数缺一即拒绝。每 attempt 有 opaque Message-ID，禁用 SDK 自行重试。[#85][issue85]、[#136][issue136]、[#137][issue137]、[#140][issue140]，[ADR-004][adr004]、[ADR-019][adr019] | [mail-provider.config.ts](../../backend/src/mail-jobs/mail-provider.config.ts)、[oci-email-delivery.provider.ts](../../backend/src/mail-jobs/oci-email-delivery.provider.ts)、[mail-message-id.ts](../../backend/src/mail-jobs/mail-message-id.ts) | B [mail-provider-config.spec.ts](../../backend/test/mail-provider-config.spec.ts) 检查工厂和错误配置，[oci-email-delivery-provider.spec.ts](../../backend/test/oci-email-delivery-provider.spec.ts)、[oci-mail-contract.spec.ts](../../backend/test/oci-mail-contract.spec.ts) 检查请求组装、单一目标、SDK retry 和回执标识。 | CI 只使用 mock/fake。生产接入没有已接受的启用方案。历史受控单封和未决条件见 O03–O05。 |
| <a id="M07"></a>M07 | sent 在 OCI 模式表示 accepted。suppressed／明确永久拒绝终止。确定未接受的 429 等有限退避。5xx、超时、断线、回执缺失为 unknown，普通视图只见安全失败信息。[ADR-019][adr019]，[#137][issue137]、[#138][issue138]、[#140][issue140] | [oci-email-delivery.provider.ts](../../backend/src/mail-jobs/oci-email-delivery.provider.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts)、[扫码工作台](../../frontend/app/page.tsx) | B [oci-email-delivery-provider.spec.ts](../../backend/test/oci-email-delivery-provider.spec.ts)、[oci-mail-contract.spec.ts](../../backend/test/oci-mail-contract.spec.ts)、[mail-job-retry.spec.ts](../../backend/test/mail-job-retry.spec.ts) 分别检查错误分类、结果、回执及调用次数。F [help-page.test.tsx](../../frontend/test/help-page.test.tsx) 核对状态语义。 | provider 接受、日志 relay 和收件确认要分别取证。迟到／乱序回执的产品状态仍待 [#146][issue146]。 |

## 历史查询、导出和用户手册

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="H01"></a>H01 | 扫码和邮件列表／详情只返回所属 tenant 及获权地点、安全字段。按时间和 ID 稳定翻页，旧人名无快照回退显示，保留取消原始动作。[#66][issue66]、[#67][issue67]、[#95][issue95] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts)、[location-access.service.ts](../../backend/src/location-access/location-access.service.ts)、[扫码工作台](../../frontend/app/page.tsx) | B [history.spec.ts](../../backend/test/history.spec.ts) 核对字段和游标，F [history-page.test.tsx](../../frontend/test/history-page.test.tsx) 测旧人名回退。同 SHA 本地用两租户、三地点核对扫码和邮件列表／明细。匿名列表 401，operator 访问未分配或外租户地点 404，manager 可读本租户其他地点，外租户明细仍为 404。失败明细隐藏完整地址、原始载荷、正文及原始错误。[浏览器与 CSV 补验](candidate-history-exports-2026-11-19.md)。 | 仍需验证翻页中并发插入、旧记录缺少姓名快照及地点已删除时的访问。相同时间戳跨页顺序已在 [H02](#H02) 实测。 |
| <a id="H02"></a>H02 | 扫码记录每页最多 25 条。状态及浏览器本地日期由服务端筛选，切地点／条件回首页。刷新、有限轮询和取消维持当前页，新扫描回未筛选首页。[#169][issue169]，[PR #178][pr178] | [扫码工作台](../../frontend/app/page.tsx)、[scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) `listScanEvents` | 同 SHA 本地浏览器将地点 A 的 34 条记录分成 25 + 9，跨页相同时间戳按 ID 稳定排序，无重复。第二页刷新保留原集合，改条件或切地点回首页。东京时区单日筛得 31 条，含 UTC 起止两端毫秒，再筛 sent 得 28 条（25 + 3）。F [history-page.test.tsx](../../frontend/test/history-page.test.tsx) 另测当前页轮询与取消。[浏览器与 CSV 补验](candidate-history-exports-2026-11-19.md)。 | 新扫码重置已有筛选、翻页中并发插入及其他浏览器／时区仍待实测。 |
| <a id="H03"></a>H03 | manager 可导出本租户扫码／邮件历史，受地点和时间边界约束，最多 31 天／5,000 行。收件地址部分脱敏、含原动作及取消状态，不带正文或秘密。[#79][issue79] | [scan-events.controller.ts](../../backend/src/scan-events/scan-events.controller.ts)、[mail-jobs.controller.ts](../../backend/src/mail-jobs/mail-jobs.controller.ts)、[扫码工作台](../../frontend/app/page.tsx) 导出按钮 | 同 SHA 本地 manager 在一天 + sent 条件下，工作台扫码和邮件 CSV 各下载当前地点近 30 天的 33 行，按页面条件调用对应 API 各下载 28 行。两种导出均验证 operator 无按钮且 API 返回 403、跨租户地点 404、超过 31 天返回 400。5,002 行中均导出最新 5,000 行。实测另核对导出审计计数、UTC、取消状态及地址脱敏。空地点各下载一个只有表头的 CSV。分别拦截一次 503 时各下载 0 个文件、各有一次未处理拒绝。两种情况均无导出反馈，重试恢复 200。B [export.spec.ts](../../backend/test/export.spec.ts) 测 CSV 转义。[浏览器与 CSV 补验](candidate-history-exports-2026-11-19.md)。 | [#190](https://github.com/omajilmanbo/poolduck-mail/issues/190)跟踪候选的反馈缺失。[PR #191](https://github.com/omajilmanbo/poolduck-mail/pull/191)的五项 CI 通过，核对时尚未合并。D09 单独处理工作台导出范围。[#79][issue79] 要求导出筛选结果，[#169][issue169] 将导出规则排除在该次改动之外。是否跟随页面条件或明确标示近 30 天，仍待产品裁定。 |
| <a id="H04"></a>H04 | manager 按日期、actor、action、result 查询／导出租户审计。访问本身留审计，敏感值脱敏，operator 和外租户无权。[#70][issue70]、[#78][issue78]，[ADR-003][adr003]、[ADR-006][adr006]、[ADR-024][adr024] | [audit.service.ts](../../backend/src/audit/audit.service.ts)、[audit.controller.ts](../../backend/src/audit/audit.controller.ts)、[/audit](../../frontend/app/audit/page.tsx) | B [audit.spec.ts](../../backend/test/audit.spec.ts) 测敏感信息、写库故障、范围和导出。[audit-api.spec.ts](../../backend/test/audit-api.spec.ts) 测角色与 token tenant。API 支持 next_cursor。UI 当前只消费 items。 | 补租户审计跨页可达性、加载／导出失败反馈与按钮权限。平台审计页面的翻页测试不覆盖此页。 |
| <a id="H05"></a>H05 | 登录前和租户工作台均可新窗口打开静态 HTML 手册。有键盘导航和返回入口，内容与用户手册共用来源。[#155][issue155]，[PR #178][pr178] | [/help](../../frontend/app/help/page.tsx)、[frontend/src/help/content.json](../../frontend/src/help/content.json)、[sync-help-guide.mjs](../../frontend/scripts/sync-help-guide.mjs) | F [help-page.test.tsx](../../frontend/test/help-page.test.tsx) 测无需业务请求、角色与邮件状态、两入口、键盘链接和 Markdown 同步。Next build 成功。 | 真实浏览器的弹窗策略／打印等未作为本候选验收。修改手册后复核同一同步测试。 |

## 平台控制面

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="P01"></a>P01 | 唯一 active 的 tenantless platform_admin，有独立登录、Cookie、audience、有限可撤销会话。不可读取／导出租户业务明细或冒充用户。[ADR-006][adr006]、[ADR-013][adr013]，[#82][issue82]、[#109][issue109]–[#113][issue113] | [platform-auth.service.ts](../../backend/src/platform/platform-auth.service.ts)、[platform-auth.guard.ts](../../backend/src/platform/platform-auth.guard.ts)、[platform-admin.mjs](../../backend/scripts/platform-admin.mjs)、[/platform/login](../../frontend/app/platform/login/page.tsx) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 测身份、会话及最小摘要，F [platform.test.tsx](../../frontend/test/platform.test.tsx) 测独立登录和 refresh。同 SHA 本地 HTTP 登录、读 `/me`、刷新和退出均成功。两类会话跨用 API 均返回 401，退出后复核唯一平台 Session 已撤销。本地 CLI 的 bootstrap、rotate、disable、recover 均退出 0，重复 bootstrap 按预期退出 1。恢复后四个旧会话的读取与刷新均为 401。恢复前备份在独立 PostgreSQL 16 核对 19 表一致。[平台 HTTP、数据库与 CLI 补验](candidate-platform-smoke-2026-11-19.md)。 | 四个成功动作各留下一条审计，四条 `request_id` 均为空，独立跟踪于[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192)。[PR #193](https://github.com/omajilmanbo/poolduck-mail/pull/193)提供关联标识修复，固定候选尚无该修复。并发 bootstrap、会话自然到期及正常轮换后旧 refresh 的重放尚待实测。 |
| <a id="P02"></a>P02 | 原子开通 tenant、唯一 manager、初始 trial/active 时间和正整数额度。失败整笔回滚，同 key 同请求取原结果，变参冲突。临时密码首次强制改密再登录。[ADR-013][adr013]，[#110][issue110]–[#113][issue113] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) `createTenant`、[auth.service.ts](../../backend/src/auth/auth.service.ts) `changeInitialPassword`、[/change-password](../../frontend/app/change-password/page.tsx) | 同 SHA 本地 HTTP 开通 trial，同 key 同请求顺序重放返回同一 tenant code，变参返回 409。本地独立浏览器上下文首登进入强制改密页，改密后旧口令重登为 401，新口令为 201 并进入工作台。数据库各新增一个租户、订阅、已改密管理员和开通幂等记录。B [platform.spec.ts](../../backend/test/platform.spec.ts) 另断言安全重放返回原临时口令。[平台 HTTP／数据库补验](candidate-platform-smoke-2026-11-19.md)。 | 补 active 初始开通、同 key 并发、开通故障整笔回滚、改密前租户业务访问限制，以及改密前签发的旧会话是否失效。 |
| <a id="P03"></a>P03 | 开通成功页临时展示一次性初始凭据。可下载 UTF-8 CSV，离开／清除后收起，不经日志或浏览器持久存储交付。[PR #115][pr115]、[PR #132][pr132]，管理员手册 §2 | [tenant-provisioning-csv.ts](../../frontend/src/platform/tenant-provisioning-csv.ts)、[/platform](../../frontend/app/platform/page.tsx) | 候选本机 Chromium 接实际 Next、Nest 和 PostgreSQL，专项 7/7 通过。成功页四个字段与 CSV 一致。同会话新标签只见摘要，清除后凭据区与下载按钮消失，经审计页返回也未重现。受检 Web Storage、IndexedDB、Cache Storage 和 Cookie 均未检出临时口令或完整经理邮箱。F [CSV 单测](../../frontend/test/tenant-provisioning-csv.test.tsx) 另验公式防护。[平台补验报告](candidate-platform-smoke-2026-11-19.md)。 | 上线人员须核对实际接收人，通过批准的安全渠道交付明文 CSV，受控保管并在交付后删除。 |
| <a id="P04"></a>P04 | 平台可人工调整订阅和 location_limit，暂停／恢复、降额均需确认、版本与审计。active/inactive/pending 均占额，purged 释放。满额拒绝创建，不得降至用量以下。[ADR-009][adr009]、[ADR-013][adr013]，[#73][issue73]、[#109][issue109]、[#111][issue111] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) `updateSubscription/updateLocationLimit`、[locations.service.ts](../../backend/src/locations/locations.service.ts)、[/platform](../../frontend/app/platform/page.tsx) | 本地 HTTP 在额度 2 时建成两个地点，第 3 个被拒，降至 1 被拒，提至 3 成功。按当前版本先暂停再启用订阅，数据库终值为额度 3、地点 2、订阅 active，成功审计与操作顺序一致。B [platform.spec.ts](../../backend/test/platform.spec.ts) 测满额及订阅与删除互斥，[schema 测试](../../backend/test/prisma-schema.spec.ts) 核对旧租户额度回填。[平台 HTTP／数据库补验](candidate-platform-smoke-2026-11-19.md)。 | 补提额后再建、旧版本写入、并发争最后一个名额或降额、停用及待删地点占额和终结后的额度释放。商业计费见 Q02。 |
| <a id="P05"></a>P05 | 只有平台管理员能查看后端当前实际发信模式。失败／不可判定显示未知，响应不含凭据或发件配置。[#149][issue149]，[PR #156][pr156] | [platform-auth.controller.ts](../../backend/src/platform/platform-auth.controller.ts)、[mail-provider.config.ts](../../backend/src/mail-jobs/mail-provider.config.ts)、[/platform](../../frontend/app/platform/page.tsx) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 检查受保护接口、最小响应。F [platform.test.tsx](../../frontend/test/platform.test.tsx) 测 mock、OCI 和未知 UI。 本机跨端口浏览器的邮件模式与环境 GET 均被 CORS 预检拦下，已配置 mock 的控制台显示“状态未知”。[平台补验报告](candidate-platform-smoke-2026-11-19.md)。 | [#195](https://github.com/omajilmanbo/poolduck-mail/issues/195)跟踪本机跨端口读取。环境 API 在 `APP_ENV=local` 的预期响应为 `environment=unavailable`、`deletion_enabled=false`。此轮未测试生产环境。单封投递结果见 M07／O04。 |
| <a id="P06"></a>P06 | 平台独立审计只读。按时间、管理员、动作、结果、目标 tenant 过滤，每页 25 条，可前后翻页。已清理目标与失效 Session 安全展示，禁止租户 audit 明细。[#174][issue174]、[#175][issue175]，[ADR-024][adr024] | [platform-audit-query.service.ts](../../backend/src/platform/platform-audit-query.service.ts)、[platform-audit-query.controller.ts](../../backend/src/platform/platform-audit-query.controller.ts)、[/platform/audit](../../frontend/app/platform/audit/page.tsx) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 测身份、无效过滤／游标、分页和安全元数据白名单。F [platform-audit.test.tsx](../../frontend/test/platform-audit.test.tsx) 测筛选、翻页、空／失败／Session 过期。 | [#175][issue175] 要求角色边界 E2E，当前平台两项 E 均未访问平台审计页。补真实 HTTP、查询审计落库失败时拒返，以及清理后页面摘要。 |

## 租户删除、恢复与在线数据保留

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="RET01"></a>RET01 | 以受信任环境决定删除策略。仅有效平台 Session、当前管理员重新验密、核对目标和影响。active 订阅两环境均不能删。重复请求不得展期或重复删除。[ADR-023][adr023]，[#149][issue149]、[#157][issue157]、[#160][issue160]、[#165][issue165] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts)、[platform-auth.controller.ts](../../backend/src/platform/platform-auth.controller.ts)、[/platform](../../frontend/app/platform/page.tsx) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 测身份、验密和环境。F [platform.test.tsx](../../frontend/test/platform.test.tsx) 测密码清除、双击和未知。DB [生命周期迁移](../../backend/scripts/tenant-lifecycle-migration-test.mjs) 验证守卫及重复 deploy。同 SHA 本地 HTTP 验证平台与租户鉴权，本地事务覆盖 active 订阅拒绝后状态保持、删除重放和 Staging 错误验密。[数据库补验结果](candidate-tenant-database-2026-11-19.md)。 | CI 的窄屏删除拦截平台 API。目标环境的部署后合成核对另按验收卡执行。 |
| <a id="RET02"></a>RET02 | Production 删除原子保存原状态并转 pending_delete + suspended。保持原登录／读取权限，禁止新扫码和待发送任务调用 provider。不另撤销会话或批量取消。[ADR-023][adr023] 的修订，[#158][issue158]/[#159][issue159] 已撤销，[#160][issue160]、[#166][issue166] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) `deleteTenant`、[license.service.ts](../../backend/src/license/license.service.ts)、[mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 测失败和重放。候选本地 HTTP 验证 pending_delete 期间读写及发信门禁。本地[删除事务脚本](../../backend/scripts/platform-delete-transaction-test.mjs) 验证并发删除只写一次、重放原时间、与订阅更新竞争及失败回滚。[执行结果](candidate-tenant-database-2026-11-19.md)。 | 上述结果来自隔离库中的 Production 业务分支。实际部署的环境选择和清理开关须单独核对。 |
| <a id="RET03"></a>RET03 | Production 一日历年内可恢复，DB 时间严格小于 purge_after。恢复原状态、订阅期限及人员／地点独立删除状态，已终止邮件不重排。截止时不能恢复。[ADR-023][adr023]，[#161][issue161]、[#165][issue165]、[#166][issue166] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) `restoreTenant`、[/platform](../../frontend/app/platform/page.tsx) | B [platform.spec.ts](../../backend/test/platform.spec.ts) 和 F [platform.test.tsx](../../frontend/test/platform.test.tsx) 验证恢复规则和页面入口。本地[恢复事务脚本](../../backend/scripts/platform-restore-transaction-test.mjs) 验证截止前 1 ms、恰好截止及后 1 ms 的 SQL 比较、恢复与条件更新争用、并发恢复只成功一次、独立删除状态、过期订阅发信阻断、失败邮件不重排及注入故障回滚。[执行结果](candidate-tenant-database-2026-11-19.md)。 | 清理认领竞态用 SQL 条件更新模拟。实际整租户终结调度的双 worker 与重试另见 [RET08](#RET08)。 |
| <a id="RET04"></a>RET04 | Staging 显式开关才立即物理清理。失败保持 staging_deleting 阻断，重新验密重试。成功按图清零，只留安全平台结果。没有恢复。10 分钟外无可信结果显示未确认。[ADR-023][adr023]，[#164][issue164]–[#166][issue166] | [platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) `deleteStagingTenant/purgeStagingTenant`、[/platform](../../frontend/app/platform/page.tsx) | F [platform.test.tsx](../../frontend/test/platform.test.tsx) 测提示和隐藏恢复入口。同 SHA 本地 HTTP 验证目标关联清零。[即时删除](../../backend/scripts/staging-tenant-deletion-test.mjs) 验证注入故障后仍阻写、补偿后只留一条脱敏结果审计、重复删除与邻租户隔离。[三层回退](../../backend/scripts/tenant-deletion-rollback-test.mjs) 验证删除状态阻挡回退，清除合成状态后可逆序撤销迁移。[执行结果](candidate-tenant-database-2026-11-19.md)。 | 即时删除使用本地 Staging 业务分支。[历史 Staging 演练](staging-smoke-2026-10-20-issue168.md) 仅确认当时的开关配置。实际环境的部署后验证另行记录。 |
| <a id="RET05"></a>RET05 | 在线记录按根 scan_event.created_at 加一日历年，家族按 FK 顺序整体销毁。未终态、未完成 attempt、在途及 unknown 未证明调用闭合时阻断。[ADR-024][adr024]，[#170][issue170]、[#171][issue171] | [record-retention.service.ts](../../backend/src/retention/record-retention.service.ts)、[20261022000000_record_retention_scan_indexes](../../backend/prisma/migrations/20261022000000_record_retention_scan_indexes/migration.sql) | DB [record-retention-transaction-test.mjs](../../backend/scripts/record-retention-transaction-test.mjs) 断言闰日、早／到期、非终态及 unknown / provider_call_closed_at、外 tenant 拒绝、FK 故障回滚及索引回滚守卫。 | 清理器默认关。该测试直接调用 service。调度器配置、积压及对外通知链分别见 RET08、O06。 |
| <a id="RET06"></a>RET06 | 租户业务和平台审计各自按 created_at 加一年。删除窗口冻结该 tenant 既存业务记录和相关平台审计，恢复后超期记录立即重获资格，无额外导出宽限。[ADR-024][adr024]，[#172][issue172]、[#173][issue173] | [record-retention.service.ts](../../backend/src/retention/record-retention.service.ts)、[platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) | DB [record-retention-transaction-test.mjs](../../backend/scripts/record-retention-transaction-test.mjs) 验证冻结期候选排除、恢复后可选、两类审计清除、故障回滚及其他租户保留。 | 该脚本直接设置冻结状态。真实 HTTP 恢复与下一轮 TTL 的衔接、平台清理结果审计的独立时钟仍需组合验证。 |
| <a id="RET07"></a>RET07 | Production 租户到期销毁在线扫码／邮件／回执／幂等／业务审计，再把基本对象改为不可复用非 PII 墓碑，释放授权和会话。在途邮件阻断，失败后可重试。[ADR-023][adr023] 经 [ADR-024][adr024] 修订，[#162][issue162]、[#170][issue170]–[#173][issue173] | [platform-tenant-purge.service.ts](../../backend/src/platform/platform-tenant-purge.service.ts)、[record-retention.service.ts](../../backend/src/retention/record-retention.service.ts) | DB [platform-tenant-purge-transaction-test.mjs](../../backend/scripts/platform-tenant-purge-transaction-test.mjs) 核对未到期、在途、失败回滚、重试、墓碑和隔离。[tenant-retention-large-test.mjs](../../backend/scripts/tenant-retention-large-test.mjs) 核对 25,000 组各 4 行销毁及邻租户不变。 | 十万是关联行数，非租户数或吞吐承诺。备份副本、OCI 日志、运行日志有独立生命周期，见 O04、O06、O08。 |
| <a id="RET08"></a>RET08 | 日常清理与整租户终结各有独立默认关闭开关。日常每分钟各类批量 1–100，按全局到期顺序。租户终结每分钟最多 20 个，失败保留暂停并重试，告警和前后计数须可核对。[ADR-023][adr023]、[ADR-024][adr024]，[#163][issue163]、[#166][issue166]、[#176][issue176] | [record-retention-scheduler.service.ts](../../backend/src/retention/record-retention-scheduler.service.ts)、[platform-tenant-purge-scheduler.service.ts](../../backend/src/platform/platform-tenant-purge-scheduler.service.ts)、[record-retention-counts.mjs](../../backend/scripts/record-retention-counts.mjs) | DB 验证事务及数量。同 SHA 本地[整租户终结调度脚本](../../backend/scripts/platform-tenant-purge-scheduler-test.mjs) 用 25 个合成租户、两个 worker 验证首轮处理 20 个，重建调度器后完成余下 5 个，共 25 条成功审计。另验故障重试、错误环境拒绝和结构化日志。[执行结果](candidate-tenant-database-2026-11-19.md)。 | 日常逐记录清理仍须按[发布执行卡](adr024-release-acceptance.md) 核对 1／10／100 灰度及 `retention:counts` 前后计数。目标环境的两个开关、启停和告警回执分别取证。 |

## 运维、外部依赖与未立项要求

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="O01"></a>O01 | 上线前扫码限流、低基数拒绝指标、合并告警。类别应区分 invalid_format、not_mapped、authorization_denied、subscription_denied、rate_limited。限流／指标失效不得放宽门禁。[ADR-018][adr018]，[#126][issue126] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) 有拒绝分支。[login-rate-limiter.service.ts](../../backend/src/auth/login-rate-limiter.service.ts) 只管登录。未见完整扫码限流／五类聚合出口。 | B/E 覆盖若干业务拒绝。没有候选测试断言扫码 429、跨实例窗口或通知。[#126][issue126] 评论明确暂缓。 | 确定对外上线时的维度、窗口、阈值、降级、值班人及验收，保持开放。暂缓不能作为已获上线豁免。 |
| <a id="O02"></a>O02 | 迁移／恢复／seed 后离线检查人员与地点 tenant 一致、公码唯一、状态与删除时间兼容、成功历史 FK 完整，仅报安全计数。[ADR-018][adr018] 决策 §8、测试策略 第4.7b | [schema.prisma](../../backend/prisma/schema.prisma)、[prisma-smoke-test.mjs](../../backend/scripts/prisma-smoke-test.mjs)、[local-seed.mjs](../../backend/scripts/local-seed.mjs) 有局部约束及检查。未见覆盖四项的统一离线核验。 | B [prisma-schema.spec.ts](../../backend/test/prisma-schema.spec.ts) 是 schema／SQL 检查，DB 测特定事务的 FK。均未证明离线检查能识别四类合成异常。 | 待建或补入 [#126][issue126] 相关跟进。先确认检查入口及结果责任人，再逐类核验失败计数与告警。 |
| <a id="O03"></a>O03 | 真实 OCI 需有效发件域、DNS、approved sender、最小 IAM 与独立启用确认。非目标身份／sender 的拒绝和 tenancy 实际配额分别验收。[ADR-019][adr019]、[ADR-020][adr020]，[#85][issue85]、[#139][issue139]、[#141][issue141]、[#144][issue144] | [mail-provider.config.ts](../../backend/src/mail-jobs/mail-provider.config.ts)、[email-delivery.tf](../../infrastructure/oci-staging/email-delivery.tf)、[oci-mail-rate-limiter.ts](../../backend/src/mail-jobs/oci-mail-rate-limiter.ts) | B [oci-mail-rate-limiter.spec.ts](../../backend/test/oci-mail-rate-limiter.spec.ts) 验证跨租户共用节流、50 ms 间隔、滚动秒最多 20、读窗口失败关闭。历史 [staging-oci-mail-single-send-2026-10-16.md](../../docs/testing/staging-oci-mail-single-send-2026-10-16.md) 仅证正向。 | [#139][issue139] 缺目标 compartment 有效分钟／日／消息大小配额。[#141][issue141] 缺负面 IAM 证据。[ADR-021][adr021] 已 Rejected，不恢复其前置门禁。 |
| <a id="O04"></a>O04 | 每次真实提交应可用稳定标识人工核对 accepted／relayed、bounce、complaint、suppression。unknown 禁止自动重发。小批量连续发送需独立窗口、逐封对账和回滚。[#85][issue85]、[#142][issue142]–[#146][issue146]、[#153][issue153] | [oci-email-delivery.provider.ts](../../backend/src/mail-jobs/oci-email-delivery.provider.ts)、[oci-mail-staging-operator-runbook.md](../../docs/oci-mail-staging-operator-runbook.md)、[oci-mail-staging-readiness.md](../../docs/oci-mail-staging-readiness.md) | B 仅 fake。历史 [staging-oci-mail-single-send-2026-10-16.md](../../docs/testing/staging-oci-mail-single-send-2026-10-16.md) 记录一次成功 attempt、accept/relay、受控收件确认及回滚 mock。 | [#145][issue145] 的单封已归档。[#153][issue153] 小批量未验，数量／间隔／停止阈值待批准。[#146][issue146] 的产品级回执是独立延期设计，见 Q03。 |
| <a id="O05"></a>O05 | 持续容量以有效扫码、积压排空及 worker 领取延迟衡量。短 burst 与 provider 失败／重试峰值分开验。[#116][issue116]、[#152][issue152]，[PR #133][pr133]、[PR #134][pr134] | [capacity-load-test.mjs](../../backend/scripts/capacity-load-test.mjs)、[capacity-db-report.mjs](../../backend/scripts/capacity-db-report.mjs)、[capacity-monitor.sh](../../deploy/staging/capacity-monitor.sh) | 历史 [staging-capacity-result-2026-09-24.md](../../docs/testing/staging-capacity-result-2026-09-24.md) 在模拟成功路径 steady 20 并发 19.211 RPS、p95 50 ms。40 并发时领取超限。候选 DB 的 40 任务 SLO 见上表。 | [#116][issue116] 的 provider-failure 与长期采集未完成，[#152][issue152] 的候选 burst 和排空曲线未验。按合成 mock 计划核对阈值、时长、资源水位。持续监控和 worker 扩展建议待查重立项。 |
| <a id="O06"></a>O06 | 运行日志分环境建议 7/30/90 天，脱敏、故障响应和通知可追溯。OCI 邮件原始日志独立 90 天。[ADR-020][adr020] 要求七类安全指标、心跳和异常告警。[#39][issue39]、[#129][issue129]、[#142][issue142]、[#163][issue163]、[#176][issue176] | [oci-mail-app-metrics.service.ts](../../backend/src/mail-jobs/oci-mail-app-metrics.service.ts)、[mail-job-processor.service.ts](../../backend/src/mail-jobs/mail-job-processor.service.ts)、[email-delivery.tf](../../infrastructure/oci-staging/email-delivery.tf)、[observability.md](../../docs/observability.md) | B [oci-mail-app-metrics.spec.ts](../../backend/test/oci-mail-app-metrics.spec.ts)、[mail-job-processor.spec.ts](../../backend/test/mail-job-processor.spec.ts) 验固定维度／部分写失败／超过 5 秒和积压，[audit.spec.ts](../../backend/test/audit.spec.ts) 验敏感字段。历史 [staging-oci-mail-admission-2026-10-14.md](../../docs/testing/staging-oci-mail-admission-2026-10-14.md) 核实 9 条启用告警，并引用先前的合成通知送达记录。 | 日志策略与收件确认分开。Production 的 API 延迟／5xx、拒绝、邮件／清理积压、通知合并、值班与恢复回执未验。不可把运行日志期限用于 RET05/RET06。 |
| <a id="O07"></a>O07 | Staging 采用人工批准的部署、健康检查与恢复路径，Caddy 负责 TLS、80 跳转／ACME、443 同源路由，内部服务端口受限。[ADR-005][adr005]、[ADR-012][adr012]，[#35][issue35]–[#37][issue37]、[#48][issue48]、[#58][issue58]、[#86][issue86]、[#107][issue107] | [docker-compose.staging.yml](../../docker-compose.staging.yml)、[Caddyfile](../../deploy/staging/caddy/Caddyfile)、[staging-manual.md](../../docs/staging-manual.md)。[ADR-005][adr005] 的独立幂等部署脚本仍待建 Issue。 | 历史 [staging-smoke-2026-07-29.md](../../docs/testing/staging-smoke-2026-07-29.md) 验 TLS／跳转、Cookie、内部端口和证书卷复用。[staging-smoke-2026-10-20-issue168.md](../../docs/testing/staging-smoke-2026-10-20-issue168.md) 有旧 SHA 健康与 mock smoke。 | 候选 CI 无部署 job。证书续期、幂等重跑／中断恢复和 Production 入口都没有本次执行证据。保留人工恢复手册。 |
| <a id="O08"></a>O08 | Production 备份／恢复与在线销毁分开决定。首次发布需迁移审阅、可还原备份或适用性决定、回滚验证、健康及 smoke、监控与人工放行。[#38][issue38]，[ADR-005][adr005]、[ADR-023][adr023]、[ADR-024][adr024]，发布规范 第2 | [deployment.md](../../docs/deployment.md)、[operation.md](../../docs/operation.md)、[release.md](../../docs/release.md)、[backend/prisma/rollback](../../backend/prisma/rollback)。[#38][issue38] 的 Production 方案按评论搁置。 | DB 的 guarded rollback 与 E 的空库迁移覆盖两条独立路径。同 SHA 本地补验实际在第二个 PostgreSQL 实例恢复合成备份，19 张表的行数和内容一致，候选可读 3 条已有历史。旧镜像回退后亦可读并完成新的 mock 扫码与取消。 | 确认正式环境 RPO/RTO、备份权限、保留／清除和定期恢复责任。本地合成恢复不覆盖生产备份副本或真实通知。 |

## 仍待产品决定或明确延期的事项

| 编号 | 业务要求与来源 | 实现位置 | 已核证据 | 剩余缺口与下一步 |
| --- | --- | --- | --- | --- |
| <a id="Q01"></a>Q01 | 群发模块作为需求结构保留，收件范围、审批、预览、定时／取消、重试、退订与审计尚待决策。需求 §3.4，[#84][issue84] | 未见群发写入口。现行 [mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) 是单次扫码的单个收件人。 | M01 有单目标断言。[#84][issue84] 评论要求接入后确认发信履历。候选无群发验收。 | 先明确是否纳入某一版本及整组权限／防误发规则，再立实现项。当前不把单封重试算作群发。 |
| <a id="Q02"></a>Q02 | 商业计费、套餐余量、≤30 天续订提醒、按启用地点／人员边际阶梯及 proration 延后。[ADR-009][adr009]、[ADR-013][adr013]，[#83][issue83]、[#102][issue102] | [license.service.ts](../../backend/src/license/license.service.ts) 处理安全门禁。P04 是平台人工容量。未见商业计费服务。 | [#83][issue83] 已按 not planned 关闭。[#102][issue102] 中的折扣、人数与阈值是候选，现行 CI 没有计价验收。 | 商业化启动前另决价格、审批、上限和计费周期。既有人工容量照 P04 验证。 |
| <a id="Q03"></a>Q03 | 未来产品级异步回执按租户追加，处理延迟、乱序、幂等与保留期。当前只做人工对账。[ADR-019][adr019]，[#85][issue85]、[#146][issue146] | [mail-jobs.service.ts](../../backend/src/mail-jobs/mail-jobs.service.ts) 保存提交标识，[oci-mail-staging-readiness.md](../../docs/oci-mail-staging-readiness.md) 给出人工核查路径。 | M06/M07 有提交契约。O04 的单封有 relay 事实，未见候选 delivered／bounced 产品状态或摄取测试。 | [#146][issue146] 为可选设计，待定权限、数据保留、是否显示及回滚，不作为现行 sent 的附加含义。 |
| <a id="Q04"></a>Q04 | 邮箱自助注册／验证和首个 manager 的找回由 [#100][issue100] 决策。现行独立平台人工开通。[#76][issue76] 评论另提多 manager 数量／相互管理。[ADR-006][adr006]、[ADR-010][adr010]、[ADR-013][adr013] | [users.service.ts](../../backend/src/users/users.service.ts) 只管 operator，[platform-tenants.service.ts](../../backend/src/platform/platform-tenants.service.ts) 人工开通首位 manager。无自助注册／同级互管产品入口。 | B [users.spec.ts](../../backend/test/users.spec.ts) 验拒绝管理 manager。P02 有首登证据。[#100][issue100] 已暂缓。多 manager 请求可追溯到[原评论](https://github.com/omajilmanbo/poolduck-mail/issues/76#issuecomment-5043755370)。 | 区分 manager 丢失身份后的受控恢复、平台 admin CLI 恢复及多 manager 改权。后者未找到独立 Issue，须先定人数／权限。 |
| <a id="Q05"></a>Q05 | 无回车后缀的设备是否需要在最后一个字符到达时自动提交。需求 §3.3.3 的“自动发送或回车”与手册操作顺序需明确。 | [扫码工作台](../../frontend/app/page.tsx) 输入变化只保存值，表单提交才发请求。[scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts) 接受无后缀的完整载荷。 | S01/S03 的浏览器点击及解析测试均不能回答设备何时触发表单。[ADR-015][adr015] 已定代表性布局，无厂牌准入清单。 | 先确认现场可配置 Enter 是否满足目标。若也承诺无终止符自动提交，再定重复输入边界并建项。 |
| <a id="Q06"></a>Q06 | 平台 TOTP、恢复码、丢失设备／紧急恢复延后。[ADR-013][adr013]，[#114][issue114] | [platform-auth.service.ts](../../backend/src/platform/platform-auth.service.ts)、[platform-admin.mjs](../../backend/scripts/platform-admin.mjs) 为密码、限流、有限 Session 和受控 CLI 路径。 | B/F 的独立平台登录与权限测试见 P01。[platform.test.tsx](../../frontend/test/platform.test.tsx) 明确校验当前表单无 MFA 字段。 | [#114][issue114] 另决绑定、密钥保护、重放、恢复与审计。MVP 未承诺 TOTP。 |
| <a id="Q07"></a>Q07 | 首次真实业务通知的 Production 准入。产品目标要求可送达通知。环境规范禁用生产 mock，[ADR-019][adr019] 的真实 provider 只获 Staging 范围。[#180][issue180]（候选后的跟进） | [environments.md](../../docs/environments.md)、[mail-provider.config.ts](../../backend/src/mail-jobs/mail-provider.config.ts)、[mail-provider-config.spec.ts](../../backend/test/mail-provider-config.spec.ts)。候选没有同时满足这两项的生产配置。 | B 与 O04 分别证明 fake 契约及过去受控 Staging 单封。没有生产准入决定或候选生产投递证据。 | [#180][issue180] 负责提交业务选择与停止条件供审核。保留现有环境门禁，隔离演练可独立继续。 |
| <a id="Q08"></a>Q08 | 可编辑邮件模板为需求 §4.3 的后续候选。当前固定模板生效。Web SaaS 产品边界排除离线／桌面、复杂编排、全量 BI、多区域灾备与高级合规认证。[ADR-001][adr001]、[ADR-004][adr004]、[#151][issue151] | [scan-events.service.ts](../../backend/src/scan-events/scan-events.service.ts)、[扫码工作台](../../frontend/app/page.tsx)、[product.md](../../docs/product.md)。没有 MVP 自定义模板入口或上述扩展的验收目标。 | B [scan-events.spec.ts](../../backend/test/scan-events.spec.ts) 拒绝客户端覆盖正文，F [smoke.test.tsx](../../frontend/test/smoke.test.tsx) 核对提交字段，M04 验固定模板。 | 未来若做模板编辑／更正通知另行立项，先定收件人和审计。不将这些扩展计作本次候选缺陷。 |

## 已有裁决的文档漂移

候选 README 最后一次随 [PR #105][pr105] 更新，此后多个合并改变了产品行为。下表以候选时的旧表述定位，README 在本次文档改动中按下列已接受规则校正。历史验收记录继续保留原日期和版本。

| 旧来源／说法 | 应用于候选的规则 | 裁决与实现历史 |
| --- | --- | --- |
| README、需求 §4.4、架构流程图写“记录异常扫码事件”、[#75][issue75] 的处理队列 | 未命中统一拒绝，不建立 event/case/job。资料恢复走人员管理。后续聚合观测是 [#126][issue126]。 | [ADR-018][adr018]、[PR #130][pr130]。实现及测试 S04、O01。 |
| README “平台级管理仍需后续迭代”。归档中若干项写“未提交” | 独立平台管理员、人工开通和额度、平台审计均已进入候选。商业计费、自助注册及 MFA 继续延期。 | [ADR-006][adr006] → [ADR-013][adr013]，[PR #115][pr115]。审计由 [ADR-024][adr024]、[PR #177][pr177] 增补。P01–P06。 |
| README 仍只描述 mock。早期手册写 OCI 尚未启用 | 默认 mock。Staging 的实际单封和回滚仅有历史证据。首次 Production 真实通知仍待独立决定。 | [ADR-019][adr019]、[ADR-020][adr020]、[PR #147][pr147]、[PR #154][pr154]，O03–O04、Q07。[ADR-021][adr021] 为被驳回草案，不能替代现行门禁。 |
| 早期 [#61][issue61]、产品描述写提交后立即处理。API 创建示例写 sent | 初始状态 waiting。数据库截止前可取消，到期后领取，重试另算。API 手动入口不代替工作台自动处理。 | [ADR-017][adr017]、[PR #130][pr130]、[PR #131][pr131]。S05、S10、M02。 |
| 需求 §3.3.5、部分旧 ADR／测试说明仍称解析 V2 或 PD1 | 当前严格 E/X 加 12 位，动作与图片同步切换，无旧码双读。实体重印和软件解码证据需分别记录。 | [ADR-008][adr008] → [ADR-015][adr015] → [ADR-022][adr022]，[PR #105][pr105]、[PR #130][pr130]、[PR #154][pr154]。S02–S03。 |
| 早期 [#6][issue6]、[#83][issue83] 和需求 §3.1／§3.3.3 混用租户自管订阅、续订提醒、无地点额度 | 登录使用公开 tenant_code。租户订阅只读，额度由平台人工管理。无 MVP 商业 allowance 或续订提醒。 | [ADR-003][adr003] 经 [ADR-006][adr006]、[ADR-007][adr007]、[ADR-009][adr009]、[ADR-010][adr010]、[ADR-013][adr013] 补充／修订，[PR #103][pr103]、[PR #115][pr115]。A02、A08、P04、Q02。 |
| [#65][issue65] 的旧 14 位时间、早期固定入室正文及 [#151][issue151] 原评论示例 | 以 [#151][issue151] 修订后的日文 v2 为准。新任务按动作与 JST 渲染，已存 v1/v2 快照保持原样。 | [PR #156][pr156] 落地模板，[PR #179][pr179] 只增加回归。M04。 |
| 早期 [#158][issue158]/[#159][issue159] 要求额外封禁 Session、逐一终止队列。[ADR-023][adr023] 及 10 月 20 日旧验收写终结后保留全部历史 | 删除窗口沿用 suspended。后续 [ADR-024][adr024] 要求冻结、恢复后重启 TTL，未恢复的到期租户销毁在线业务历史，当前对象保留非 PII 墓碑。 | [ADR-023][adr023] 人工修订、[ADR-024][adr024]、[PR #156][pr156]、[PR #168][pr168] 的实现随 [PR #177][pr177] 进入 main。RET02–RET07。 |
| 10 月 22 日 [ADR-024][adr024] 执行卡及 [PR #177][pr177] 写“本机 PostgreSQL 未运行” | 当时的缺证已由后续实测补充。候选 DB job 通过迁移、日常清理、终结与大样本。同 SHA 本地通过完整删除 HTTP 和[五项数据库补验](candidate-tenant-database-2026-11-19.md)。 | [RET02](#RET02)–[RET08](#RET08)。目标环境开关、日常清理灰度、备份副本和告警回执仍分别取证。 |

复核仍需业务选择的范围见 Q01–Q07 以及 H03 对应的 D09 导出范围。S08、S09 属于已接受要求的实现缺口。现有 13 个首次盘点开放项逐项落在 O01（[#126][issue126]）、O03–O05（[#85][issue85]、[#116][issue116]、[#139][issue139]、[#141][issue141]、[#146][issue146]、[#152][issue152]、[#153][issue153]）、O08（[#38][issue38]）、Q01–Q04、Q06（[#84][issue84]、[#100][issue100]、[#102][issue102]、[#114][issue114]）。候选之后新开的 [#180][issue180] 见 Q07，[#181][issue181]–[#183][issue183] 见 S08–S09，[#190](https://github.com/omajilmanbo/poolduck-mail/issues/190)见 H03，[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192)见 P01，[#195](https://github.com/omajilmanbo/poolduck-mail/issues/195)见 P05。这些单不计入首次盘点。

[adr001]: ../../docs/decisions/ADR-001-use-web-saas-for-mvp.md
[adr003]: ../../docs/decisions/ADR-003-tenant-context-and-subscription-gating.md
[adr004]: ../../docs/decisions/ADR-004-tech-stack-for-mvp.md
[issue6]: https://github.com/omajilmanbo/poolduck-mail/issues/6
[issue22]: https://github.com/omajilmanbo/poolduck-mail/issues/22
[issue33]: https://github.com/omajilmanbo/poolduck-mail/issues/33
[adr007]: ../../docs/decisions/ADR-007-short-business-identifiers-and-location-model.md
[issue90]: https://github.com/omajilmanbo/poolduck-mail/issues/90
[issue91]: https://github.com/omajilmanbo/poolduck-mail/issues/91
[adr010]: ../../docs/decisions/ADR-010-operator-username-and-tenant-manager-email-login.md
[issue98]: https://github.com/omajilmanbo/poolduck-mail/issues/98
[issue99]: https://github.com/omajilmanbo/poolduck-mail/issues/99
[issue59]: https://github.com/omajilmanbo/poolduck-mail/issues/59
[issue64]: https://github.com/omajilmanbo/poolduck-mail/issues/64
[issue76]: https://github.com/omajilmanbo/poolduck-mail/issues/76
[issue80]: https://github.com/omajilmanbo/poolduck-mail/issues/80
[adr006]: ../../docs/decisions/ADR-006-platform-admin-role-boundary.md
[issue77]: https://github.com/omajilmanbo/poolduck-mail/issues/77
[issue96]: https://github.com/omajilmanbo/poolduck-mail/issues/96
[issue97]: https://github.com/omajilmanbo/poolduck-mail/issues/97
[adr009]: ../../docs/decisions/ADR-009-defer-commercial-billing-from-mvp.md
[issue23]: https://github.com/omajilmanbo/poolduck-mail/issues/23
[issue65]: https://github.com/omajilmanbo/poolduck-mail/issues/65
[adr002]: ../../docs/decisions/ADR-002-location-scoped-scan-code-mapping.md
[issue24]: https://github.com/omajilmanbo/poolduck-mail/issues/24
[issue73]: https://github.com/omajilmanbo/poolduck-mail/issues/73
[issue74]: https://github.com/omajilmanbo/poolduck-mail/issues/74
[issue92]: https://github.com/omajilmanbo/poolduck-mail/issues/92
[issue71]: https://github.com/omajilmanbo/poolduck-mail/issues/71
[issue72]: https://github.com/omajilmanbo/poolduck-mail/issues/72
[issue93]: https://github.com/omajilmanbo/poolduck-mail/issues/93
[adr011]: ../../docs/decisions/ADR-011-person-and-location-delayed-deletion.md
[issue104]: https://github.com/omajilmanbo/poolduck-mail/issues/104
[issue7]: https://github.com/omajilmanbo/poolduck-mail/issues/7
[issue55]: https://github.com/omajilmanbo/poolduck-mail/issues/55
[issue57]: https://github.com/omajilmanbo/poolduck-mail/issues/57
[adr008]: ../../docs/decisions/ADR-008-explicit-scan-entry-exit-action.md
[adr015]: ../../docs/decisions/ADR-015-scanner-compatible-action-code-payload.md
[adr022]: ../../docs/decisions/ADR-022-short-entry-exit-action-code.md
[issue101]: https://github.com/omajilmanbo/poolduck-mail/issues/101
[issue117]: https://github.com/omajilmanbo/poolduck-mail/issues/117
[issue150]: https://github.com/omajilmanbo/poolduck-mail/issues/150
[issue118]: https://github.com/omajilmanbo/poolduck-mail/issues/118
[issue121]: https://github.com/omajilmanbo/poolduck-mail/issues/121
[adr018]: ../../docs/decisions/ADR-018-unmapped-scan-rejection-and-observability.md
[issue66]: https://github.com/omajilmanbo/poolduck-mail/issues/66
[issue75]: https://github.com/omajilmanbo/poolduck-mail/issues/75
[issue122]: https://github.com/omajilmanbo/poolduck-mail/issues/122
[adr017]: ../../docs/decisions/ADR-017-scan-send-cancellation-grace-period.md
[issue25]: https://github.com/omajilmanbo/poolduck-mail/issues/25
[issue95]: https://github.com/omajilmanbo/poolduck-mail/issues/95
[issue124]: https://github.com/omajilmanbo/poolduck-mail/issues/124
[issue68]: https://github.com/omajilmanbo/poolduck-mail/issues/68
[issue125]: https://github.com/omajilmanbo/poolduck-mail/issues/125
[issue94]: https://github.com/omajilmanbo/poolduck-mail/issues/94
[issue181]: https://github.com/omajilmanbo/poolduck-mail/issues/181
[pr103]: https://github.com/omajilmanbo/poolduck-mail/pull/103
[issue182]: https://github.com/omajilmanbo/poolduck-mail/issues/182
[issue183]: https://github.com/omajilmanbo/poolduck-mail/issues/183
[issue123]: https://github.com/omajilmanbo/poolduck-mail/issues/123
[issue127]: https://github.com/omajilmanbo/poolduck-mail/issues/127
[issue128]: https://github.com/omajilmanbo/poolduck-mail/issues/128
[issue129]: https://github.com/omajilmanbo/poolduck-mail/issues/129
[issue26]: https://github.com/omajilmanbo/poolduck-mail/issues/26
[issue136]: https://github.com/omajilmanbo/poolduck-mail/issues/136
[issue140]: https://github.com/omajilmanbo/poolduck-mail/issues/140
[adr019]: ../../docs/decisions/ADR-019-oci-email-delivery-provider.md
[issue61]: https://github.com/omajilmanbo/poolduck-mail/issues/61
[issue69]: https://github.com/omajilmanbo/poolduck-mail/issues/69
[issue138]: https://github.com/omajilmanbo/poolduck-mail/issues/138
[issue151]: https://github.com/omajilmanbo/poolduck-mail/issues/151
[issue5]: https://github.com/omajilmanbo/poolduck-mail/issues/5
[pr156]: https://github.com/omajilmanbo/poolduck-mail/pull/156
[pr179]: https://github.com/omajilmanbo/poolduck-mail/pull/179
[issue85]: https://github.com/omajilmanbo/poolduck-mail/issues/85
[issue137]: https://github.com/omajilmanbo/poolduck-mail/issues/137
[issue146]: https://github.com/omajilmanbo/poolduck-mail/issues/146
[issue67]: https://github.com/omajilmanbo/poolduck-mail/issues/67
[issue169]: https://github.com/omajilmanbo/poolduck-mail/issues/169
[pr178]: https://github.com/omajilmanbo/poolduck-mail/pull/178
[issue79]: https://github.com/omajilmanbo/poolduck-mail/issues/79
[issue70]: https://github.com/omajilmanbo/poolduck-mail/issues/70
[issue78]: https://github.com/omajilmanbo/poolduck-mail/issues/78
[adr024]: ../../docs/decisions/ADR-024-business-record-retention-and-destruction.md
[issue155]: https://github.com/omajilmanbo/poolduck-mail/issues/155
[adr013]: ../../docs/decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md
[issue82]: https://github.com/omajilmanbo/poolduck-mail/issues/82
[issue109]: https://github.com/omajilmanbo/poolduck-mail/issues/109
[issue113]: https://github.com/omajilmanbo/poolduck-mail/issues/113
[issue110]: https://github.com/omajilmanbo/poolduck-mail/issues/110
[pr115]: https://github.com/omajilmanbo/poolduck-mail/pull/115
[pr132]: https://github.com/omajilmanbo/poolduck-mail/pull/132
[issue111]: https://github.com/omajilmanbo/poolduck-mail/issues/111
[issue149]: https://github.com/omajilmanbo/poolduck-mail/issues/149
[issue174]: https://github.com/omajilmanbo/poolduck-mail/issues/174
[issue175]: https://github.com/omajilmanbo/poolduck-mail/issues/175
[adr023]: ../../docs/decisions/ADR-023-platform-tenant-deletion-and-recovery.md
[issue157]: https://github.com/omajilmanbo/poolduck-mail/issues/157
[issue160]: https://github.com/omajilmanbo/poolduck-mail/issues/160
[issue165]: https://github.com/omajilmanbo/poolduck-mail/issues/165
[issue158]: https://github.com/omajilmanbo/poolduck-mail/issues/158
[issue159]: https://github.com/omajilmanbo/poolduck-mail/issues/159
[issue166]: https://github.com/omajilmanbo/poolduck-mail/issues/166
[issue161]: https://github.com/omajilmanbo/poolduck-mail/issues/161
[issue164]: https://github.com/omajilmanbo/poolduck-mail/issues/164
[issue170]: https://github.com/omajilmanbo/poolduck-mail/issues/170
[issue171]: https://github.com/omajilmanbo/poolduck-mail/issues/171
[issue172]: https://github.com/omajilmanbo/poolduck-mail/issues/172
[issue173]: https://github.com/omajilmanbo/poolduck-mail/issues/173
[issue162]: https://github.com/omajilmanbo/poolduck-mail/issues/162
[issue163]: https://github.com/omajilmanbo/poolduck-mail/issues/163
[issue176]: https://github.com/omajilmanbo/poolduck-mail/issues/176
[issue126]: https://github.com/omajilmanbo/poolduck-mail/issues/126
[adr020]: ../../docs/decisions/ADR-020-staging-mail-application-alerts.md
[issue139]: https://github.com/omajilmanbo/poolduck-mail/issues/139
[issue141]: https://github.com/omajilmanbo/poolduck-mail/issues/141
[issue144]: https://github.com/omajilmanbo/poolduck-mail/issues/144
[adr021]: ../../docs/decisions/ADR-021-oci-https-submit-authorization-verification.md
[issue142]: https://github.com/omajilmanbo/poolduck-mail/issues/142
[issue153]: https://github.com/omajilmanbo/poolduck-mail/issues/153
[issue145]: https://github.com/omajilmanbo/poolduck-mail/issues/145
[issue116]: https://github.com/omajilmanbo/poolduck-mail/issues/116
[issue152]: https://github.com/omajilmanbo/poolduck-mail/issues/152
[pr133]: https://github.com/omajilmanbo/poolduck-mail/pull/133
[pr134]: https://github.com/omajilmanbo/poolduck-mail/pull/134
[issue39]: https://github.com/omajilmanbo/poolduck-mail/issues/39
[adr005]: ../../docs/decisions/ADR-005-staging-deployment-trigger-and-recovery.md
[adr012]: ../../docs/decisions/ADR-012-staging-tls-termination-with-caddy-and-lets-encrypt.md
[issue35]: https://github.com/omajilmanbo/poolduck-mail/issues/35
[issue37]: https://github.com/omajilmanbo/poolduck-mail/issues/37
[issue48]: https://github.com/omajilmanbo/poolduck-mail/issues/48
[issue58]: https://github.com/omajilmanbo/poolduck-mail/issues/58
[issue86]: https://github.com/omajilmanbo/poolduck-mail/issues/86
[issue107]: https://github.com/omajilmanbo/poolduck-mail/issues/107
[issue38]: https://github.com/omajilmanbo/poolduck-mail/issues/38
[issue84]: https://github.com/omajilmanbo/poolduck-mail/issues/84
[issue83]: https://github.com/omajilmanbo/poolduck-mail/issues/83
[issue102]: https://github.com/omajilmanbo/poolduck-mail/issues/102
[issue100]: https://github.com/omajilmanbo/poolduck-mail/issues/100
[issue114]: https://github.com/omajilmanbo/poolduck-mail/issues/114
[issue180]: https://github.com/omajilmanbo/poolduck-mail/issues/180
[pr105]: https://github.com/omajilmanbo/poolduck-mail/pull/105
[pr130]: https://github.com/omajilmanbo/poolduck-mail/pull/130
[pr177]: https://github.com/omajilmanbo/poolduck-mail/pull/177
[pr147]: https://github.com/omajilmanbo/poolduck-mail/pull/147
[pr154]: https://github.com/omajilmanbo/poolduck-mail/pull/154
[pr131]: https://github.com/omajilmanbo/poolduck-mail/pull/131
[pr168]: https://github.com/omajilmanbo/poolduck-mail/pull/168
