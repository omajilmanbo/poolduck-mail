# O06 API 分钟观测与 26 PR 本机组合验收

2026-11-20（日本时间）。正式候选为 `main@a05251897d7fc11d96114606bcaa1807dd96af55`。常态服务端 API 5xx 和 p95 阈值判断缺少可复核出口，现有 #116 时延记录来自负载客户端。[O06](business-requirements-matrix.md#O06) · [工程 #227](https://github.com/omajilmanbo/poolduck-mail/issues/227) · [现行观测策略](../observability.md)

## #228 固定分支的数据库替身测试

独立快照 `e21fc6cd331773a36ec4b6d7c8219f7fa75e04d7` 在正常 Nest HTTP 入口增加默认关闭的 `api.minute`。每个进程按响应实际完成时间和最终状态汇总请求数、5xx 及超过 2 秒的请求。固定时钟覆盖五分钟总请求至少 10 且 5xx 比率达到 5%、p95 恰好为 2 秒与连续十个有样本分钟严格超过 2 秒、空窗与重启。数据库替身的真实时钟回环验收得到三个窗口，完成请求分别为 10、1、0，第一窗有 1 个模拟 503 和 1 个超过 2 秒的请求。该提交的 GitHub CI 五项通过。[独立 PR](https://github.com/omajilmanbo/poolduck-mail/pull/228) · [固定版本观测说明](https://github.com/omajilmanbo/poolduck-mail/blob/e21fc6cd331773a36ec4b6d7c8219f7fa75e04d7/docs/observability.md) · [分支 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44657864161)

在 #228 的上述快照上，已安装锁定依赖后可单独运行公开专项。

```sh
npm --prefix backend test -- --runTestsByPath test/api-metrics.spec.ts
```

## 26 PR 本机冻结组合

冻结组合为 `8e545a06daebe38c990432a3a157368a267ec6f3`。原生 PostgreSQL 16.16 的独立合成冒烟应用 21 项迁移，显式开启 API 分钟聚合。两个真实 60 秒窗口的完成请求、5xx 及超过 2 秒请求均与独立客户端记录逐窗一致。每窗各有 1 次健康探针，从 API 分母排除。

| 已结束窗口 | 完成的 API 请求 | 5xx | 超过 2 秒 |
| --- | ---: | ---: | ---: |
| 第一窗 | 10 | 0 | 0 |
| 第二窗 | 5 | 0 | 0 |

合成冒烟中，取消任务的投递调用为 0，正常任务有 1 次 mock 回执。

同一冻结源码另通过后端 Jest 319/319 和前端 Vitest 83/83。Playwright 的 mock 成功与失败组各应用 21 项迁移、各通过 17/17，均无跳过或重试。每组两笔已取消任务的投递调用均为 0，真实投递为 0。工作台连接真实 PostgreSQL，历史导出和平台控制台沿用仓库用例的模拟 API。

在隔离的合成 PostgreSQL 环境中，使用 mock 并关闭真实发送。锁定依赖和前后端运行环境就绪后，仓库入口如下。两组浏览器验收分别使用对应的 mock 模式。[本地开发与验证](../development.md)

```sh
npm --prefix backend run db:deploy
npm --prefix backend run local:seed
npm --prefix backend test -- --runInBand
npm --prefix frontend test
npm --prefix frontend run test:e2e -- --workers=4
```

复核分钟计数时，在同一合成环境为后端进程显式传入 `API_METRICS_ENABLED=true`。用独立客户端记录完成时刻、最终状态和耗时，按同一进程输出的窗口对照完成数、5xx 数和慢请求数。[开关与采样口径](https://github.com/omajilmanbo/poolduck-mail/blob/e21fc6cd331773a36ec4b6d7c8219f7fa75e04d7/docs/observability.md)

生产采集、保留和通知送达仍待在目标环境验证。[工程范围与待决项](https://github.com/omajilmanbo/poolduck-mail/issues/227)
