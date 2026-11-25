# A02／A03 旧租户与登录身份升级验收

2026-11-20 · 候选 `a05251897d7fc11d96114606bcaa1807dd96af55` · 本机 PostgreSQL 16.16

**通过。** 同一库中的 2 个旧租户各获得一个合法且不同的公开码。2 名旧操作员获得用户名，2 名租户经理保留邮箱身份。后来成为租户经理的两个旧管理员从建库起就使用同一个合成邮箱，分别持有自己的口令。最终候选上的 6 次正常登录均返回 201，随后访问 `GET /api/auth/me` 均返回 200。每次新增的数据库会话都绑定登录者原有的租户 UUID 和用户 UUID。

## 数据库升级记录

每个租户各有 1 名经理、1 名操作员、1 个有效订阅、1 个地点。6 个检查点均通过独立只读连接核对了原租户、4 个账号的 UUID 与口令哈希、订阅和地点的主键与归属。中途未重建或重新 seed。

| 已完成迁移数 | 最后一条迁移 | 同一批记录的观察 |
| --- | --- | --- |
| 1 | `20260622000000_init` | `users.username` 与 `tenants.tenant_code` 均不存在。旧角色为 2 个 `root_admin` 和 2 个 `manager`。4 条邮箱均含大写字母，两名旧管理员的邮箱完全相同。 |
| 7 | `20260724020000_add_operator_location_assignments` | 原账号已分别转为 2 个 `tenant_manager` 和 2 个 `operator`。邮箱保留旧值，用户名、租户公开码两列仍不存在。 |
| 8 | `20260724030000_add_user_login_identities` | 4 条邮箱均转换为原值的小写形式。2 名操作员都有 `op-` 加 10 位小写十六进制字符的用户名，2 名经理的用户名均为 NULL。 |
| 9 | `20260728000000_generate_location_codes` | 用户名和邮箱与第 8 条后逐行相同。地点仍关联原租户，租户公开码列尚不存在。 |
| 10 | `20260728010000_add_tenant_codes` | 2 个租户均取得 10 位大写 Crockford Base32 码，去重计数为 2。数据库目录确认列为 NOT NULL、格式 CHECK 已验证、单列全局唯一索引有效且无过滤条件。 |
| 21 | `20261022000000_record_retention_scan_indexes` | 第 8 条后的身份、第 10 条后的公开码均与原 UUID 逐行匹配。最终仍为 2 个租户、4 个用户、2 个订阅、2 个地点。 |

ADR-010 对回填用户名的描述是 `op-` 加 10 位小写 Crockford Base32。候选 SQL 取随机 UUID 去除连字符后的前 10 位，因此实际后缀使用该字符集的十六进制子集。两条回填值均符合格式且可登录。本次检验覆盖合法数据上的回填及数据库唯一约束，碰撞重试已有单元测试。[身份迁移 SQL](../../backend/prisma/migrations/20260724030000_add_user_login_identities/migration.sql) · [租户码迁移 SQL](../../backend/prisma/migrations/20260728010000_add_tenant_codes/migration.sql) · [租户码单元测试](../../backend/test/tenant-code.spec.ts)

## 三个真实后端的正常登录

每一行都启动该提交编译出的 Nest 应用，通过回环 HTTP 调用其原有路由。每次登录后仅携带本次签发的凭据调用 `/api/auth/me`，分别比对预期用户、角色及租户。两名经理各用自己的租户标识、相同邮箱和独立口令。

| 后端与库状态 | 正常登录输入 | HTTP 与数据库结果 |
| --- | --- | --- |
| `17685f8`，第 1 条后 | 各自的内部租户 UUID、原大小写邮箱及原口令。4 个旧账号各登录一次。 | 登录 201、`/me` 200 各 4 次。两处均返回正确的内部租户、用户及旧角色。该版本使用无状态 Bearer 凭据。 |
| `c2bf9d0`，第 8 条后 | 租户 UUID 加 `identifier`。两名经理各用邮箱一次，两名操作员各用新用户名和原邮箱一次。 | 登录 201、`/me` 200 各 6 次。每次只新增 1 条会话，均匹配该账号原有的内部租户和用户。 |
| `a052518`，第 21 条后 | 使用回填的公开 `tenant_code` 加 `identifier`，按上一行相同的 6 种组合使用各自原口令。 | 登录 201、`/me` 200 各 6 次。两处返回的公开码、用户和角色均正确。6 条新增会话逐次核对原租户和原用户，最终累计 12 条会话。 |

第 7 条和第 9 条是两项回填的直接前置**数据库**检查点。两个历史 API 分别实测于其提交实际包含的第 1 条和第 8 条迁移状态。`c2bf9d0` 是引入公开租户码的 `33c3a63` 的直接父提交。

## 对账方法与范围

同一个新建的隔离库从第 1 项迁移的模型开始，只写入一次合成样本。后续沿候选的原始迁移顺序分六次部署，六次均成功。逐项与候选 SQL 校验和比对。各阶段以独立只读连接按原主键复核身份、口令哈希及订阅和地点归属。第 8 和第 10 项之后分别固定身份与公开码映射。三个后端均由对应版本独立构建，登录请求使用该版本的正常入口。最终有 12 条会话、0 个邮件任务、0 次投递尝试。[第一个旧版](https://github.com/omajilmanbo/poolduck-mail/commit/17685f8844e1da46517d06e1d515b3b2226ba2c2) · [第二个旧版](https://github.com/omajilmanbo/poolduck-mail/commit/c2bf9d011fd8f0b5c638b44bd47ded8204161f13)

## 依据与既有证据

ADR-003 的 7 月 28 日修订将公开登录标识切换为租户码，内部租户上下文仍来自服务端。ADR-010 定义了按租户解析用户名与邮箱。ADR-007 的 10 月修订涉及人员动作码。三份决策在候选中均为 Accepted。[ADR-003](../decisions/ADR-003-tenant-context-and-subscription-gating.md) · [ADR-007](../decisions/ADR-007-short-business-identifiers-and-location-model.md) · [ADR-010](../decisions/ADR-010-operator-username-and-tenant-manager-email-login.md)

矩阵已有 SQL 文本断言和认证单元测试。7 月 Staging 记录覆盖迁移后的 seed 与登录，此前的候选平台验收覆盖新开通租户。本次补入同一批旧账号沿真实迁移链的连续记录及双租户同邮箱正常登录。本地报告的适用范围为 A02／A03 这两个缺口。[矩阵 A02](business-requirements-matrix.md#A02) · [矩阵 A03](business-requirements-matrix.md#A03) · [Prisma 结构测试](../../backend/test/prisma-schema.spec.ts) · [7 月 Staging 记录](staging-smoke-2026-07-28.md) · [候选平台验收](candidate-platform-smoke-2026-11-19.md)
