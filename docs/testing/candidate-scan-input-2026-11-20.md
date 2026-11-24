# 扫码枪输入何时提交

候选 [a052518](https://github.com/omajilmanbo/poolduck-mail/commit/a05251897d7fc11d96114606bcaa1807dd96af55)，2026-11-20（JST）。**现场若要求扫完不再手动点击，候选已支持的配置是：扫码枪国家键盘与 Windows 活动布局相符，输出完整大写动作码，再输出一个浏览器可识别的 Enter 键。** 工作台须已登录、有可发送订阅、选中授权地点，且扫码输入框有焦点。无后缀设备也能录入同一码，但须另按回车或点「提交扫码」。

## S01 工作台提交与 S02 四张资产

对应矩阵条款为 [S01 工作台提交](business-requirements-matrix.md#S01)、[S02 动作码资产](business-requirements-matrix.md#S02) 和 [Q05 无后缀提交](business-requirements-matrix.md#Q05)。

从候选人员管理页打开「查看动作码」，以现有合成人员码 `01K0ABC70001` 生成四张 PNG。每张预览与 ZIP 内对应 PNG 的字节相同；用 ZXing 按对应码制独立解码，再把**解码结果**逐字符录入候选扫码页。表中是 mock 接收的 `POST /api/scan-events` 次数，不是邮件数。

| 人员页资产 | PNG 解码文本 | 只录入，无后缀 | 录入后一个 Enter 键 | 录入后点「提交扫码」 |
| --- | --- | ---: | ---: | ---: |
| 入室 QR | `E01K0ABC70001` | 0 | 1 | 1 |
| 入室 Code 128 | `E01K0ABC70001` | 0 | 1 | 1 |
| 退出 QR | `X01K0ABC70001` | 0 | 1 | 1 |
| 退出 Code 128 | `X01K0ABC70001` | 0 | 1 | 1 |

12 个场景各自重新打开页面，按字符间隔 10 ms 录入，操作后观察 1.5 秒。无后缀时 13 个字符仍在输入框；其余 8 次请求各只发一次，正文均为当前地点加原始 13 字符，无换行。无头 Chrome 157.0.8103.79、Playwright 1.51.1；从 Git 导出候选页面与 API 客户端，以 React 挂载原组件，浏览器请求全部拦截，未启动业务后端、数据库或邮件服务。候选[表单源码](../../frontend/app/page.tsx#L650-L675)也表明输入变化只更新文本，提交事件才调用 API。现有[工作台 E2E](../../frontend/e2e/mvp-workspace.spec.ts)填值后点击按钮，经真实后端建单并回读。

**Windows 布局证据与浏览器证据相互独立。** 在 Windows build 26300 只读查询系统布局 DLL 的扫描码、虚拟键和字符表。按相应国家键位、Caps Lock 关闭、直接输入 ASCII 的条件，US QWERTY（`kbdus`）、日本 106（`kbd106`）、法国传统 AZERTY（`kbdfr`）、德国 QWERTZ（`kbdgr`）均逐字符还原上表 E/X 两串及全部 32 个合法人员码字符。例如法式主键区的数字 1 需 Shift，其他三种不需；将 US 键位套入法式表的负对照未能还原原码。未切换系统布局或输入法。软件解码、布局表和浏览器模拟键入**不等于**实物扫码枪、USB HID 报文、打印件或现场 IME 验证；不据此设型号白名单。

## Q05 / D16 待产品负责人裁定

- **载荷。** [ADR-015](../decisions/ADR-015-scanner-compatible-action-code-payload.md) 允许完整载荷无后缀，也允许单个 CR、LF 或 CRLF；[ADR-022](../decisions/ADR-022-short-entry-exit-action-code.md) 与 [#150 的批准](https://github.com/omajilmanbo/poolduck-mail/issues/150#issuecomment-6211840761)将载荷确定为 13 位 E/X 加人员码，不双读旧 V2。[候选解析器](../../backend/src/scan-events/scan-events.service.ts#L732-L749)处理的是请求里已有的字符串。允许字面换行后缀，不代表设备发出的 CR 或 LF 一定在浏览器中成为 Enter 按键事件。[#117 的批准记录](https://github.com/omajilmanbo/poolduck-mail/issues/117#issuecomment-5199790819)明确 #118–#120 的双读、迁移和发布计划已关闭为 not planned，不能作为实测或新的交互决定。
- **提交。** [现场需求 §3.3.3](../requirements.md)写的是「扫码枪输入后自动发送，或回车触发发送，无需人工点击」。这句出自 [#7 的需求修订](https://github.com/omajilmanbo/poolduck-mail/commit/dbfb5a540e52d40e140c4d8484e8b5264782c158)，并未定义无终止键时以第 13 个字符为提交信号。
- **队列。** [#61 的人工决定](https://github.com/omajilmanbo/poolduck-mail/issues/61#issuecomment-5053228826)取消的是扫码事务完成后的人工「发送」按钮。[ADR-017](../decisions/ADR-017-scan-send-cancellation-grace-period.md)将首次发送改为成功提交后进入 10 秒可取消等待期，未取消才由 worker 到期领取。两者均未规定前端何时认定输入结束。

**D16 等待产品负责人决定无后缀输入的提交时点。**

- **A（建议）** 现场配置扫码枪在完整动作码后输出一个浏览器可识别的 Enter。无后缀时由操作员手动按回车或点「提交扫码」。候选已有这两条路径。
- **B** 增加识别完整无后缀动作码后自动提交一次。若采用，需要同时明确手输、粘贴、随后的 Enter 和连续扫码的处理方式，避免多发或漏发。
