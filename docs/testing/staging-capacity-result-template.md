# Issue #116 Staging 容量测试结果

## 测试身份

- Run ID：`<UTC timestamp + scenario>`
- 测试窗口：`<UTC start>` – `<UTC finish>`
- 应用 commit：`<full SHA>`
- 场景：`steady | burst | mixed-success | mixed-provider-failure`
- 负载机：`<区域/网络；不得写个人 IP>`
- 结果状态：`通过 | 达到停止条件 | 无效需重测`

## 环境

| 项目 | 实测值 |
|---|---|
| OCI shape | `VM.Standard.A1.Flex` |
| OCPU / 内存 | `<value>` |
| 启动盘 / VPU/GB / 根分区可用 | `<value>` |
| Node.js / PostgreSQL / Compose | `<value>` |
| Backend / worker 实例数 | `<value>` |
| Mail provider / result | `mock or approved sandbox / success or failure` |
| 合成 operator / person 数 | `<value>` |

## 阶梯结果

| 并发 session | 稳态秒数 | 请求数 | RPS | p50 | p95 | p99 | timeout/5xx | 意外错误率 | SLO |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `<n>` | `<n>` | `<n>` | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<%>` | `pass/fail` |

预期 `SCAN_CODE_NOT_MAPPED` 与 `SUBSCRIPTION_NOT_SENDABLE` 单独列出，不计为系统错误；任何跨租户成功
或提前 provider 调用直接判定失败。

## Mail job 与数据库

| 指标 | 结果 |
|---|---:|
| mail jobs/s | `<value>` |
| claim p50 / p95 / p99 | `<ms>` |
| waiting / queued / processing / sent / failed | `<counts>` |
| 稳态结束积压 | `<count and trend>` |
| early claims | `0` |
| DB connections / lock waiters / ungranted locks | `<counts>` |

## 主机与容器

| 指标 | 峰值/范围 | 是否饱和 |
|---|---|---|
| Host load / available memory / root disk | `<value>` | `<yes/no>` |
| Backend CPU / memory / PIDs | `<value>` | `<yes/no>` |
| PostgreSQL CPU / memory / block IO | `<value>` | `<yes/no>` |
| Frontend/Caddy CPU / memory/network | `<value>` | `<yes/no>` |
| Container restart / OOM | `<value>` | `<yes/no>` |

## 结论

- 最大可持续并发操作员：`<highest fully passing steady step>`
- 对应 API 吞吐：`<RPS>`
- 对应 mail job 处理吞吐：`<jobs/s>`
- 首要瓶颈：`<evidence-backed finding>`
- 次要瓶颈：`<evidence-backed finding>`
- 置信边界：`<duration, sample size, load generator limits, mock-provider limitation>`

## 监控与后续

- 推荐常驻指标：`<list>`
- 建议采集/保留/仪表盘/告警路径：`<decision>`
- 成本核对：`<free usage evidence and date>`
- 告警接收方与责任：`<human-approved owner or pending>`
- 后续 Issue：`<links>`

## 恢复验证

- [ ] provider result 已恢复
- [ ] `/health`、`/healthz`、登录通过
- [ ] trial/active、expired/suspended 门禁通过
- [ ] tenant/location isolation 通过
- [ ] mock/sandbox mail smoke 通过
- [ ] 队列达到预期终态，无持续积压
- [ ] 未产生付费资源、真实投递或敏感 artifact
