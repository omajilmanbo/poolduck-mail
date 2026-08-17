# ADR-015：扫码枪兼容的人员动作码负载

- 状态：Accepted
- 日期：2026-08-06
- 相关 Issue：#117

## Context

ADR-008 已批准并实现 `PD1|ENTRY|<person_code>` / `PD1|EXIT|<person_code>`，并保留每人进入、离开两张逻辑动作码以及 QR/Code 128 四张本地资产。实际键盘模拟扫码枪可能无法稳定输入分隔符 `|`。

键盘模拟输入链路为：QR/Code 128 图像 → 扫码枪解码字符 → 扫码枪国家键盘表转换 HID Usage/修饰键 → Windows 活动键盘布局生成字符 → 浏览器输入。`|` 在常见布局中可能依赖 `Shift + \\`、Non-US 键位或不同修饰键；扫码枪与 Windows 布局不匹配时，字符可能被替换、跳过或导致后续输入停止。浏览器只收到最终文本，无法可靠推断缺失字符。

2026-08-06，业务负责人使用网页二维码解析器读取现有动作二维码，结果完整保留 `|`。这证明被测二维码图像与逻辑文本正确，并把问题范围收窄到图像解码之后的 HID/Windows/浏览器输入链路；它本身不等同于 Code 128 实体键盘模拟验证。

项目仍处于上线前阶段，业务数据尚未导入，也没有需要维持兼容的生产动作码资产。业务负责人明确决定现有 `PD1|...` 可以完全替换，不需要双读、旧资产迁移或旧解析器移除阶段。

参考依据：

- [USB-IF HID Usage Tables](https://www.usb.org/sites/default/files/hut1_21_0.pdf)：Keyboard Usage `0x31`/`0x64` 及语言映射说明；
- [Microsoft Keyboard Input Overview](https://learn.microsoft.com/en-gb/windows/win32/inputdev/about-keyboard-input) 与 [Keyboard Layout Samples](https://learn.microsoft.com/en-us/samples/microsoft/windows-driver-samples/keyboard-layout-samples/)：scan code → virtual key → layout character 的转换；
- [Zebra LS2208 Product Reference Guide](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/product/ls2208-prg-en.pdf)：USB HID Keyboard、Country Keyboard Types、unknown character 与 keypad emulation 的代表性实现说明。

## Decision

采用产品名无关、固定长度、仅大写 ASCII 字母数字的新动作码格式：

- 进入：`V2E<12 位 person_code>`；
- 离开：`V2X<12 位 person_code>`；
- 总长固定为 15；第 1–2 位 `V2` 是负载格式版本，第 3 位 `E` / `X` 分别表示 `entry` / `exit`，第 4–15 位是 `person_code`；
- 严格语法：`^V2[EX][0-9A-HJKMNP-TV-Z]{12}$`；
- `V2` 不代表产品、tenant 或授权命名空间。负载不包含产品缩写、PII、tenant/location id/code、内部人员 UUID、认证信息或可授权凭据；
- tenant/location 始终由已认证会话、当前工作地点与服务端授权确定，扫码负载不能选择或扩大授权范围；
- 只允许无提交后缀，或单个 `CR`、`LF`、`CRLF`/Enter 后缀。内部空白、额外字符、设备前缀、重复后缀、未知版本/动作、错误大小写、截断和旧新格式拼接统一返回 `ACTION_CODE_INVALID`；
- 不接受裸 `person_code`，不根据历史状态或扫码次数推断动作，也不接受客户端 `action` 覆盖；
- 解析后的幂等、10 秒去重、相反动作冲突、历史、邮件快照与 mail retry 继续只使用规范 `person_code + action` 语义。

上线前采用一次性直接替换：解析器、API 契约、四张 QR/Code 128 资产、文档、测试与合成 seed/smoke 输入必须在同一变更中从 `PD1|...` 切换到 `V2...`。不实现 `PD1`/`V2` 双读，不建立旧资产清单、重印/撤销流程或 T0/T1/T2 迁移阶段。切换完成后，`PD1|...` 直接视为未知旧版本并返回 `ACTION_CODE_INVALID`。

本决定只 supersede ADR-008 的动作码负载语法与资产编码；ADR-008 的双动作来源、授权、幂等、去重、冲突、历史和邮件语义继续有效。

兼容验证面向 USB HID/keyboard wedge 输入协议和代表性 Windows 布局，不要求指定扫码枪厂牌、型号或白名单。扫码枪国家键盘配置仍应与 Windows 活动布局匹配；应用不对错误布局造成的字符替换做模糊修复。

## Alternatives considered

1. **保留 `PD1|...`，只调整扫码枪配置**
   - 未选择。它继续依赖布局敏感的 `|`，把兼容成本转移给每台工作站配置。

2. **使用其他单字符分隔符**
   - 未选择。其他标点仍可能依赖 Shift、AltGr、Non-US 键位或国家键盘表。

3. **使用产品缩写作为新版前缀**
   - 未选择。产品名称尚未决定，品牌变更不应触发解析器、API 与图片资产迁移。

4. **对 `PD1` 与 `V2` 实施有期限双读和旧资产迁移**
   - 未选择。项目尚未上线、业务数据未导入，没有需要保护的生产旧数据或已发放资产；双读只会增加解析、测试、监控和移除成本。

5. **只扫描裸 `person_code`，由页面或状态推断动作**
   - 未选择。它会破坏 ADR-008 的明确动作来源，并在漏扫、并发或跨设备时产生歧义。

## Consequences

正面影响：

- 新负载不依赖标点键，降低常见 HID 国家键盘与 Windows 布局差异造成的输入失败；
- 格式不绑定产品名或租户，后续品牌调整不需要修改扫码协议；
- 上线前直接替换避免双读、旧资产迁移、长期兼容分支和四个独立迁移 Issue；
- 保留严格版本、动作与人员码边界，不削弱授权、幂等或审计语义。

负面影响：

- 现有开发/合成环境中的 `PD1` 测试值和图片必须统一重新生成；
- 解析器与资产生成必须同步切换，否则会出现前后端短暂不匹配；
- 仅字母数字格式不能修复扫码枪国家键盘与 Windows 布局完全不匹配、错误前后缀或字符替换配置。

## Migration impact

- 不修改数据库 schema、`person_code`、人员主键、scan event 或 mail job 数据结构；
- 不执行业务数据回填或历史事件改写；上线前开发/合成数据可重建，图片资产可确定性重新生成；
- 不保留 `PD1` 解析分支，不设置兼容开关，不实施双读；
- 发布前必须验证解析器、API、Frontend 四资产、seed、smoke 与文档全部使用同一新格式；若验证失败，在业务数据导入和正式发放资产前整体回滚该应用变更。

## Security impact

- 动作码仍是公开定位负载而非凭据；复制或构造动作码不能绕过登录、角色、location assignment 或 subscription gate；
- 服务端必须以 JWT tenant、当前 location 与规范 `person_code` 查询人员，禁止只按人员码跨租户查找；
- 畸形、旧版与未授权输入不得泄露人员是否存在，也不得创建成功事件或 mail job；
- 日志、测试证据与监控不得记录真实完整负载、PII 或 UUID 对应关系。

## Operational impact

- 不建立扫码枪型号白名单；验证使用 QR/Code 128 软件往返、代表性 Windows 键盘布局、浏览器文本输入、大小写及 Enter/CR/LF 后缀矩阵；
- 实体设备抽查只用于发布排障，不是厂牌/型号准入条件；
- 由于尚未上线，发布采用单一版本整体切换，不需要旧资产通知、迁移观察期或旧解析器移除作业；
- Production、真实业务数据导入和真实邮件 provider 不属于本 ADR 的执行范围。

## Follow-up

- #117 记录并接受本决策；运行时实现遵循本 ADR 的直接替换边界，不拆分双读、资产迁移、发布迁移和旧解析器移除任务；
- #118、#119、#120、#121 因不再需要双读或旧资产迁移而关闭为 `not planned`；
- 实现时同步更新 `docs/architecture.md`、`docs/api.md`、`docs/requirements.md`、`docs/user-guide.md`、`docs/admin-guide.md`、`docs/testing.md`、合成 seed/smoke 与 QR/Code 128 往返测试；
- 2026-08-06 人工批准记录：产品上线前直接以 `V2E<person_code>` / `V2X<person_code>` 完全替换 `PD1|...`，不考虑旧数据或旧资产兼容。
- 2026-08-06 本地实施记录：后端解析器、API 审计版本、Frontend 输入与四资产、API smoke、E2E、测试和现行文档已同步切换；未执行环境部署或业务数据导入。
