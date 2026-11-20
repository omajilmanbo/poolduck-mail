# 候选地点授权、订阅提示与历史读取补验

2026-11-20（日本时间），正式候选为 `main@a05251897d7fc11d96114606bcaa1807dd96af55`。各项合成验收注明对应的正式候选、独立修复分支或本机冻结组合。

<a id="location-dialog"></a>

## 16 个地点的授权弹窗

租户管理员在正常界面打开「配置地点」。1280×900 与 900×480 两种视口均可用鼠标滚轮将地点列表独立滚至末项。滚动前后，「取消」与「保存地点权限」始终完整可见且可点击。[A07](business-requirements-matrix.md#A07) · [管理员手册](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/docs/admin-guide.md#L57-L59)

| 实际操作 | 核对结果 |
| --- | --- |
| 桌面视口勾选末项后取消 | 授权写请求为 0。经理列表、原操作员会话刷新与 PostgreSQL 回读均保持原来的一处授权。 |
| 小窗口重新打开，勾选末项并保存 | 仅一次授权 PUT，返回 200。经理列表更新，同一操作员刷新后看到两处授权，与 PostgreSQL 中的关系一致。 |

<a id="subscription-guidance"></a>

## 订阅过期或暂停后的联系指引

正式候选显示扫码与发送入口禁用，缺少功能需求要求的联系指引。[功能需求 §3.3.9](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/docs/requirements.md#L210-L214) · [A08](business-requirements-matrix.md#A08) · [缺陷 #222](https://github.com/omajilmanbo/poolduck-mail/issues/222)

未合并的 [PR #223](https://github.com/omajilmanbo/poolduck-mail/pull/223) 在提交 `6138421` 为过期与暂停分别显示原因，并指引操作员联系租户管理员、租户管理员联系平台运营。该提交的 GitHub CI 五项通过。PR 正文另记录独立本机 Chrome 的 mock 成功组为 9/10，暂停提示、授权历史和跨租户拒绝通过。人员编辑的姓名更新等待超时已在正式基线用受控人员详情延迟复现。[修复分支 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44649707804) · [人员编辑 #201](https://github.com/omajilmanbo/poolduck-mail/issues/201)

高权限账号定期复核是管理员的人工职责，订阅到期前的通知由平台运营发给业务负责人。商业订阅概览与产品内续订提醒按 #83 延后，自动续订同属 ADR-009 延期范围。[管理员手册第 62–68 行](https://github.com/omajilmanbo/poolduck-mail/blob/a05251897d7fc11d96114606bcaa1807dd96af55/docs/admin-guide.md#L62-L68) · [#83](https://github.com/omajilmanbo/poolduck-mail/issues/83) · [ADR-009](../decisions/ADR-009-defer-commercial-billing-from-mvp.md)

<a id="history-after-outage"></a>

## 数据库停库前后的授权历史

正式候选用合成操作员的同一会话核对一个授权地点的历史列表和详情。[O07](business-requirements-matrix.md#O07) · [O08](business-requirements-matrix.md#O08)

| 检查 | 停库前 | 停库期间 | 数据库恢复后 |
| --- | --- | --- | --- |
| 前端与后端探活 | 均为 200 | 均为 200 | 均为 200 |
| 授权历史列表与详情 | 均为 200 | 均为 500 | 均为 200，读回原记录及原关联任务 |

恢复后沿用原会话。停库前后均有一笔合成扫码与一笔原待发任务，投递尝试与 mock 调用均为 0。本次三阶段记录来自固定候选的本机合成验证。

<a id="local-24-pr-combination"></a>

## 24 PR 本机冻结组合

本节对应本机合成提交 `b1aca63c2cbd0a3477b4ebcded2afb58dd5b163e`。正式候选仍为 `main@a052518`，[#223 的 GitHub CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44649707804)对应独立提交 `6138421`。

- 前端单测 83/83 通过，lint、typecheck 与帮助同步检查通过。
- 两组 mock 模式各用一套 PostgreSQL 16.16，各应用 21 项迁移。Playwright 关键用例各 17/17 通过，退出码均为 0，无失败、跳过或重试后通过。通过项包括订阅暂停、授权历史、退出重登及先前超时的人员编辑。
- 两组另用正常界面验证邮箱表单。人员邮箱置空时表单阻止提交，保存请求为 0，重读仍为原值。操作员可选邮箱清空后保存返回 200，刷新与重新打开表单均保持为空。[操作员邮箱规则](../admin-guide.md) · [订阅限制 A08](business-requirements-matrix.md#A08)

<a id="original-dockerfile-smoke"></a>

### 24 PR 原始 Dockerfile 构建与镜像冒烟

另一次本机验收使用相同冻结组合 `b1aca63c2cbd0a3477b4ebcded2afb58dd5b163e` 的独立干净检出。前后端 Dockerfile 与正式候选逐字节一致，两端以 Node.js 20.20.2 无缓存构建，退出码均为 0。实际启动这两张新镜像，后端在空 PostgreSQL 16.16 库应用 21 项迁移，前端首页及前后端探活均返回 200。[矩阵 O08](business-requirements-matrix.md#O08)

合成 seed 和仓库 API 冒烟均退出 0。另核对无授权地点及未映射码均拒绝、无新增任务。一笔授权扫码在窗口内取消，零投递尝试。另一笔进入已发送状态并核对到一次 mock 回执，两笔均可从历史读回。真实投递为零。

使用仓库开发指南的隔离合成配置，启用 mock 并关闭真实发送。原始 Dockerfile 构建和仓库冒烟可按以下命令复验。后端镜像启动时会运行 `npm run db:deploy`。[本地开发与验证](../development.md)

```sh
docker compose build --no-cache backend frontend
docker compose up -d --no-build
docker compose exec backend npm run local:seed
docker compose exec backend npm run smoke:api
```

现行运行时 Node.js 20 的上游支持已于 2026-04-30 结束。首次生产部署采用的受支持主版本仍待决定。[Node.js 官方发布计划](https://github.com/nodejs/Release/blob/main/schedule.json#L109-L115) · [运行时决定 #225](https://github.com/omajilmanbo/poolduck-mail/issues/225)
