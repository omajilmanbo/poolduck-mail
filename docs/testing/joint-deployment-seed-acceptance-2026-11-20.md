# #214 与 #216 的本机联合部署及跨年种子验收

2026-11-20（日本时间）。两条仓库测试入口在同一合成代码树上均退出 0。该树由两个未合并的 PR head 按下列顺序合成。合成树上的结果对应 [O07](business-requirements-matrix.md#O07) 和 [O08](business-requirements-matrix.md#O08)。固定候选 `a052518` 的合成订阅仍使用原截止时间。

| 组成 | 固定标识 |
| --- | --- |
| 第一父提交，Staging 部署脚本 | [#214](https://github.com/omajilmanbo/poolduck-mail/pull/214) · [`602fd95e933bfd81c8fdb66697b129375e807eaa`](https://github.com/omajilmanbo/poolduck-mail/commit/602fd95e933bfd81c8fdb66697b129375e807eaa) |
| 第二父提交，合成订阅跨年修复 | [#216](https://github.com/omajilmanbo/poolduck-mail/pull/216) · [`7839c8acc52d57fd607f71a96124e31e41b09818`](https://github.com/omajilmanbo/poolduck-mail/commit/7839c8acc52d57fd607f71a96124e31e41b09818) |
| 合成树 | `fd9e08986a7b66aefdde2719d36203473c14e2ab` |

## 复现入口

在含上述两个固定提交的独立克隆中，按所列顺序执行 `git merge-tree --write-tree <第一父提交> <第二父提交>`，输出须为表中树 ID。以第一父提交新建本地分支，将第二父提交合并到该分支，核对 `git rev-parse 'HEAD^{tree}'` 与表中相同。部署入口会再次克隆当前提交，运行前应保留可从本地分支取得的干净提交。提交元数据可以不同，两个父提交及树 ID 用于复核代码内容。

| 入口与环境 | 本次结果 |
| --- | --- |
| 在 `backend/` 安装锁定依赖后，使用本机回环 PostgreSQL 16.16、可建测试库的账号及 `local` 或 `test` 配置执行 `npm run test:synthetic-subscriptions`。由环境提供该实例的 `DATABASE_URL`。 | 退出 0。仅调整 Node 进程参考时钟，覆盖 2026-12-31、2027-01-01 和 2040-02-29 UTC。旧夹具续期、健康期限重跑保持原值，剩余 30 天与再多 1 ms 的判定均通过。九个夹具的许可结果及无关租户保持情况通过核对。 |
| 在该本地分支根目录使用 Python、Git 和支持仓库 Compose 配置的本机 Docker，执行 `python -B deploy/staging/rehearsal/verify.py --run`。 | 演练入口退出 0。全新隔离项目使用内部 HTTP、mock 和关闭的真实发送开关。五个阶段结果如下。 |

| 部署阶段 | 阶段退出码 | 累计扫码 | 邮件任务 | mock 投递尝试 |
| --- | ---: | ---: | ---: | ---: |
| 首次带 seed | 0 | 2 | 2 | 1 |
| 同参数重跑 | 0 | 4 | 4 | 2 |
| seed 故障，停在手册 3.5 | 1 | 4 | 4 | 2 |
| 解除故障，同参数恢复 | 0 | 6 | 6 | 3 |
| 跳过 seed，再次冒烟 | 0 | 8 | 8 | 4 |

故障阶段未进入健康检查和冒烟。其余四轮均核对四服务健康与 Caddy 两条健康路由，取消的任务零尝试，重扫各一次 mock 调用。既有历史、独立见证租户、21 条迁移及三个持久卷均保留。四个租户、三份订阅、六个用户、三个地点、三个人员映射和三条分配参与留存核对，订阅起止时间及版本纳入比较。两个演练项目均已清理。

本轮实际执行范围为上表两条入口。真实 Staging 的入口、授权窗口及部署仍需单独核验。两个分支各自的 CI 记录见 [#214 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44603957230) 和 [#216 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44608914847)。[部署演练入口](https://github.com/omajilmanbo/poolduck-mail/blob/602fd95e933bfd81c8fdb66697b129375e807eaa/deploy/staging/rehearsal/verify.py) · [跨年订阅测试](https://github.com/omajilmanbo/poolduck-mail/blob/7839c8acc52d57fd607f71a96124e31e41b09818/backend/scripts/synthetic-subscriptions-test.mjs)
