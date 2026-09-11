# Staging cloud-init 差异处理记录（#116）

后续执行已完成，见 [扩容执行记录](staging-resize-2026-09-08.md)。
特别纠正：本记录的原地更新计划仍包含未被顶层属性比较识别出的 `source_details.source_id` 镜像变化，
并非只有磁盘大小变化；执行时已固定原镜像、升级 provider 并拆分 CPU/内存和启动盘操作。

日期：2026-09-08。范围：只读核验、Terraform 配置修复和完整 plan；未 apply、未重启或重部署。
基于发布分支 `codex/tenant-csv-staging-capacity` 的 `908d447`，本记录与修复为其后续本地修改。

## 原因与差异

将原扩容 plan 中实例的 before/after `metadata.user_data` Base64 解码后比较。
归一化 CRLF/LF 后仍存在实际内容差异，因此不是单纯的 Windows 换行问题。

| 项目 | 云端实例 metadata 中的旧脚本 | 仓库当前模板 | 本次 SSH 观察 |
|---|---|---|---|
| Compose 包 | `docker-compose-plugin` | `docker-compose-v2` | 已安装 `2.40.3+ds1-0ubuntu1~22.04.1`；sudo Compose 可用 |
| Docker 用户组 | 无追加命令 | 将 ubuntu、poolduck 加入 docker 组 | poolduck 在 docker 组；ubuntu 不在，仍用 sudo |
| 应用目录属主 | `poolduck:poolduck` | `ubuntu:ubuntu` | `/opt/poolduck-mail` 为 `ubuntu:ubuntu` |
| 换行 | 旧内容含 58 个 CR | 新内容含 49 个 CR | 编码差异也影响 user_data 比较 |

OCI provider 8.16.0 的原 plan 对 `oci_core_instance.app` 给出 `delete/create`，
`replace_paths` 为 `metadata`，实际改变的 metadata key 是 `user_data`。
旧脚本是实例创建时的输入，不是当前主机配置的完整快照。`cloud-init status` 返回 `error`（exit 1）；
本次未清除历史状态，未重跑 cloud-init，也未将该状态宣称为已修复。现有四个应用容器此前核验均 healthy。

## 处理方式

在 `infrastructure/oci-staging/main.tf` 的实例资源上增加：

```hcl
lifecycle {
  ignore_changes = [metadata["user_data"]]
}
```

遵循 Accepted ADR-005 的 bootstrap-only 边界：新建实例仍使用当前模板；既有实例的系统修复
由 Staging Runbook 显式执行，不能因模板更新替换承载 PostgreSQL 数据的主机。
这里只忽略单个创建期字段，不忽略整个 metadata、SSH 公钥、镜像、网络或磁盘配置。
Terraform 的 [ignore_changes 官方语义](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle#ignore_changes)
明确区分创建时使用配置值、更新时忽略指定属性。

该规则不会把新 cloud-init 部署到既有主机，也不会修复 ubuntu 用户组或历史 cloud-init error。
当前运维继续用 sudo Docker。未来模板中的安全修复必须单独核验既有主机并按 Runbook 实施，
不能依赖 Terraform 自动发现 user_data 漂移。移除此规则会重新暴露旧差异，应先 plan，不能直接 apply。

## 验证结果

- `terraform fmt -check`：通过。
- `terraform validate`：通过。
- 完整 `terraform plan`：通过；未使用 `-target`、未编辑 state。
- `git diff --check`：通过。

计划使用显式变量 `instance_ocpus=2`、`instance_memory_gb=12`、`boot_volume_size_gb=100`；
私有 tfvars 仍为原值，正式操作前须对齐目标参数，避免后续 plan 试图回退。

| 检查 | 原计划 | 修复后计划 |
|---|---|---|
| 实例动作 | delete/create | update in place |
| 资源增改删 | 1 add / 0 change / 1 destroy | 0 add / 1 change / 0 destroy |
| CPU | 1 → 2 | 1 → 2 |
| 内存 | 6 → 12 GB | 6 → 12 GB |
| 启动盘 | 50 → 100 GB | 50 → 100 GB |
| metadata | user_data 变化 | before/after 完全一致 |
| replacement 路径 | metadata | 无 |

唯一 managed resource 更新是 `oci_core_instance.app`，改变的顶层属性仅 `shape_config`、
`source_details`；另有两项 VNIC data source 读取，不属于资源新增或修改。
计划文件存于 gitignored `.secrets/staging/tfplan-116-cloud-init-fixed`，不上传完整计划或 metadata。

## 下一步实施边界

计划可供审核，但还不是扩容成功证据。实施前继续核对 tenancy 免费额度和维护窗口，验证备份，
对齐 tfvars 并重新生成计划。扩容后检查实际卷、分区与文件系统是否获得新增空间，
再进行应用部署与 health/smoke。100 GB 卷不能原地缩回 50 GB。
新 plan 若出现镜像或其他替换必须重新处理，当前结果不能保证将来的 plan 无漂移。
