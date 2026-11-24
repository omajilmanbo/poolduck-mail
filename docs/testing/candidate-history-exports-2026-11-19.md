# 首次部署候选扫码历史与 CSV 补验（2026-11-19）

候选为 `a05251897d7fc11d96114606bcaa1807dd96af55`。本报告补充[业务要求矩阵](business-requirements-matrix.md#H01)的历史查询、分页和 CSV 导出证据。在独立 PostgreSQL 上，浏览器两轮补验最终均通过。同日另验两种 CSV 的空结果与单次 503 反馈。H03 分别记录反馈缺口和待产品裁定的 D09 导出范围。

## 既有证据

候选 main [CI 44474610784](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44474610784) 的前端、后端、PostgreSQL 门禁与两组 Critical E2E 均成功。[前端历史测试](../../frontend/test/history-page.test.tsx)已覆盖每页 25 条、游标、条件与地点切换、错误、当前页轮询和取消。[后端历史测试](../../backend/test/history.spec.ts)已覆盖组合条件、游标、授权与安全字段。[CSV 测试](../../backend/test/export.spec.ts)已覆盖公式转义、UTC／取消字段、地址脱敏和时间范围。候选的[既有浏览器用例](../../frontend/e2e/mvp-workspace.spec.ts)覆盖单条扫码流程、刷新保留历史、等待期取消及跨租户地点拒绝。以下补验使用真实数据库记录，专门覆盖多页历史和两种浏览器下载。

## 实测结果

| 条款 | 本次观察 |
| --- | --- |
| [H01](business-requirements-matrix.md#H01) 历史范围和安全字段 | 两个合成租户、三个地点。普通 `operator` 只看到其分配的地点 A，未指定地点时，扫码和邮件列表各返回 25 条。本地点明细为 200，其他未分配地点及另一租户的列表和已知明细均为 404。普通 `tenant_manager` 可读取本租户地点 B 的明细，另一租户的明细仍为 404。匿名列表为 401。验证失败记录明细未包含植入的完整地址、原始载荷、正文、原始错误和 provider 标记。 |
| [H02](business-requirements-matrix.md#H02) 分页和筛选 | 地点 A 的 34 条可区分记录分成 25 与 9 条，跨页边界的两条记录具有相同创建时间，按 ID 稳定排序。前后翻页和第二页手动刷新保留精确记录集合，跨页无重复，末页按钮不可用。单独筛失败得 2 条并回第 1 页。单独筛一天时得到 25 与 6 条。Chrome 的 `Asia/Tokyo` 日期转换为 UTC 起止，包含两端毫秒且排除外侧毫秒。日期加 sent 共 28 条（25 与 3）。筛选条件变化回第 1 页，从第二页切到同租户授权地点 B 也回第 1 页（1 条）。实际请求保留状态和日期并省略游标。 |
| [H03](business-requirements-matrix.md#H03) 工作台实际下载 | 用普通 `tenant_manager` 在 A 保持一天加 sent 筛选时点击“导出扫描”和“导出邮件”。两个请求各仅带当前地点和近 30×24 小时的 UTC 起止，不带状态或当前日期筛选，也不受当前页限制。两个下载各 33 行，均为 30 sent、2 failed、1 canceled。另一同租户地点、另一租户和距运行日约 32 天的记录均未导出。直接 API 调用相同地点、页面日期和 sent 条件，两种导出各 28 行。 |
| [H03](business-requirements-matrix.md#H03) CSV 字段和限制 | 两个下载均为 UTF-8 BOM，中文、日文、逗号和引号往返一致，时间以 UTC `Z` 表示。扫描 CSV 记录原 `entry`、取消状态及时间；邮件 CSV 保留 `entry` 与 `canceled`，无发送时间，地址本地部分脱敏。下载未包含合成完整地址、正文、主题、原始载荷、错误或 provider 标记。两种导出跨租户地点为 404、超 31 天为 400。operator 无导出按钮，直接调用两种导出均为 403。 |
| [H03](business-requirements-matrix.md#H03) 行数上限和审计 | 在同一隔离库追加 5,001 对终态记录后，地点 B 有 5,002 行。两个工作台下载都返回 HTTP 200 和最新 5,000 行，均省略最旧 2 行。成功导出审计逐类记录 28、33 和 5,000 行，与实测对应。脚本调整前额外做过一次扫描下载，多一条计数为 33 的成功审计。 |

**D09 导出范围待产品裁定** [#79](https://github.com/omajilmanbo/poolduck-mail/issues/79) 的验收文字是“导出自己 tenant 的筛选结果”，[#169](https://github.com/omajilmanbo/poolduck-mail/issues/169) 将导出规则排除在范围之外。候选的 API 支持按筛选结果导出，工作台按钮固定下载当前地点近 30 天。对只关注某日或状态的用户，文件可包含页面未显示的记录。现有两项 Issue 未裁定按钮是否应沿用页面条件，或保留近 30 天并明确标示。该选择保留给产品评审。

## 环境和命令

Windows，Docker Desktop Linux 引擎 29.7.2，容器 Node 20.20.2、PostgreSQL 16.16、Next.js 16.2.6。浏览器为后台 Chrome 157.0.8103.79，由本机 Node 24.16.0 和 Playwright 1.51.1 驱动。Playwright 版本与候选锁文件一致。候选的前后端用各自 Dockerfile 构建，三容器 healthy，空库应用 21 项迁移。测试配置为 `APP_ENV=local`、`MAIL_PROVIDER=mock`、`REAL_MAIL_SEND_ENABLED=false`，关闭保留清理和 OCI 应用告警。前端和后端只绑定 loopback，数据库无宿主端口。浏览器测试上下文只允许访问这两个 HTTP 来源。所有发送任务均为直接构造的终态行，执行结束有 0 条发送尝试。

### 当次运行记录

下表记录实际使用的入口和各自依赖。临时的 `history-lab/` Compose 配置、合成数据夹具和浏览器驱动均未随报告提交。

| 顺序 | 当次操作 | 来源和用途 |
| --- | --- | --- |
| 1 | 用当次 Compose 配置执行 `up --build --wait`，然后在 backend 容器运行 `node scripts/local-seed.mjs` | 容器服务使用仓库 Dockerfile，基础数据由[仓库 seed](../../backend/scripts/local-seed.mjs)生成。 |
| 2 | 将临时 `seed.cjs` 输入 backend 容器的 Node 进程，再运行 `node history-lab/check.cjs` | 夹具补入跨租户、同时间戳和日期边界等记录。临时浏览器驱动验证分页、权限和两种 CSV 下载。 |
| 3 | 将临时 `cap.sql` 输入隔离数据库，再运行 `node history-lab/check.cjs --cap` | 在地点 B 追加 5,001 对终态记录，验证 5,002 行中导出最新的 5,000 行。 |
| 4 | 用同一临时配置执行 `down --volumes --rmi local` | 清理当次容器、网络、数据库卷和本地镜像。 |

最终两轮浏览器脚本退出码均为 0，分别耗时约 2.5 秒和 1.2 秒。随后按 Compose 项目标签确认容器、网络和数据库卷均无残留。

### 仓库提供的验证入口

完成[本地开发环境准备](../development.md)后，可运行下列仓库用例。其中的浏览器命令需要已启动的前后端和本地合成数据。它们覆盖“既有证据”所列的断言。要独立重建本报告的 34 条历史及 5,002 行上限场景，还需按上表准备相应的合成记录和浏览器断言。

| 工作目录 | 命令 | 对应仓库用例 |
| --- | --- | --- |
| `backend/` | `npm test -- --runTestsByPath test/history.spec.ts test/export.spec.ts` | [历史查询](../../backend/test/history.spec.ts)、[CSV 导出](../../backend/test/export.spec.ts) |
| `frontend/` | `npm test -- test/history-page.test.tsx` | [工作台历史组件](../../frontend/test/history-page.test.tsx) |
| `frontend/` | `npm run test:e2e -- e2e/mvp-workspace.spec.ts` | [既有浏览器回归](../../frontend/e2e/mvp-workspace.spec.ts) |

## H03 空地点与单次 503 的导出反馈

在同一候选另建隔离项目，只加载仓库的标准合成种子。tenant_manager 登录后切换到空地点 B，历史接口返回 200 和空列表，工作台原先就显示“暂无扫码记录”。

| 操作 | 导出扫描 | 导出邮件 |
| --- | --- | --- |
| 空地点点击导出 | HTTP 200，`scan-events.csv` 只有 1 行表头、0 行数据 | HTTP 200，`mail-jobs.csv` 只有 1 行表头、0 行数据 |
| 浏览器路由仅对下一次请求返回 503 | 下载 0 个文件，出现 1 次未处理的 Promise 拒绝“导出失败” | 下载 0 个文件，出现 1 次未处理的 Promise 拒绝“导出失败” |
| 503 后直接再次点击同一按钮 | 按钮仍可用，HTTP 200，恢复下载 1 行表头、0 行数据 | 按钮仍可用，HTTP 200，恢复下载 1 行表头、0 行数据 |

空结果和 503 后，页面可见文案及 `alert`、`status` 均与点击前相同。两种成功下载均有 UTF-8 BOM。[#190](https://github.com/omajilmanbo/poolduck-mail/issues/190)独立跟踪导出空结果及失败缺少反馈。历史补验时，[PR #191](https://github.com/omajilmanbo/poolduck-mail/pull/191)的[五项 CI](https://github.com/omajilmanbo/poolduck-mail/actions/runs/44512950595)通过，当时修复尚未合并。2026-11-24，#191 已合入 [`ba70c9d`](https://github.com/omajilmanbo/poolduck-mail/commit/ba70c9d9514e6b6e58a05b5f09daf3569b7c149f)，历史表仍对应 `a052518`。D09 单独处理按钮的导出范围。

当次仅运行仓库的基础种子和临时浏览器驱动 `node history-lab/check-feedback.cjs`。该驱动与临时 Compose 配置均未提交。后台 Chrome、Node 及 Playwright 的版本同前，脚本退出 0，耗时约 1.7 秒。扫码、邮件任务和发送尝试均为 0。清理后确认实验容器、网络和数据库卷均无残留。

## 本次未覆盖

当前页短时轮询与取消沿用已有测试证据。本次未实测翻页期间并发插入、旧记录缺少姓名快照或已删地点、新增扫码重置筛选、单次 503 以外的下载异常、其他浏览器或时区。5,002 行场景仅验证功能上限。测试对象是本机合成 PostgreSQL 和浏览器，生产容量与云服务不在本次覆盖内。
