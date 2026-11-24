# 候选扫码历史 H01 旧记录兼容性（2026-11-20）

固定候选为 `a05251897d7fc11d96114606bcaa1807dd96af55`，供 [矩阵 H01](business-requirements-matrix.md#H01) 引用。本次使用独立 PostgreSQL、合成记录、`local`、`mock` 与 `REAL_MAIL_SEND_ENABLED=false`。

## 旧数据从哪里来

先用候选自带的原始 SQL 应用唯一一项 [`20260622000000_init`](../../backend/prisma/migrations/20260622000000_init/migration.sql)。该 schema 仍在 [历史提交 `17685f8`](https://github.com/omajilmanbo/poolduck-mail/tree/17685f8844e1da46517d06e1d515b3b2226ba2c2/backend) 中使用，扫码上只有 `scan_type`，邮件任务没有名称快照。按旧结构写入三条扫码。① 旧已发邮件关联的映射扫码，沿用当时的 `scan_type=entry` 与关联任务形状。② 同一地点和人员的另一条映射扫码，保留无邮件任务这一旧 schema 允许的边缘形状，旧正常成功扫码会在事务内创建邮件任务。③ 旧服务会持久化的未映射扫码，无邮件任务。三类均为合成 SQL 夹具，未运行旧服务。

写入后、升级前，把当前人员名和地点名从“A 时名称”改为“B 时名称”。候选原样应用其余 20 项迁移并启动。用迁移后生成的租户码，按正常登录路径登录已升级为 `tenant_manager` 的合成账户。主记录 ID 和邮件原正文标记保留。旧正文时代曾固定用“入室”措辞，可从上述历史提交核对。

## 实测

| 场景 | API 列表、详情与工作台 |
| --- | --- |
| 旧扫码有关联邮件 | 旧 `scan_type=entry` 保留。扫码和邮件的动作均为 `unknown`，扫码来源为 `legacy_unknown`，工作台显示“动作未知”。旧邮件仍为 `sent`。名称显示迁移时的 B，邮件详情标记 `context.snapshot_source=legacy_backfill`。迁移前写入的原正文标记保持原值。 |
| 缺姓名快照 | 候选读取无任务的历史边缘行得到 `person_name=null`、`mail_job=null`、`action=unknown`、`action_source=legacy_unknown`。工作台姓名显示 `-`。扫描 API 的兼容默认状态为 `queued`，页面显示“发送中”，但没有任务、没有取消入口。带关联邮件而姓名快照为 NULL 的组合不满足候选迁移后的约束。 |
| 旧未映射记录 | 升级后从列表消失，按 ID 读详情为 404。符合后续 [ADR-018](../decisions/ADR-018-unmapped-scan-rejection-and-observability.md) 及其删除预上线未映射数据的迁移。[#66](https://github.com/omajilmanbo/poolduck-mail/issues/66) 的早期可读语义已由这项决策调整。 |
| 现代对照 | 经理改当前名称为 C，经工作台提交一次有效进入码，HTTP 201。扫码和邮件动作都是 `entry`，来源为 `person_action_code`，邮件详情标记 `scan_relation`，姓名和地点均固化为扫码时的 C。 |
| 再改名及计划删除 | 当前名称改为 D，分别通过常规经理接口发起人员和地点删除，接口均给出 14 天期限。旧邮件保留 B，现代邮件保留 C，列表与详情一致。无任务行的姓名仍为空，地点跟随当前名称 D。人员计划删除后，该地点在工作台仍可选，两个带任务的历史姓名仍显示。地点自身计划删除后，工作台地点下拉不再提供该地点。经理用该地点公开码仍可在历史 API 查询同样的扫码和邮件。 |
| 终结清理 | 向既有清理服务传入晚于两笔截止的合成时间，期满路径清理 1 个地点和 1 个人员，当前对象均变为非 PII 墓碑。历史 API 仍返回同样的 3 条扫码与 2 个任务。名称快照 B、C 不变。无任务行的地点回退到当前地点墓碑，姓名仍为空。地点仍未出现在普通工作台下拉。 |

纯读取前后以 SQL 核对：升级后为 2 条扫码、1 个邮件任务、0 次尝试，一轮浏览器历史读取后计数相同。唯一一次现代扫码后为 3、2、1，终结清理和之后的列表／详情／页面读取均保持 3、2、1。唯一一次尝试成功且有 sandbox 回执，OCI 关联字段为 0。候选历史响应未暴露合成完整地址、原始扫码载荷标记或邮件正文。

## 文档差异与适用范围

- [用户指南第 2、3 节](../user-guide.md) 中“动作未知”和姓名 `-` 均已复现。第 2 节“邮件正文与该记录使用同一动作”适用于现代链路，旧任务正文按 [ADR-008](../decisions/ADR-008-explicit-scan-entry-exit-action.md) 保留，不能由旧正文反推方向。[#95](https://github.com/omajilmanbo/poolduck-mail/issues/95)
- 用户界面的适用范围包括 `legacy_backfill` 的名称是迁移时回填值、无任务行的地点来自当前记录，以及被删地点的工作台下拉与经理历史 API 的可达性。该边缘行的“发送中”属于兼容默认值，本次记录其兼容投影及可用操作。
- 已接受的 [ADR-003](../decisions/ADR-003-tenant-context-and-subscription-gating.md)、[ADR-006](../decisions/ADR-006-platform-admin-role-boundary.md)、[ADR-011](../decisions/ADR-011-person-and-location-delayed-deletion.md) 和 [ADR-024](../decisions/ADR-024-business-record-retention-and-destruction.md) 分别界定租户角色、当前对象的删除与历史正常保留。测试只执行人员和地点的到期处理，未启动一年记录清理。旧结构允许无扫码关联的邮件任务，但上下文迁移要求能完整回填这类关联，本次没有测试迁移拒绝路径。
