# Staging 部署脚本的本机隔离演练

在开发机仓库根目录运行。需要 Python 3.8+、Git 和指向本机的 Docker Compose。完整演练需 Linux 容器引擎、支持 `!reset` 的 Compose，以及已有的 PG16、Caddy 镜像和准备应用工件所需的构建依赖。测试程序从当前已提交的 HEAD 创建临时克隆，生成仅供本次使用的配置，输出随机项目名、克隆路径和 SHA。它用仓库的 `release.py` 准备一次镜像对，并在后续每次启动时核对运行镜像和 `.nvmrc` 规定的 Node 版本。真实发布的审批及分步接管见 [Staging 手册](../staging-manual.md)。

```bash
python -B deploy/staging/rehearsal/verify.py
python -B deploy/staging/rehearsal/verify.py --run
```

第一条只检查 CLI、Git 和真实的 Compose 配置解析，指定 Staging 域名的用例也只解析配置。第二条另建环境，先检查没有同项目的容器、网络、卷，再执行部署。禁止向脚本提供既有项目。演练 overlay 复用仓库 Dockerfile、PostgreSQL 16、Caddy 和三个持久卷，使用独立项目的容器名、内部网络和无宿主机映射的端口。Caddy 使用内部 HTTP，关闭 OCI Monitoring，邮件使用 mock。

| 验收项 | 操作与判断 |
|---|---|
| 1. 写入前拒绝 | 缺少参数返回 2。缺少人工确认、SHA 不匹配、工作区变更、错误环境、Shell 冲突、缺少 provider、真实发送、错误库名、外部主机或连接串覆盖参数返回 1。另在临时克隆提交四个仅供测试的 Compose 变更，保持 dotenv 正确，确认最终生效的 provider、发送开关、DB URL 或数据库卷任一冲突均在 config 阶段失败。另测外部前端地址、缺少发布工件和错误清单摘要。 |
| 2. 正常部署 | `deploy.py … --seed` 返回 0。准备阶段只调用一次 `release.py prepare`。部署验证清单与镜像归档，检查 `up --no-build --pull never`、运行镜像 ID 和 Node 版本、`db:deploy`、`staging:seed`、四服务健康、Caddy 两条健康路由以及 `smoke:api -- --staging`。后者验证登录、订阅、地点、未映射拒绝、撤销后重扫、mock 成功和数据库 attempt 计数。 |
| 3. 重跑与留存 | 首轮后插入无关的合成 tenant 作为见证。相同 SHA、配置与参数再执行一次。比较全部迁移行、seed 的稳定字段、见证行、既有扫码/任务/attempt 的整行摘要及三个卷的名称和创建时间。seed 的更新时间、登录时间和重新加盐的密码哈希不参与 fixture 比较。 |
| 4. 中断与接管 | 仅在新建演练库的 subscriptions 表安装临时触发器，让实际 seed 的 UPDATE 失败。命令返回 1 并指向手册 3.5，后续 health/smoke 未执行。核对留存，移除该触发器和函数，用完全相同参数重跑。最后省略 `--seed` 再部署，确认复用已有 fixture。 |
| 5. 记录与恢复 | 记录项目、完整 SHA、命令、实际退出码、阶段和计数。输出只使用安全字段，测试同时检查输出中没有连接串、测试密码或邮箱。 |

完整演练成功后，程序仅清理此次生成的 Compose 项目和临时凭据。意外失败会保留该项目和克隆用于接管。进入输出的克隆目录，用同一 SHA、库名 `synthetic_rehearsal` 和打印的 `--rehearsal` 项目名重新运行预检。人工 Compose 命令须显式指定 `-p <本次项目名> -f docker-compose.yml -f docker-compose.staging.yml -f deploy/staging/rehearsal/compose.yml`。若在预期故障处接管，在该隔离库用 psql 删除 `interrupt_seed` 触发器和同名函数后重跑。真实 Staging 的恢复流程始终保留原有卷。

## 2026-11-20 本机实测（#230 接入前）

`python -B deploy/staging/rehearsal/verify.py --run` 在 Windows Docker Desktop 的新项目 `pd-rehearsal-f586cf17e31a` 上返回 0。部署提交为 `2394c1a7f352a2a5de643feb136471d19ca76c8a`，Engine 29.7.2、Compose 5.5.1。每次成功部署均有四项服务 healthy，两条 Caddy 健康路由和数据库支持的核心 API smoke 通过。表中计数来自 PostgreSQL。

| 阶段 | 部署退出码 | 扫码 | 邮件任务 | 投递尝试 |
|---|---:|---:|---:|---:|
| 首次部署，带 seed | 0 | 2 | 2 | 1 |
| 同参数重跑 | 0 | 4 | 4 | 2 |
| seed 注入失败，停止于手册 3.5 | 1 | 4 | 4 | 2 |
| 解除故障，同参数恢复 | 0 | 6 | 6 | 3 |
| 省略 seed，再次冒烟 | 0 | 8 | 8 | 4 |

21 条已完成迁移、三个卷、原有业务历史及第 4 个合成租户均通过留存断言。三个 seed 租户一直对应 6 个用户、3 份订阅、3 个地点、3 个人员映射和 3 个 operator 地点分配。核对完成后该项目已清理。真实 Staging 的备份、外部 HTTPS、浏览器和访问边界留待单独批准的发布窗口。
