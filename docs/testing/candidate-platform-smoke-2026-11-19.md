# 候选 a052518 平台开通、凭据交付、管理员 CLI 与审计查询补验

2026-11-19 至 2026-11-20（日本时间）。候选为 `origin/main` 的 `a05251897d7fc11d96114606bcaa1807dd96af55`。本报告记录 P01–P04 的平台开通 HTTP 与数据库联动、P01 的平台管理员 CLI 生命周期、P03 的本地浏览器验收及 P06 的平台审计查询与角色边界。各行链接到矩阵中的对应条款。

## 环境与命令

在独立工作树从候选 Git archive 构建仓库原有的 Backend runtime 镜像。使用 Node.js 20.20.2 和 PostgreSQL 16.16。PostgreSQL 使用本轮新建、带独立标签的专用卷。连接前核对库名、服务器地址和空库基线。PostgreSQL 监听 `127.0.0.1:5432`，Nest 与测试客户端共享同一个只有 loopback 的网络命名空间。两项服务均无宿主机端口映射，Nest 无宿主机目录挂载。

核实工作树根目录、`backend/` 和镜像中相应位置均无 `.env` 或 `.env.local`，包括两个脚本优先覆盖进程值的 `backend/.env.local`。从容器内核实最终 `DATABASE_URL` 指向 `127.0.0.1:5432` 的本轮专用库，`API_BASE_URL=http://127.0.0.1:3001`，`APP_ENV=local`、`NODE_ENV=development`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。仅注入本轮生成的临时凭据和 `.example.local` 合成管理员，两项官方入口分别显式启用。

| 在候选 `backend/` 中执行 | 退出码或服务状态 | 结果 |
| --- | ---: | --- |
| `npm run db:deploy` | 0 | 空库应用 21 项迁移，业务表仍为空。 |
| `npm run platform:seed`（连续两次） | 0、0 | 两次核对均为 1 个 active 平台账号、4 个租户、4 个租户管理员、4 个订阅、4 个地点。订阅 fixture 包含 trial、active、suspended、expired。 |
| `npm run start` | 已就绪 | 独立 Nest 服务的 `GET /health` 返回 200。 |
| `npm run smoke:platform` | 0 | 官方脚本完成真实本地 HTTP 流程并输出 `Platform API smoke passed.`。 |

## 矩阵证据与边界

官方脚本通过 HTTP 校验状态码和响应内容。表中的会话撤销状态、对象及审计行数取自本轮另行执行的数据库核对。

| 条款 | 本轮实测 | 仍待取证 |
| --- | --- | --- |
| [P01](business-requirements-matrix.md#P01) 平台登录与会话 | 平台登录 201、`/me` 200，经独立 Cookie jar 调用。平台会话访问租户地点 API、租户会话访问平台租户 API 均为 401。平台 refresh、logout 均为 201，数据库中唯一的平台 Session 在退出后标记撤销。另一空库验证 CLI 四种正常动作、顺序重复初始化和四个旧会话的撤销，详见下节。 | 并发初始化、会话自然到期、正常 refresh 轮换后使用旧值。CLI 审计缺少请求标识由[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192)跟踪。 |
| [P02](business-requirements-matrix.md#P02) 人工开通、幂等与改密 | trial 开通返回初始口令。同 key 同请求返回相同 tenant code 且标记重放，变更请求返回 409。首登标记必须改密，改密成功后用新密码重登。另用独立浏览器上下文复验，旧口令重登返回 401，新口令返回 201 并进入工作台。11 月 20 日的真实 HTTP 与数据库专项另验 active 初始开通、同键并发一次创建及一次重放、故障回滚和同键重试，详见下文。首次改密前租户业务访问受限。改密后当前浏览器退出，旧刷新会话已在数据库中撤销。 | 跨设备重新认证时点待确认。开通失败请求缺少对应平台审计由 [#207](https://github.com/omajilmanbo/poolduck-mail/issues/207) 跟踪。 |
| [P03](business-requirements-matrix.md#P03) 凭据展示与交付 | API 首次开通响应含初始口令，订阅切换至 active 后返回的摘要含审计 ID，断言序列化结果不含完整管理员邮箱或新口令。 本地真实浏览器 7/7 通过，核对了成功页与 CSV 的四个字段、凭据清除和返回控制台的行为，并在四类浏览器存储中检查临时口令及完整经理邮箱。 | 正式交付仍须核对实际接收人、使用获准渠道、受控保管及交付后删除明文 CSV。 |
| [P04](business-requirements-matrix.md#P04) 订阅与地点额度 | 额度 2 时建成两个地点，第三次返回 `LOCATION_LIMIT_REACHED`。降到 1 返回 `LOCATION_LIMIT_BELOW_CURRENT_USAGE`，提高到 3 成功。以当前版本切换到 suspended、active 均返回 200。数据库复核额度为 3、地点仍为 2、订阅最终为 active，有一条提额成功审计和顺序一致的两条订阅成功审计。 另有七组[地点额度补验](candidate-platform-location-quota-2026-11-20.md)核验竞争最后一个名额、创建先成功的并发降额及终结后的额度释放。 | 两类调额拒绝均为 409，欠缺可关联的平台审计，见 [#209](https://github.com/omajilmanbo/poolduck-mail/issues/209)。反向执行次序未取样。额度 1、满额重新启用／恢复及自动调度等待尚待验。 |

代码入口与断言见 [platform-synthetic-seed.mjs](../../backend/scripts/platform-synthetic-seed.mjs)、[platform-api-smoke-test.mjs](../../backend/scripts/platform-api-smoke-test.mjs) 和 [platform.spec.ts](../../backend/test/platform.spec.ts)。

结束时邮件任务与投递尝试均为 0。已回收本轮 Nest、PostgreSQL 和测试容器、专用 PostgreSQL 卷、临时镜像标签与构建目录，复核剩余容器、卷和镜像标签均为 0。记录只保留合成环境的状态和计数。

## P01 平台管理员 CLI

同一候选重新从 Git archive 构建运行镜像，在另一套空库中执行 `npm run db:deploy`（退出 0，迁移 21 项）。沿用仅有 loopback 的 Nest 和 PostgreSQL 16.16 环境，核对最终数据库与 API 地址、`APP_ENV=local`、`NODE_ENV=development` 及 `MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。CLI 使用同一个运行时生成的合成身份，需要口令的步骤分别生成并注入临时口令。Nest 在备份前和恢复后分别启动，健康检查均为 200。[管理员操作手册第 2 节](../admin-guide.md) · [验证指南第 4.11 节](../testing.md)

| 在候选 `backend/` 中执行 | 退出码 | 数据库及 HTTP 实测 |
| --- | ---: | --- |
| `npm run platform:admin -- bootstrap` | 0 | 创建唯一 active 账号，identity version 为 1。原凭据登录返回 201，两份会话的 `GET /me` 均为 200。 |
| 再次执行 `npm run platform:admin -- bootstrap` | 1（预期） | 已有 active 账号时拒绝覆盖。账号、版本和 active 计数保持原值，重复命令提交的新口令登录返回 401。 |
| `npm run platform:admin -- rotate` | 0 | 保持 active，identity version 升至 2。原有 2 份会话全部在库中撤销，旧会话的 `GET /me` 和 `POST /refresh` 均为 401。旧口令登录 401，新口令登录 201，新会话 `GET /me` 为 200。 |
| `npm run platform:admin -- disable` | 0 | 账号 disabled，active 计数为 0，identity version 升至 3。累计 4 份旧会话均已撤销。禁用前的口令登录、两份刚撤销会话的读取与刷新均为 401。 |
| `npm run platform:admin -- recover` | 0 | 在原实验库恢复同一账号为唯一 active，identity version 升至 4。4 份旧会话的读取与刷新仍返回 401，禁用前口令仍为 401，恢复口令登录 201，`GET /me` 为 200。 |

备份在账号禁用、Nest 停止后制作。`pg_dump --format=custom` 和 `pg_restore --list` 均成功，目录和归档权限分别为 700、600，源归档与恢复端 SHA-256 核对通过。`pg_restore --single-transaction --exit-on-error --no-owner` 在另一个有独立卷的空 PostgreSQL 16.16 实例退出 0。19 张 public 表行数与内容摘要全量一致，包括 disabled 账号和 4 份已撤销会话。副本仅用于核对备份。[首次部署手册的备份与恢复步骤](https://github.com/omajilmanbo/poolduck-mail/blob/012f85cfb98ffe316d87ff996e8c8f8f386ed7cd/docs/first-production-deployment.md)

数据库中四种 CLI 业务动作各有一条成功审计，均关联同一管理员。bootstrap 元数据仅含身份指纹，其余三条元数据为空。四条记录的 `request_id` 均为空，可按管理员、动作和时间追溯，无法用请求 ID 关联外部执行记录。此审计缺口由[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192)独立跟踪。[PR #193](https://github.com/omajilmanbo/poolduck-mail/pull/193)已提出修复，尚未进入本报告的固定候选。[CLI 源码](../../backend/scripts/platform-admin.mjs) · [ADR-013](../decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md)

邮件任务和投递尝试均为 0。回收了本轮容器、原库与恢复库数据卷、归档卷、临时镜像标签和构建目录，剩余容器、卷与镜像标签均为 0。报告仅保留状态、计数和退出码。

## P03 真实浏览器首次开通交付

从同一候选构建实际 Next 和 Nest 运行镜像，在新的本机 PostgreSQL 16.16 专用卷应用 21 项迁移。前后端、数据库和无界面 Chromium 运行在仅有 loopback 的网络命名空间，无宿主端口映射。核实 API 和数据库指向本轮实例，后端为 `APP_ENV=local`、`NODE_ENV=development`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。`npm run db:deploy`、`npm run platform:admin -- bootstrap` 均退出 0，前后端健康检查均返回 200。修正本机 PowerShell 对前端启动参数的传递后，以全新环境完整重跑。

沿用既有 Playwright 平台用例的窄屏布局、表单、下载与清除步骤，以及工作台用例的登录控件。使用锁定版本 Playwright 1.51.1 的 Chromium，当次临时驱动 `node p03-harness.mjs` 退出 0，七项检查全部通过。该驱动仅用于本轮实验，仓库提供的现有用例列在段末。开通及交付操作请求发往真实本机服务。此前 CI 的平台浏览器用例使用模拟 API。[平台浏览器用例](../../frontend/e2e/platform-control-plane.spec.ts) · [工作台浏览器用例](../../frontend/e2e/mvp-workspace.spec.ts)

| 核对项 | 结果 |
| --- | --- |
| 平台开通与成功页 | 平台登录及创建一个 trial 租户均返回 201。创建确认后显示租户名、tenant_code、经理邮箱和临时口令四项，分别与本轮输入及实际开通响应一致。 |
| 官方 CSV 下载 | 通过控制台按钮下载。文件名符合约定，使用 UTF-8 BOM 和 CRLF。下载字节与成功页四项一致，包含非 ASCII 字符和双引号的名称按 CSV 规则转义。内存比对后删除下载文件。 |
| 清除及返回 | 原标签仍显示凭据时，同会话新标签只显示租户摘要。手动清除使凭据区和下载按钮消失，再经平台审计页返回控制台也未重新显示。 |
| 浏览器持久存储 | 在凭据可见、新标签进入、手动清除和返回后检查 Web Storage、IndexedDB、Cache Storage 和 Cookie。Web Storage 的内容及观测到的写入均未匹配临时口令或完整经理邮箱，IndexedDB 和 Cache Storage 为空，Cookie 中也未匹配这两项。 |
| 经理首登强制改密 | 独立浏览器上下文使用等值的初始凭据登录，返回 201 并进入首次改密页。改密返回 201，旧口令重新登录返回 401，新口令返回 201 并进入工作台。 |

数据库对账确认只有一套租户、trial 订阅、已改密经理、开通幂等记录和成功审计。邮件任务及投递尝试均为 0。用例关闭截图、录像和 trace，只记录通过状态。下载文件和浏览器临时文件位于容器内临时文件系统，测试容器、前后端、数据库卷、临时镜像标签和构建目录均已回收。

本机跨端口读取另见[#195](https://github.com/omajilmanbo/poolduck-mail/issues/195)。前端与 API 的端口不同，邮件模式和环境的 GET 请求携带 `Cache-Control`，该请求头未获 CORS 预检许可。两个 GET 因此被拦下，已独立核实后端为 mock，控制台却显示“状态未知”。在 `APP_ENV=local` 下，环境接口正常读取时应返回 `environment=unavailable`、`deletion_enabled=false`。开通和凭据交付请求均成功，本次观察限于本机跨端口场景。[前端平台 API 客户端](../../frontend/src/api/client.ts) · [后端 CORS 配置](../../backend/src/main.ts) · [平台环境接口](../../backend/src/platform/platform-auth.controller.ts)

正式交付仍由上线人员执行。核对接收人，按手册通过获准的安全渠道交付，受控保管下载的明文 CSV，并在交付后及时删除文件。[管理员操作手册第 2 节](../admin-guide.md)

## P02 active 开通、同键并发与回滚

2026-11-20（日本时间）。从固定候选构建 Backend runtime，使用一次性 PostgreSQL 16 和只监听 loopback 的真实 Nest HTTP。新卷上运行 `npm run db:deploy` 应用 21 项迁移，`npm run platform:admin -- bootstrap` 初始化一个合成管理员，两个命令均退出 0。测试环境使用 `APP_ENV=test`、`NODE_ENV=test`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`。当次临时探针 `node p02-evidence.mjs` 退出 0，实验结束后已清理。前文保留 trial 顺序重放证据，本轮复验的是 active 及并发。候选已有的 Jest 开通用例使用注入的 Prisma 模拟对象，本节使用真实控制器、会话、事务和数据库。[ADR-013](../decisions/ADR-013-platform-admin-control-plane-and-manual-tenant-provisioning.md) · [既有后端用例](../../backend/test/platform.spec.ts)

| 验收项 | HTTP 和 PostgreSQL 实测 |
| --- | --- |
| active 初始订阅及额度 | 开通返回 201，API 与数据库的订阅均为 active，起止时间与输入一致，额度为 3，已用地点为 0。数据库正好有 1 个 active 首任经理，必须首登改密，保存的 Argon2id 哈希通过本轮口令验证。平台摘要显示脱敏经理邮箱。 |
| 同键、同请求的两个授权提交 | 同一 active 平台管理员通过两个独立 Session 和 TCP 连接发起请求。独立 PostgreSQL 连接暂持该合成键的事务级 advisory lock，观察到两个请求同时等待后释放。两个响应均为 201，一个标记创建、一个标记重放，返回相同租户码和同一临时口令，仅在内存比较。累计 1 个租户、1 个订阅、1 个经理、1 条幂等记录。两条成功审计分别关联各自请求 ID，指向同一管理员和租户，区分创建与重放，元数据无完整邮箱、口令或原始幂等键。安全重放返回原临时口令与现行 API 文档一致。 |
| 开通中途失败及重试 | 仅针对另一合成键，在实验库对幂等记录插入设置 `AFTER INSERT` 触发器。触发器在同一事务看见租户、订阅、经理和幂等记录都已插入后递增非事务性探针序列，再抛出异常。探针确认命中一次，API 返回 500，响应未暴露夹具细节或凭据。独立连接核对租户、订阅、经理、幂等记录及成功审计增量均为 0。移除触发器后，同键同请求以新的请求 ID 重试，返回 201 且标记为首次创建。 |

最终独立 SQL 对账为 2 个租户、2 个 active 订阅、2 个待首登改密的经理、2 条幂等记录、3 条成功开通审计。邮件任务与投递尝试均为 0。故障夹具、容器、专用 PostgreSQL 卷、临时镜像标签和探针文件已回收，剩余容器、卷及镜像标签均为 0。[平台开通 API 契约](../api.md) · [开通事务与成功审计实现](../../backend/src/platform/platform-tenants.service.ts)

受控失败请求携带 `X-Request-Id`，返回 500 后按该标识查到 0 条平台审计。[#207](https://github.com/omajilmanbo/poolduck-mail/issues/207) 单独跟踪 HTTP 开通失败的审计缺口。[#192](https://github.com/omajilmanbo/poolduck-mail/issues/192) 跟踪平台 CLI 已有成功审计缺少关联标识。

[PR #208](https://github.com/omajilmanbo/poolduck-mail/pull/208) 的修复分支 `becae10` 在本地 PostgreSQL 验证了事务回调失败和数据库在提交时明确拒绝两种情况。业务行回滚，各有一条失败审计可按请求 ID 对账。审计存储也拒写时仍返回 500，对应审计为 0 条。分支的平台定向测试 34/34、后端 282/282 和 GitHub [五项 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44560146454)通过。固定候选 `a052518` 的实测结果仍为 0 条失败审计。

首次改密与会话状态的验收结论见 [P02](business-requirements-matrix.md#P02)。

<a id="platform-audit-browser"></a>

## P06 平台审计查询与角色边界

2026-11-20（日本时间）。在固定候选 `a052518` 的本机完整前后端和新 PostgreSQL 16 库上，真实 Chromium、HTTP 响应与独立 SQL 逐页对账。库内应用 21 项迁移，使用合成租户、模拟 Staging 配置和 mock 邮件。[矩阵 P06](business-requirements-matrix.md#P06) · [查询契约](../api.md) · [管理员手册](../admin-guide.md)

| 验收项 | 实测结果 |
| --- | --- |
| 筛选与翻页 | 使用起止时间、管理员、动作、结果和目标租户六项输入。含时间边界及相同时间戳的 27 条匹配记录，以 `created_at DESC, id DESC` 排序。浏览器前进再返回显示 25 → 2 → 25，逐页 ID 与 SQL 一致。API 默认 25、接受上限 100，超限、时间倒置及跨筛选复用游标均返回 400。 |
| 清理后的目标与安全字段 | 合成试用租户经正式 Staging 删除接口返回 201，隔离库确认租户和关联业务审计已清除。保留的平台审计中目标关联及摘要均为空，页面显示“租户已清理”，详情可见安全原因和计数。普通空查询显示空结果，响应无游标。受检响应及详情符合白名单，合成邮箱和非白名单元数据经脱敏或移除。 |
| 角色及会话 | 租户经理和操作员访问平台审计均返回 401 并回到平台登录，平台管理员访问租户业务审计也返回 401。经理可读本租户业务审计，操作员为 403。隔离库中将测试平台会话置为到期后，原浏览器查询及刷新均为 401，重新登录后可以查询。 |
| 查询的最小审计 | 12 次成功查询各留一条 `platform.audit.query`，元数据只含 `count`，与各次响应条数相符。非法筛选、被拒身份和过期会话均未产生成功查询审计。 |

查询审计写入失败另用后端 Jest 夹具核对。HTTP 为 503／`PLATFORM_AUDIT_UNAVAILABLE`，响应没有记录、游标或测试行内容。后端定向 26 项通过，含一项临时故障断言。前端 Vitest 两项通过，其中验证 503 页面提示。该场景的后续验收另见[持有游标后的空页](candidate-platform-audit-p06-cleared-page-2026-11-20.md)。平台审计可见范围仍待人工审核。[后端用例](../../backend/test/platform.spec.ts) · [前端用例](../../frontend/test/platform-audit.test.tsx) · [#174](https://github.com/omajilmanbo/poolduck-mail/issues/174) · [#175](https://github.com/omajilmanbo/poolduck-mail/issues/175)
