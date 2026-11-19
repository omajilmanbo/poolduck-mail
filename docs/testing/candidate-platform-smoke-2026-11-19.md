# 候选 a052518 平台开通 HTTP 与数据库补验

2026-11-19（日本时间）。候选为 `origin/main` 的 `a05251897d7fc11d96114606bcaa1807dd96af55`。本次补齐业务矩阵 P01–P04 中平台控制面的本地 HTTP 与数据库联动证据。各行链接到矩阵中的对应条款。

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
| [P01](business-requirements-matrix.md#P01) 平台登录与会话 | 平台登录 201、`/me` 200，经独立 Cookie jar 调用。平台会话访问租户地点 API、租户会话访问平台租户 API 均为 401。平台 refresh、logout 均为 201，数据库中唯一的平台 Session 在退出后标记撤销。 | CLI 并发建号、轮换、禁用、恢复，Session 到期及旧 refresh 的后续行为。 |
| [P02](business-requirements-matrix.md#P02) 人工开通、幂等与改密 | trial 开通返回初始口令。同 key 同请求返回相同 tenant code 且标记重放，变更请求返回 409。首登标记必须改密，改密成功后用新密码重登。数据库新增 1 个租户、1 个订阅、1 个已完成改密的租户管理员和 1 条开通幂等记录。 | 开通事务故障回滚、active 初始开通、并发同 key、改密前业务访问，以及改密后旧口令和旧 Session 失效。脚本只断言首次开通响应含口令，另有后端单测使用模拟数据库断言安全重放返回原临时口令。 |
| [P03](business-requirements-matrix.md#P03) 凭据展示与交付 | API 首次开通响应含初始口令，订阅切换至 active 后返回的摘要含审计 ID，断言序列化结果不含完整管理员邮箱或新口令。 | 浏览器接真实 API 时的展示、CSV 下载、清除、客户端持久存储及下载文件的人工处置。候选 CI 已有模拟 API 的下载及清除用例。 |
| [P04](business-requirements-matrix.md#P04) 订阅与地点额度 | 额度 2 时建成两个地点，第三次返回 `LOCATION_LIMIT_REACHED`。降到 1 返回 `LOCATION_LIMIT_BELOW_CURRENT_USAGE`，提高到 3 成功。以当前版本切换到 suspended、active 均返回 200。数据库复核额度为 3、地点仍为 2、订阅最终为 active，有一条提额成功审计和顺序一致的两条订阅成功审计。 | 提额后再创建、旧版本和并发写入、地点停用或待删的占用及终结后释放额度。四类订阅 fixture 的存在只证明 seed 覆盖，业务状态门禁另行取证。 |

代码入口与断言见 [platform-synthetic-seed.mjs](../../backend/scripts/platform-synthetic-seed.mjs)、[platform-api-smoke-test.mjs](../../backend/scripts/platform-api-smoke-test.mjs) 和 [platform.spec.ts](../../backend/test/platform.spec.ts)。

结束时邮件任务与投递尝试均为 0。已回收本轮 Nest、PostgreSQL 和测试容器、专用 PostgreSQL 卷、临时镜像标签与构建目录，复核剩余容器、卷和镜像标签均为 0。记录只保留合成环境的状态和计数。
