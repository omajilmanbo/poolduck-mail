# Issue Planning and Authoring

When splitting work into GitHub Issues, use the Markdown style of **Issue #60 — “容器化前端与后端，提供本地一键启动容器组”** as the canonical format.

## Issue body format

Write a content-rich, readable Markdown document. Do not use Issue Form-style micro-fields, repeated placeholder text, or generic boilerplate just to satisfy a template.

Use these headings in this order:

```markdown
## Background

<one or more short paragraphs explaining the situation, value, and why now>

## Scope

- <concrete work item>

## Out of scope

- <explicit non-goal>

## Acceptance criteria

- <observable completion condition>

## Test requirements

- <command, automated test, manual check, or regression proof>

## Recommended labels

- `type:feature` / `type:task` / `bug`
- `role:...`

## Risk labels

- `risk:...`

## Human decision required

Yes / No.

<If Yes, state exactly what needs human confirmation and what must not proceed before it.>
```

## Writing rules

- Keep each Issue independently implementable in roughly 1–8 hours. Split only when the implementation boundary is real.
- Give enough context that a developer can start without rereading the entire repository; do not remove Background, Scope, Out of scope, Acceptance criteria, or Test requirements merely to be brief.
- Put related context under the right heading rather than creating extra headings such as Estimate, Dependencies, Documentation updates, or generic Agent runtime instructions.
- State dependencies inline in Background or Scope only when they materially control order.
- Include human preparation, secrets, accounts, cloud access, or external-service constraints only when the task truly needs them. Do not add empty “无” sections.
- For auth, billing, data, security, architecture, mail delivery, or irreversible changes, write a concrete Human decision required section when approval is genuinely unresolved.
- Use Issue comments to refine policy choices after creation; keep the original body readable and stable.
- Do not repeat repository-wide security rules in every Issue unless the task has a specific risk or acceptance criterion.
