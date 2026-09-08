# OCI Always Free Staging IaC（Issue #48）

本目录为 Poolduck Mail 的 OCI Always Free Staging 基础设施准备清单提供 Terraform IaC。目标 compartment 已由人工创建，显示名称为 `Mail_project_stg`；Terraform 实施时必须提供该 compartment 的 OCID。

## 资源范围

Terraform 将准备以下 Staging 资源：

- Staging VCN、Public Subnet、Internet Gateway、Route Table。
- Web/API NSG：开放 SSH、HTTP、HTTPS；SSH 必须收窄到管理员固定 IP。
- DB NSG：PostgreSQL `5432` 仅允许 Staging 子网访问，禁止公网访问。
- Always Free Compute：默认 `VM.Standard.A1.Flex`，用于 MVP Staging 单机承载 Frontend / Backend / PostgreSQL 16 容器。
- Object Storage Bucket：用于 Staging 非真实数据备份与运维产物归档，并配置生命周期自动清理。
- Cloud-init：安装 `docker.io` 与 Ubuntu 22.04 arm64 默认源可用的 `docker-compose-v2`、将默认 `ubuntu` SSH 用户加入 `docker` 组、创建目录和占位配置，不写入真实 secrets，不自动启动应用。

## Always Free 人工确认项

执行 `terraform apply` 前必须由人工确认：

1. `region` 是 OCI tenancy home region；Oracle 文档说明 Always Free compute / Autonomous Database 等资源需在 home region 创建。
2. `Mail_project_stg` compartment 的 OCID 正确。
3. A1 Flex 免费池仍有可用 OCPU/内存；若容量不足，可人工改为 `VM.Standard.E2.1.Micro` 后重新评估 Node.js + PostgreSQL 资源占用。
4. `admin_ssh_cidr` 已替换为管理员固定公网 IP/CIDR，禁止使用 `0.0.0.0/0`。
5. `ssh_public_key` 只包含公钥；私钥、API key、数据库密码、JWT secret、邮件 token 不得提交到仓库。
6. Object Storage 使用量和 Block Volume 使用量没有超出当前账户 Always Free 额度。

## 手工实施流程

已有 Staging VM 的 #116 扩容准备与回滚见下节；不要将首次创建流程直接当作扩容操作。

```bash
cd infrastructure/oci-staging
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars：填写真实 compartment OCID、region、SSH 公钥、管理员 CIDR。
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
# 人工审核 plan 后才允许执行：
terraform apply tfplan
```

## #116：免费规格核对与 Staging 扩容准备（2026-09-08）

本次更新参数默认值、示例与操作文档；已生成完整 plan，尚未修改云端服务器、执行 apply 或开始压测。
本地 `terraform.tfvars` 与未刷新 state 记录 A1 **1 OCPU / 6 GB / 50 GB 启动盘**；
这不是本次实时云端核验结果。私有 tfvars 保持原值，会覆盖新的变量默认值。

2026-09-08 后续只读核验：Staging `app01` 实测 1 CPU、约 6 GB 内存；根分区约 49 GB，
已用 15 GB；四个 Compose 容器均 healthy，部署 commit 为 `abc95ad18183a3f78a4a1818aa0c23625ed73718`。
使用 2/12/100 参数生成的完整 Terraform plan 要求 `oci_core_instance.app` delete/create，
replacement 路径为 `metadata`。该计划禁止执行；需先审查 bootstrap metadata 差异并准备保留实例/数据卷的
原地更新方案，再生成和审核新计划。计划仅保存在 gitignored 本地文件中。

| 参数 | 本地配置/state 基线 | 拟调整目标 |
|---|---|---|
| `instance_shape` | `VM.Standard.A1.Flex` | 保持 A1 Arm |
| `instance_ocpus` | 1 | 2 |
| `instance_memory_gb` | 6 | 12 |
| `boot_volume_size_gb` | 50 | 100（2026-09-08 用户确认） |

Oracle 当前 [Always Free 资源说明](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
给出的 A1 免费池为每月 **1,500 OCPU 小时 / 9,000 GB 小时**，对应 **2 OCPU / 12 GB**。
31 天持续运行的目标实例使用 1,488 OCPU 小时、8,928 GB 小时（按 744 小时计算）。
这是 tenancy 共享池，不能按 compartment 或每台 VM 重复计算；必须扣除其他 A1 用量。
旧资料中的 4 OCPU / 24 GB 不作为本方案免费依据；若账户合同或控制台显示不同额度，先核实适用条款。
额度、区域实际容量、计费资格是三个不同条件，配额可申请不等于免费。

同一官方页面列出：home region 的启动盘与块盘合计免费 200 GB、卷备份合计 5 份、
出站流量每月 10 TB。用户确认暂无其他服务器需求，启动盘目标改为 100 GB，
供 PostgreSQL 数据、Docker 镜像与日志共用；若无其他卷占用，剩余免费卷容量为 100 GB。
200 GB 是共享存储容量，不是磁盘性能承诺；#116 仍需记录实际卷性能档位、VPU/GB、
IOPS/吞吐和延迟。扩盘不自动改变数据库配置或保证吞吐提升。
Always Free 闲置实例可能被回收，扩容不等于可用性保证。

### 免费额度调整时间的证据边界

截至 2026-09-08，当前官方资源页可确认 2/12 额度，但未提供这次修改的生效日期或修订历史。
[Oracle 社区 2026-06-24 用户报告](https://community.oracle.com/CustomerConnect/discussion/966208/always-free-a1-flex-instance-disabled-shows-contact-customer-support-to-reenable-after-trial-end)
称 2026-06-15 生效；[2026-08-19 用户报告](https://community.oracle.com/customerconnect/discussion/974409/always-free-a1-instances-disabled-request-re-enable)
称超额实例在 2026-08-18 被停用。两者均为客户发帖，不是 Oracle 正式政策公告。
因此暂记“2026 年 6 月中旬已有调整报告，8 月有执行停用报告”；不能把 6 月 15 日
表述为已获官方公告确认的日期，也不能将所有账户的文档更新、计费生效和停用日期混为一谈。

### 扩容执行顺序（待批准维护窗口）

1. 在 OCI Console 核对 home region、Staging 实例、账户免费资格、Limits/Quotas/Usage、
   所有 compartment 的 A1 占用与当月累计用量、卷/备份用量和费用预估；确认目标仍为 0 成本。
2. 记录实时 shape、CPU/内存、启动盘性能、IP、实例/卷身份与部署 commit。
   按 Staging Runbook 备份数据库、Caddy 数据和配置，验证备份可读；保留现有 state 的受限副本。
3. 将 gitignored `terraform.tfvars` 的 CPU/内存改为 2/12、启动盘改为 100 GB；保留 region、镜像、网络和 secrets。
   执行 `terraform fmt -check`、`terraform validate`，生成新的完整 `terraform plan -out=<新的本地计划文件>`。
   plan/state 可能含敏感信息，不提交、不粘贴完整输出，也不复用旧 `tfplan`。
4. 允许变更仅为 CPU/内存与现有启动盘容量的原地更新，不允许新增、删除或替换实例/卷。
   `source_details.boot_volume_size_in_gbs` 是否能更新既有卷须以当前 provider 的 plan 和实际卷结果核实；
   若要求 replacement 或不产生卷扩容计划，停止该路径，另行准备现有 boot volume 原地扩容与 state 对齐方案。
   当前 `main.tf` 动态选择最新 Ubuntu image，可能导致无关镜像替换；若出现 replacement、
   cloud-init/网络/非目标磁盘漂移或费用变化，停止并单独处理。不得用 targeted apply 隐藏完整 plan 的漂移。
5. 审核并批准计划及维护窗口后，停止外部测试、优雅停止应用写入与数据库，再执行已审核计划。
   Oracle [实例规格变更说明](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/resizinginstances.htm)
   指出运行中的实例会重启；应按 OS 正常关机流程准备，避免强制停止导致数据损坏。
   原地规格调整保留 IP、VNIC 和卷挂载；这不适用于 Terraform replacement。
6. 扩盘前备份现有卷；按 Oracle [卷扩容说明](https://docs.oracle.com/en-us/iaas/Content/Block/Tasks/resizingavolume.htm)
   及其在线扩容步骤核对设备、分区与文件系统类型，必要时重新扫描磁盘并扩展分区/文件系统，
   不假定 OCI 显示 100 GB 就代表根文件系统已可用。使用 `lsblk -f`、`findmnt`、`df -hT`
   验证 Docker 数据目录和 PostgreSQL named volume 所在挂载点已获得新增空间，保留原数据卷。
   启动后核对 OCI 规格以及主机 `nproc`、`free -h`；检查 Compose 健康、容器资源限制、
   HTTPS `/health`、`/healthz`、登录与合成 mail smoke、订阅和 tenant/location 隔离。
   保持同一应用版本，避免将软件变化混入扩容对比；记录实际规格后才能开始 #116 压测。
7. 回退时恢复变更前记录的 CPU/内存（本地基线 1/6），重新生成并审核原地调整计划，
   安排同样的停机/重启验证。容量不足时回退也可能失败；不要删除实例或数据卷来抢占容量。
   **启动盘扩到 100 GB 后保留 100 GB，不能把 tfvars 改回 50 来原地缩盘。**
   必须恢复数据时使用已验证备份，迁移到更小磁盘属于另行规划的数据恢复任务。

### 与 #116 测量、监控的衔接

2/12 是硬件配置目标，不是并发扫码或发信容量结论。压测需记录实际 CPU/内存/卷性能、
Compose 限制、部署 commit、mock/sandbox provider、并发阶梯、SLO 和停止条件。
宿主机资源增大不会自动增加 Node.js worker 数或数据库/邮件处理并发；瓶颈应由测量确定。
压测负载机应位于被测 VM 外，并记录负载机自身是否饱和。

监控选型继续以 [docs/observability.md](../../docs/observability.md) 和 #116 为准。
官方免费清单提供 Monitoring 5 亿采集点 / 10 亿读取点、Notifications 每月 100 万 HTTPS / 1,000 邮件，
APM 每小时 1,000 tracing events / 10 次 Synthetic Monitor runs；接入前复核对应服务的计量周期与账户用量。
建议先评估 OCI 主机指标加轻量容器/数据库采集及现有 mail worker 聚合日志；
API 分位延迟、队列等待与数据库锁等待不能用主机 CPU 指标替代。
采集频率、保留量、告警接收方与开销在 #116 确认，本轮尚未安装采集组件或启用通知。

## 非范围声明

- 本 IaC 不创建 Production 资源。
- 本 IaC 不接入真实邮件服务；MVP Staging 仍使用 mock/sandbox provider。
- 本 IaC 不写入或生成任何真实 secret。
- 本 IaC 不自动部署 Poolduck Mail 应用镜像；应用发布流程由后续 Issue 单独定义。
- 本 IaC 不创建 OCI Autonomous Database，因为当前 ADR-004 已确定 MVP 数据库为 PostgreSQL 16。

## 参考

- OCI Always Free 官方文档：`https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm`
- Terraform OCI Provider：`https://registry.terraform.io/providers/oracle/oci/latest`
