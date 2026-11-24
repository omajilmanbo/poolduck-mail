# #225 · Node.js 24 与 22 的本机兼容性回执

**2026-11-24 结论**　Node 24.22.3 和 22.23.5 均通过冻结候选的 Git 原始字节复验。两版各通过 345 项单测、21 项 PG16 迁移、授权扫码、取消及 mock 发送，双向切换后均可回读原任务。候选提交为 `a05251897d7fc11d96114606bcaa1807dd96af55`，Git tree 为 `93ab3e15fddc235b46fbb7a17997a46c8818b03a`。项目负责人随后于 2026-11-24 批准 D20 A，选定 Node 24。实际 Staging 发布另行验收。[Accepted ADR-030](../decisions/ADR-030-node-runtime-major.md)

## 11 月 24 日 · Node 24 实施候选与工件复用

实施候选 `153887410f2370aec525d935435dadaeac74b08d` 基于已含 #218、#229 的 main `18f512e`。本机核对 334 个 Git blob，使用两份正式 Dockerfile、锁文件和发布模板完成以下验证。平台为 `linux/amd64`，两端实际输出均为 Node `v24.22.3`、npm `11.19.1`。[实施 PR #230](https://github.com/omajilmanbo/poolduck-mail/pull/230) · [该提交完整 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/45303384365)

| 实际执行 | 结果 |
| --- | --- |
| `release.py prepare`，两端从 Git 上下文运行 `npm ci`、`npm run build`；随后执行 `release.py verify` | 退出 0，镜像清单、平台、候选、实际补丁与归档 SHA-256 匹配 |
| 独立断网容器执行 `npm test`、`npm run typecheck`、`npm run lint` | 后端 30 套 284 项、前端 9 套 74 项通过，六条命令均退出 0 |
| 专用内部网络、空 PG16 卷；原入口启动、`local:seed`、`smoke:api` | 21 个迁移名称逐项匹配；登录 201，未映射扫码和未获授权地点均返回 404。取消任务 0 次尝试，另一次扫码产生 1 次 mock 调用与回执 |
| 再次 `verify` 载入相同归档，`up --force-recreate --no-build --pull never` 成对重建容器 | 两个实际镜像 ID 与首轮逐项相等。保留原数据库容器和卷，迁移无待办，2 条扫码、2 个任务、1 次尝试及迁移记录指纹相同，健康且重启次数均为 0 |
| 在第二套独立空卷使用 `APP_ENV=staging`、`staging:seed`、本地测试 CA 和原 Caddy 路由运行 `smoke:api` | 同一镜像对，HTTPS 首页及两个健康接口均 200，HTTP 跳转 308；登录 201 且 Cookie 带 Secure，mock 冒烟退出 0。两套演练的项目资源均已清理 |
| 拒绝错误清单摘要、其他提交、错误架构、截断归档及互换服务镜像 | 五种输入均退出 1。正确清单与归档重复验证退出 0 |
| 完整 GitHub Actions | 前后端检查、ADR-017 PostgreSQL 门禁、Playwright success 与 failure 两条路径共 5 项成功 |

| 本地工件 | SHA-256 |
| --- | --- |
| 后端 | `dd0adbd8b1504d4ac71f20dec4c225fce64e13db3ec49f44633451b43bd84ddf` |
| 前端 | `ff00864237be22d605edced1dcdd9603aa94e3f634a53694d6919136a7a13ea9` |
| 清单 | `6cbc351cdb11675df5b38bac5ef77e9e0355bf2489d078e37b74941028bcd687` |
| 镜像归档 | `7e34355ef4ba4465c6a7cdb8ff7bec467fb15cc81d8e88d7f83cb033cb5474bf` |

此前实施提交 `ea5a770` 的本机后端快照中 `libssl.so.3` 被截短，空库启动退出 1。修正后构建与运行共用已执行 `openssl version` 的基础层，并在准备、载入后实际检查解包镜像。实际 Staging 的 arm64 工件、公开 DNS/TLS、端口可达性和人工功能验收由操作者另记。将来生产只晋级最新实际 Staging 验收记录中的工件对。[Staging 发布与验收手册](../staging-manual.md#34-构建和启动服务)

## 11 月 24 日 · 镜像恢复与运行验收

重启后在本机 `desktop-linux`、Engine 29.9.3、Compose 5.7.0、`linux/amd64` 上复验。重新导出候选的 329 个文件，逐个匹配原 Git blob。两个 Dockerfile 的实验副本各仅替换两处 Node 基础镜像主版本。四个 `:git-blobs` 标签的索引摘要均匹配 11 月 20 日的构建日志。

| 服务 | 重启后从原索引读取的结果 | 本次实际运行摘要（SHA-256） |
| --- | --- | --- |
| Node 22 后端 | 原镜像断网、只读启动成功，63 个随镜像发布的源码文件与 Git 原件匹配。`docker image save --platform linux/amd64` 退出 0，核验 13 个层、Linux manifest 和配置共 15 个 blob，合计 197,287,791 字节。 | `5362d7a2b5c6ed1f58443ddd099599be434939485793b9a67d0012459c4d72eb` |
| Node 22 前端 | 本地快照内的包清单和锁文件均为 0 字节，原归档内两者匹配 Git。用原层恢复后，23 个源码文件与 Git 匹配，另核对 Next.js BUILD_ID。 | `11079fdf930ac9c182661c5a58c84f02202abd656858120715c8a3b5d1e25a28` |
| Node 24 后端 | 两个清单同为空文件。校验归档后重新加载原索引仍复现；用原层恢复后，63 个源码文件与 Git 匹配，另核对编译入口 `dist/main.js`。 | `bdffb3f8377d0c74f371c55c18799ad04ef51267ce5d95e8cd14da6aaa4cec74` |
| Node 24 前端 | 两个清单同为空文件。用原层恢复后，23 个源码文件与 Git 匹配，另核对 Next.js BUILD_ID。 | `c0a1534cd4a2142bf01c6d4fd68dad6f5a6667c4537a5173335f824f5e939ffa` |

后三个原标签在探针中均报 `ERR_INVALID_PACKAGE_CONFIG`。其归档的压缩层、Linux manifest 和配置均通过摘要校验。恢复时只在原层序列前加入一个零文件的空 tar，使 Docker 重新解包到新快照。全部原层及其顺序、应用启动配置和依赖沿用原工件，运行摘要按表中记录。归档与实际运行容器中的对应源码及编译产物均逐文件匹配。本轮没有重新下载包或编译应用。

| 检查 | Node 22 / npm 10.9.9 | Node 24 / npm 11.19.1 |
| --- | --- | --- |
| 断网运行 `npm test` | 后端 Jest 30 套、273 项；前端 Vitest 9 个文件、72 项。均退出 0 | 同左 |
| 两端运行 `npm run typecheck`、`npm run lint` | 四条命令均退出 0 | 同左 |
| 空库启动 | PG 16.16，public 表计数 0；按默认命令迁移并启动。日志与数据库逐名匹配 21/21 项迁移，首页及前后端健康端点均 200 | 同左 |
| 运行 `npm run local:seed`、`npm run smoke:api` | 均退出 0。操作员登录 201、授权地点 1 个；跨租户地点及未映射码均 404，新增任务 0。合法扫码 201，取消 200，尝试 0；再次扫码 201，唯一一次 mock 尝试成功，提前领取 0 | 同左 |
| 成对切换前后端 | 22 → 24 成功 | 24 → 22 成功 |

每组使用全新的 PG16 卷、专属内部网络、零宿主端口，启用 mock 且关闭真实发送。切换时先确认两笔合成任务均已终结，再仅重建前后端容器。两次均保留各自的同一数据库容器和卷，迁移日志显示待执行项 0。重新登录 201，两份列表及四个详情均 200。切换前后两笔扫码、两笔任务、一条尝试和 21 项迁移的数据库行数及内容指纹相同。三个服务均 healthy，重启数均为 0。

两个项目结束后容器、卷和网络均为 0。已回收 11 月 20 日四个停用的 `:trial` 标签。四份原始 OCI 归档、恢复脚本及新旧摘要保存在本机。运行回执包 `issue-225-git-blob-runtime-20261124.zip` 的 SHA-256 为 `a6372c65ce62ea5d999795ced4cf6d37aa38a840f45186073f334616fb2ffdc6`。包内 `verified.json` 汇总两组结果，`22-backend-export.json` 保存导出证明，`22-smoke.json` 与 `24-smoke.json` 保存启动、迁移、HTTP、切换和清理记录；`SHA256SUMS` 可独立核验。

## 输入与复验方法

- 本机 Docker Desktop 4.90.0、Engine 29.7.2，平台 `linux/amd64`。首轮两组均使用 Windows 自动换行的归档。复核重建了同 SHA-256 的首轮归档，逐个比较 329 个文件，唯一差异为 LF 转 CRLF。两份锁文件的 JSON 完全相同，含版本、解析地址和完整性字段。应用结果与原始字节复核分列如下。
- 原始字节复核用 `git -c core.autocrlf=false archive --format=zip a052518`，对全部 329 个文件按 Git blob 算法回查 tree。两组导出后，分别只替换前后端 Dockerfile 的 deps 和 runtime 的基础镜像主版本，共四处。其余字节逐项相同。后端锁文件 SHA-256 为 `fe9578ffe0f21dcef43ed37a0902928debb7ef749809c4963aaeaefccc250b70`，前端为 `849b06d82f8af67c87ee1742a89106e9d719f291939eb54b6d5a6839f61c8670`。
- 各服务从临时上下文执行 `docker build --no-cache --platform=linux/amd64`，沿用 Dockerfile 的 `npm ci --no-audit --no-fund` 和 `npm run build`；前端构建参数为 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`。测试容器使用各自构建镜像中的 node_modules，复制冻结测试源码后分别运行 `npm test`、`npm run typecheck`、`npm run lint`。
- 每组通过独立 Compose 项目启动 `postgres:16`、后端与前端。运行镜像按摘要指定，只连接内部网络，宿主端口映射为零。先查空库，再以镜像默认命令执行 `npm run db:deploy` 和 `npm run start`。用 `npm run local:seed` 写入合成数据，运行 `npm run smoke:api`，按数据库记录核对任务、调用、取消时间窗和 mock 回执。

## 首轮构建与应用结果

| 项目 | Node 24 | Node 22 |
| --- | --- | --- |
| Node / npm | 24.22.3 / 11.19.1 | 22.23.5 / 10.9.9 |
| 安装和前后端构建 | 后端 697 包，Prisma Client 7.8.0、TypeScript 编译成功；前端 350 包，Next.js 16.2.6 生成 13/13 个静态页面 | 相同 |
| 后端 Jest / 前端 Vitest | 30 套 273 项 / 9 个文件 72 项通过 | 相同 |
| 类型检查与 lint | 后端、前端各两项均退出 0 | 相同 |
| PG16 启动与迁移 | 16.16；空库 0 张业务表，21/21 个迁移名称匹配源码 | 相同 |
| 登录与授权 | 后端健康 200，操作员登录 201，可发送订阅及授权地点列表均 200，地点数 1 | 相同 |
| 拒绝路径 | 跨租户地点 404 `LOCATION_NOT_FOUND`；授权地点未映射动作码 404 `SCAN_CODE_NOT_MAPPED`。两者各新增 0 次扫码、任务和调用 | 相同 |
| 授权扫码与取消 | 扫码 201 → waiting，窗口内取消 200 → canceled，尝试 0，provider 调用 0 | 相同 |
| 再次授权扫码与 mock | 新幂等键扫码 201 → waiting → sent；尝试 1，准确匹配的 sandbox 回执 1，提前领取 0；扫码和任务历史详情均 200 | 相同 |
| 结束状态 | 前端首页与健康 200，三个服务 healthy，重启 0 次；专属容器、卷、网络清理完成 | 相同 |

两版安装日志的 `EBADENGINE` 均为零。npm 11 提示后端四个、前端两个包的生命周期脚本尚未配置 `allowScripts`，涉及 `@nestjs/core`、`@prisma/engines`、`argon2`、`prisma`、`esbuild`、`sharp`。当前构建与合成流程通过。两组仅使用 mock，实际投递为零。

## 镜像身份

以下值为 SHA-256 摘要。两轮使用相同的官方基础镜像。首轮以所列前后端镜像运行了上表全部检查。

| 镜像 | Node 24 | Node 22 |
| --- | --- | --- |
| `node:<major>-bookworm-slim` | `dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54` | `e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee` |
| 首轮后端 | `a23bb40bd4ab489ac68b47715a9c85db420c96dca0f18ad8689d2f5b6988760d` | `b4565a0e0f410839b68b689f597104ae3a4f6124c0d9cc1ba947c91002ffb6a7` |
| 首轮前端 | `3c75b8259cf3ec7636ead181a90156c026d2d01bd8a22a8ab95d8d6d6af1d785` | `d1128249bcdb515c6407c937a73d5fa7bb111251826edf774c62a5a834e8612e` |
| Git 原始字节后端 | `59bc850c54cd11fa2c92e9aa1ef335f09b37363054a8a98100a386785e5f4d1d` | `5362d7a2b5c6ed1f58443ddd099599be434939485793b9a67d0012459c4d72eb` |
| Git 原始字节前端 | `ad2650b999abcb4f13e4d317809fc7e971a34a14f800469b8f316b8c80ec6de7` | `80cae3bff4ac454f88b3e80ff11f800012e6ea0372ac5afd2c6bf5efcd2b11d5` |
| `postgres:16` | `3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f` | 同左 |

## 11 月 20 日 · Git 原始字节复核中断记录

四份构建日志均记录了锁定依赖安装、后端 Prisma/TypeScript 或前端 Next.js 编译成功。24 的两份镜像和 22 的前端镜像完成导出并取得退出码 0。22 后端已生成并标记 manifest，最后一条日志是运行镜像解包，未取得成功退出码。

当时宿主 C 盘可用空间降至 0，WSL 探测返回 `HCS_E_CONNECTION_TIMEOUT`，因此终止构建和验收客户端。11 月 20 日的 Node 22 后端构建退出码仍未知。11 月 24 日用原索引重新取得导出和运行回执，并完成两版锁文件回读、单测、类型检查、lint、PG16 迁移及 HTTP 冒烟。正式实施时仍须在目标架构上验证最终提交。

本机证据包 `issue-225-runtime-receipts.zip` SHA-256 为 `a75c9cb4325c1f2aa926192a35b25c953388535ae3ed3f4db1bfa7015416cfc9`。其中 `first/` 含构建与测试日志、进程退出码、PG16 启动与 API/数据库回执，`git-blobs/` 含逐文件复核、第二轮构建日志与原始字节比对，`historical-node20/` 保存既有回执。包内 `SHA256SUMS` 可逐文件核验。

## Node 20 历史对照与适用范围

既有 `full24-clean-build/verified-receipt.json` 的源码是 24 个 PR 的冻结组合 `b1aca63c2cbd0a3477b4ebcded2afb58dd5b163e`。它与正式候选共享两份 Dockerfile、两份锁文件及两份 .dockerignore 的 Git blob，后端 package.json 的 scripts 有差异。原始 Node 20.20.2 / npm 10.8.2 构建、21 项迁移及合成 mock 冒烟通过，后端安装报告 `@prisma/streams-local@0.1.2` 要求 Node ≥22。该轮基础镜像摘要为 `2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`，本次复用了历史回执。

本机矩阵覆盖 Linux amd64、空 PG16 和合成 API 流程。完整 GitHub Actions、浏览器 E2E、实际部署宿主及发布批准留到 ADR 接受后的独立实施。编号核对覆盖 68 个远端分支、本地 Git 历史和 worktree 文件。远端最高为 ADR-024，本地已有 025、026、027、029，故使用 030。
