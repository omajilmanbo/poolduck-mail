# Issue #116 Staging 容量测试结果（2026-09-24）

## 结论摘要

- **最大可持续并发操作员为 20**。steady 20 并发持续 5 分钟时为 19.211 RPS，API p95 50 ms，
  mail claim p95 964 ms，结束积压 0；满足 API p95 <= 2 秒、claim p95 <= 2 秒及无持续积压条件。
- 40/50 并发的 API 仍能接收约 38.2/47.6 RPS，但 mail claim p95 分别升至约 263/318 秒，
  50 并发结束时有 12,794 个 waiting，因此不得把 50 并发记为端到端容量。
- burst 的短时 API 峰值为 93.220 RPS（50 并发、30 秒、p95 676 ms、0 错误），但吞吐从
  20 到 50 并发只由 91.277 增至 93.220 RPS，且场景结束时有 12,182 个 waiting。
- mixed-success 的预期 201/404/403 全部正确，0 意外响应；其 mail claim 也在 20 与 40 并发间
  出现同一拐点。provider-failure 子场景未执行，不能从本次结果推导失败重试容量。
- 首要瓶颈是同 VM 上 Backend/worker 与 PostgreSQL 的 CPU/领取吞吐；内存最低仍有约 10.2 GiB
  可用，根盘最高 19%，不是当前限制。

## 测试身份与边界

| 场景 | UTC 窗口 | 阶梯 | 单档时长 | 结果 |
|---|---|---|---:|---|
| steady | 2026-09-24 02:52:19–03:22:24 | 1/5/10/20/40/50 | 300 秒 | API 全档通过；端到端仅至 20 并发通过 |
| burst | 2026-09-24 03:34:56–03:37:57 | 1/5/10/20/40/50 | 30 秒 | API 全档通过；仅用于短时峰值与排队观察 |
| mixed-success | 2026-09-24 03:50:30–03:56:35 | 1/5/10/20/40/50 | 60 秒 | 预期 201/404/403 全部正确；端到端仅至 20 并发通过 |

- 应用 commit：`734a42294691bc28a1033c117a62b142a1d9fac6`
- 目标：`https://app.poolducktest.com`，仅 Staging；`APP_ENV=staging`、`MAIL_PROVIDER=mock`、
  `MAIL_MOCK_SEND_RESULT=success` 在测试前后均已核对。
- 负载机：操作者本地 Windows，经公网 HTTPS 访问，Node.js `v24.16.0`；本机 CPU/内存采集因
  系统权限不可用，故负载机余量未量化。
- 未修改登录限流、10 秒业务去重、10 秒发送犹豫期、订阅门禁或 tenant/location 授权。
- 未使用 Production、真实收件人、真实邮件 provider 或付费监控。

## 环境

| 项目 | 实测值 |
|---|---|
| OCI shape | `VM.Standard.A1.Flex` |
| OCPU / 内存 | 2 OCPU / 11,932 MiB（配置目标 12 GB） |
| 启动盘 | 100 GB、10 VPU/GB；根文件系统 97 GB，测试中最高使用率 19% |
| Node.js / PostgreSQL / Compose | `v20.20.2` / `16.14` / `2.40.3` |
| Backend / worker / PostgreSQL | 各 1 个容器；worker 与 Backend 同进程 |
| Mail provider | `mock / success` |
| 合成数据 | active 50 operators / 4,096 persons；suspended 1 operator / 100 persons |
| 备份 | 测试前 custom-format dump 已创建，并通过 `pg_restore -l` 验证 |

## Steady 阶梯

### API

| 并发 | 秒数 | 请求数 | RPS | p50 | p95 | p99 | timeout/5xx | 意外率 | API SLO |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 300.3 | 290 | 0.966 | 25 ms | 33 ms | 49 ms | 0 | 0% | pass |
| 5 | 300.7 | 1,448 | 4.816 | 25 ms | 45 ms | 90 ms | 0 | 0% | pass |
| 10 | 300.9 | 2,892 | 9.611 | 28 ms | 52 ms | 97 ms | 0 | 0% | pass |
| 20 | 300.9 | 5,780 | 19.211 | 28 ms | 50 ms | 110 ms | 0 | 0% | pass |
| 40 | 301.0 | 11,499 | 38.204 | 32 ms | 78 ms | 148 ms | 1 | 0.0087% | pass |
| 50 | 301.0 | 14,337 | 47.625 | 33 ms | 84 ms | 169 ms | 1 | 0.0070% | pass |

40/50 并发各出现 1 次 502。Caddy 同一窗口有 2 条 upstream error，Backend 无对应 error/exception、
无 restart/OOM；样本不足以进一步归因，不影响 5% 自动停止阈值，但应继续作为代理可用性指标监控。

### Mail job 与数据库

| 并发 | jobs/s | claim p50 | claim p95 | claim p99 | 档位报告积压 | early claim | 端到端 |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 0.966 | 504 ms | 948 ms | 988 ms | 0 | 0 | pass |
| 5 | 4.816 | 512 ms | 945 ms | 989 ms | 0 | 0 | pass |
| 10 | 9.611 | 557 ms | 958 ms | 995 ms | 0 | 0 | pass |
| 20 | 19.211 | 605 ms | 964 ms | 1,000 ms | 0 | 0 | **pass** |
| 40 | 38.200 | 137,750 ms | 262,647 ms | 273,913 ms | 已在恢复期排空 | 0 | fail |
| 50 | 47.615 | 297,748 ms | 317,961 ms | 319,777 ms | 12,794 | 0 | fail |

steady 全窗口 API 返回 36,246 次，其中 2 次 502；数据库窗口内创建 36,244 个 mail job。测试结束时
13,528 个 job 尚未完成，均在不改状态、不重启服务的情况下自然排空。50 并发档最终 claim p95 为
671,751 ms，约 11.5 分钟后全部 `sent`。数据库连接数 7–8，lock waiter 与 ungranted lock 恒为 0。

## Burst

| 并发 | 秒数 | 请求数 | RPS | p50 | p95 | p99 | timeout/5xx | API SLO |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 30.0 | 1,200 | 39.965 | 23 ms | 32 ms | 41 ms | 0 | pass |
| 5 | 30.0 | 2,413 | 80.321 | 59 ms | 87 ms | 106 ms | 0 | pass |
| 10 | 30.1 | 2,533 | 84.273 | 113 ms | 165 ms | 219 ms | 0 | pass |
| 20 | 30.1 | 2,750 | 91.277 | 214 ms | 271 ms | 304 ms | 0 | pass |
| 40 | 30.3 | 2,760 | 91.095 | 427 ms | 540 ms | 659 ms | 0 | pass |
| 50 | 30.4 | 2,831 | 93.220 | 521 ms | 676 ms | 751 ms | 0 | pass |

burst 共返回 14,487 次 201；严格 UTC 数据库窗口统计到 14,482 个 job，5 条落在报告时间边界外，
不能据此声称丢失。即时报告有 12,182 waiting，最终 claim p95 600,879 ms；约 10 分钟后全部
`sent`，early claim、lock waiter 与 ungranted lock 均为 0。

## Mixed-success

| 并发 | 请求数 | RPS | valid 201 | unmapped 404 | suspended 403 | p95 | 意外/5xx |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 58 | 0.966 | 48 | 5 | 5 | 35 ms | 0 |
| 5 | 292 | 4.801 | 232 | 30 | 30 | 44 ms | 0 |
| 10 | 580 | 9.571 | 464 | 58 | 58 | 58 ms | 0 |
| 20 | 1,160 | 19.034 | 928 | 116 | 116 | 82 ms | 0 |
| 40 | 2,310 | 37.724 | 1,848 | 231 | 231 | 84 ms | 0 |
| 50 | 2,875 | 47.110 | 2,301 | 287 | 287 | 90 ms | 0 |

所有 7,275 个请求均符合预期：5,821 个有效 201、727 个 unmapped 404、727 个 suspended 403。
20 并发有效 job 为 15.227 jobs/s，claim p95 965 ms、积压 0；40 并发为 30.179 jobs/s，claim p95
31,232 ms，已失败。场景结束时有约 1,652 backlog，约 2 分钟后全部 `sent`；early claim 为 0。

## 主机与容器

下表只统计各场景实际负载窗口，恢复期数据不混入峰值：

| 场景 | host load1 最大 | 可用内存最小 | Backend CPU / 内存最大 | PostgreSQL CPU / 内存最大 | 根盘最大 |
|---|---:|---:|---:|---:|---:|
| steady | 1.81 | 10,537 MiB | 100.64% / 342.6 MiB | 124.48% / 244.0 MiB | 19% |
| burst | 3.23 | 10,478 MiB | 118.67% / 340.8 MiB | 103.44% / 275.2 MiB | 19% |
| mixed | 2.20 | 10,488 MiB | 75.29% / 321.9 MiB | 121.49% / 266.2 MiB | 19% |

- 2 vCPU 在 burst 中已饱和；Backend 与 PostgreSQL 峰值合计可超过 2 核。
- 内存、根盘均有充足余量；三场景和恢复后所有容器均为 healthy、restart 0、OOM false。
- 原始 TSV 位于 Staging `/opt/poolduck-mail/metrics/capacity/`，不含 Cookie、密码、邮箱、动作码或正文，
  按 Runbook 保留 30 天。

## 容量与监控建议

- 对外容量口径使用 **20 并发操作员 / 约 19 次有效扫码每秒**，不要使用 50 并发 HTTP 成功数或
  93 RPS burst 峰值作为发信容量。
- 首要监控：waiting/processing 数、oldest waiting age、claim p50/p95/p99、early claim、每秒创建与
  完成 job；claim p95 > 2 秒、oldest waiting > 30 秒或 backlog 连续增长应告警。
- 资源监控：Backend/PostgreSQL CPU、host load1、容器 restart/OOM、DB lock waiter、可用内存和根盘。
  建议 load1 > 1.6 持续 5 分钟预警，restart/OOM、early claim 或 lock waiter > 0 立即告警，根盘 80%
  与可用内存 1 GiB 沿用 Runbook 停止线。
- 第一阶段继续使用 OCI 免费主机指标、应用聚合指标和测试时 5 秒 TSV，不安装付费 APM。仪表盘、
  告警接收方与值班责任仍需人工指定。
- 规格在 2026-09-24 实测为 2 OCPU / 12 GB / 100 GB（10 VPU/GB）；仓库 2026-09-08 免费额度
  核对依据仍为 1,500 OCPU 小时与 9,000 GB 小时。本次未创建任何新 OCI 资源。
- 后续应拆分两个 Issue：一是提升/并行化 mail worker 并重测 20–40 并发区间，二是落地低成本常驻
  backlog/claim/CPU 告警。`capacity-db-report.mjs` 的 `pg` 并发 query 弃用警告也应随工具维护修复。

## 置信边界

- steady 每档 5 分钟，burst 每档 30 秒，mixed 每档 60 秒；单一负载机最多 50 个 session。
- 只测单 VM、单 Backend/worker、单 PostgreSQL 和 mock success；不代表真实 SMTP/provider 的投递容量。
- 负载机自身 CPU/内存未量化；公网路径包含 TLS/Caddy 网络开销。
- provider-failure 子场景未执行，失败重试容量和外部 provider 限速仍未知。
- burst 数据库报告有 5 条时间边界差异；API 结果和最终队列归零均已验证。

## 恢复验证

- [x] `MAIL_MOCK_SEND_RESULT=success`，测试期间未切换 provider failure
- [x] `/health`、`/healthz`、登录与完整 API smoke 通过
- [x] active 正常；expired/suspended 均返回 `SUBSCRIPTION_NOT_SENDABLE`（trial 未单独建数验证）
- [x] 跨 tenant/location 返回 `404 LOCATION_NOT_FOUND`
- [x] 取消任务无 provider attempt；重扫任务最终 `sent`；early claim 0
- [x] steady、burst、mixed backlog 均自然归零，无手工改状态或删除历史
- [x] 最终四容器 healthy、restart 0、OOM false、DB lock waiter 0
- [x] 未产生付费资源、真实投递或敏感 artifact；容量密码临时文件已从本机与 Staging 删除
