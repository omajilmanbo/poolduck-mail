# Staging 扩容执行记录（#116，2026-09-08）

用户批准执行扩容，随后要求继续中断的任务。目标为现有 Staging `app01`：2 OCPU / 12 GB / 100 GB。
执行结果：扩容完成、原实例与原启动盘保留、四个容器恢复 healthy；完整 Terraform plan 为 No changes。

## 执行中发现的问题与处理

1. OCI provider 8.16.0 的 UpdateInstance 请求被拒绝：
   `shapeConfig.localVolumeSizeInGBs must be greater than or equal to 1`。
   [Oracle 8.19.0 发布记录](https://github.com/oracle/terraform-provider-oci/releases/tag/v8.19.0)
   明确修复仅在指定时发送该字段；已固定版本 8.19.0 并更新 lock file。
2. 下一次请求报 `requested boot volume replacement coincident with instance revision`。
   深入比较发现 `source_details` 除大小外还携带动态查询得到的新 image ID。
   **纠正此前记录的判断：plan 显示 update in place 不等于不会替换启动盘；必须比较嵌套字段。**
3. 增加 `instance_image_ocid` 可选输入，私有 tfvars 固定为当前实例的原 image ID。
   新计划使用 `boot_volume_size_gb=50`，断言唯一 managed resource 为实例 update、
   唯一变化属性为 `shape_config` 后才 apply；CPU/内存扩容成功。
4. 使用 OCI `bv boot-volume update` 对 state 中该实例的既有 boot volume 原地扩至 100 GB，
   保持 10 VPU/GB。未创建或替换卷。
5. 主机初始仍识别 50 GB，重新扫描 `/sys/class/block/sda/device/rescan` 后识别 100 GB。
   核验根分区为 `/dev/sda1`、ext4，`growpart -N` 预演通过后执行 `growpart`、`resize2fs`。
   私有 tfvars 最终为 2/12/100，完整刷新 plan 返回 No changes，无需编辑 state。

## 备份、停机与数据

每次执行前先停止 proxy/frontend/backend，再生成 PostgreSQL custom-format dump，
使用 `pg_restore -l` 验证归档目录可读，保存 Caddy `/data`、`/config`、配置与 commit，
压缩归档 `gzip -t` 通过、权限 0600，再正常停止 PostgreSQL。
最后一次备份位于 VM `/opt/poolduck-mail/backups/pre-resize-20260908-mKYA1Q.tar.gz`。
这验证归档完整性，不等同于实际恢复演练。备份未导出主机；磁盘故障的异机恢复保障仍未验证。

自动审批拒绝过含数据库/证书/环境凭据的备份下载，理由是没有敏感数据导出授权；
采用主机保留备份、单独执行已批准 apply 的方式继续。没有绕过限制或传出备份。

backend 在 stop 60 秒超时后以 137 退出，frontend 退出码 1；PostgreSQL 正常退出码 0。
失败请求后恢复旧服务以缩短停机，重试前刷新备份。该停机行为需后续排查，未修改应用来掩盖。
未删除数据库、证书卷或既有备份，未重跑 cloud-init。

## 最终验证

| 检查 | 结果 |
|---|---|
| `nproc` | 2 |
| `free -m` | 总内存 11932 MiB |
| OCI 启动盘 | 100 GB / AVAILABLE / 10 VPU/GB |
| 根 ext4 与 PostgreSQL 数据目录所在文件系统 | 约 97 GB，总用量约 15 GB，可用约 83 GB |
| Compose | postgres/backend/frontend/reverse-proxy 均 healthy |
| HTTPS `/health`、`/healthz`、`/platform/login` | 均 HTTP 200 |
| 完整 Terraform plan | No changes |
| 应用 commit | `abc95ad18183a3f78a4a1818aa0c23625ed73718`，未变更 |

本次恢复现有应用镜像，没有部署 GitHub 的 CSV 下载新版本；未执行新的扫码发信/订阅/隔离业务 smoke 或压测。
应用重部署和 #116 负载测量是后续步骤。100 GB 盘无法原地缩回 50 GB。
