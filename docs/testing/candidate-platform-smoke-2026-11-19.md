# 候选 a052518 平台开通、凭据交付与管理员 CLI 补验

2026-11-19（日本时间）。候选为 `origin/main` 的 `a05251897d7fc11d96114606bcaa1807dd96af55`。本报告记录 P01–P04 的平台开通 HTTP 与数据库联动、P01 的平台管理员 CLI 生命周期及 P03 的本地真实浏览器验收。各行链接到矩阵中的对应条款。

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
| [P02](business-requirements-matrix.md#P02) 人工开通、幂等与改密 | trial 开通返回初始口令。同 key 同请求返回相同 tenant code 且标记重放，变更请求返回 409。首登标记必须改密，改密成功后用新密码重登。另用独立浏览器上下文复验，旧口令重登返回 401，新口令返回 201 并进入工作台。数据库新增 1 个租户、1 个订阅、1 个已完成改密的租户管理员和 1 条开通幂等记录。 | 开通事务故障回滚、active 初始开通、并发同 key、改密前业务访问，以及改密前签发的旧 Session 是否失效。脚本只断言首次开通响应含口令，另有后端单测使用模拟数据库断言安全重放返回原临时口令。 |
| [P03](business-requirements-matrix.md#P03) 凭据展示与交付 | API 首次开通响应含初始口令，订阅切换至 active 后返回的摘要含审计 ID，断言序列化结果不含完整管理员邮箱或新口令。 本地真实浏览器 7/7 通过，核对了成功页与 CSV 的四个字段、凭据清除和返回控制台的行为，并在四类浏览器存储中检查临时口令及完整经理邮箱。 | 正式交付仍须核对实际接收人、使用获准渠道、受控保管及交付后删除明文 CSV。 |
| [P04](business-requirements-matrix.md#P04) 订阅与地点额度 | 额度 2 时建成两个地点，第三次返回 `LOCATION_LIMIT_REACHED`。降到 1 返回 `LOCATION_LIMIT_BELOW_CURRENT_USAGE`，提高到 3 成功。以当前版本切换到 suspended、active 均返回 200。数据库复核额度为 3、地点仍为 2、订阅最终为 active，有一条提额成功审计和顺序一致的两条订阅成功审计。 | 提额后再创建、旧版本和并发写入、地点停用或待删的占用及终结后释放额度。四类订阅 fixture 的存在只证明 seed 覆盖，业务状态门禁另行取证。 |

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
