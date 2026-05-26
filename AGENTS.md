# AGENTS.md

## Skills

Use these skill files when relevant:

- For splitting work into GitHub Issues, read `skills/planning.md`.
- For architecture changes, read `skills/architecture-decision.md`.
- For PR review, read `skills/code-review.md`.
- For test planning, read `skills/test-design.md`.
- For release preparation, read `skills/release-check.md`.



## Documentation policy

When changing behavior, update the corresponding docs:

- Product scope changes → docs/product.md
- Architecture changes → docs/architecture.md and docs/decisions/
- Database schema changes → docs/database.md
- API changes → docs/api.md
- Deployment changes → docs/deployment.md
- User-facing behavior changes → docs/user-guide.md or docs/admin-guide.md

Do not store secrets, customer data, or temporary chat logs in docs.
For important decisions, create an ADR and wait for human approval.
## ADR policy

All ADR files under `docs/decisions/` must be created from `docs/decisions/ADR-TEMPLATE.md`.
Do not create or update ADRs with a custom format.
If an ADR does not match the template, update it before implementation.


## Working rules
- 随时更新README.md以及/docs下的文档。
- 每次只实现当前 Issue 的 Scope。
- 不允许实现 Out of scope 中的内容。
- 不允许提交真实密钥、token、Gmail 凭据、OAuth refresh token。
- 邮件发送功能在 MVP 阶段必须优先使用 sandbox/mock provider。
- 涉及 tenantId、权限、邮件目标地址的代码必须补充异常测试。
- PR 必须说明测试命令和测试结果。
- 如果需求不明确，先提出问题，不要自行决定业务规则。

## Review guidelines
- 检查是否对文档更新有所遗漏，导致旧文本存留。
- 检查是否存在跨租户访问风险。
- 检查是否可能误发邮件。
- 检查是否记录了 PII 或邮箱敏感信息。
- 检查是否扩大了 Issue 范围。
