# R&D process (GitHub Flow)

## 1. Standard link

1. Create/claim a GitHub Issue
2. Pull and create a branch from the master branch
3. Development and self-testing
4. Submit a PR (using a template)
5. Trigger CI checks
6. Code Review
7. Merge into master branch

## 2. Branch naming suggestions

- `feature/*`: function development
- `fix/*`: bug fixes
- `setup/*`: initialization and specification construction
- `docs/*`: pure documentation update

## 3. Issue requirements

- Clarify the background, scope and acceptance criteria
- "Human prerequisites" is required, and clearly indicate the accounts, permissions, environment, port, domain name, database, Secrets, and external services; if not, you must write "None"
- "Agent permissions and execution environment (Agent permissions / runtime)" is required, and clearly indicate the requirements for repository write permissions, network, Docker, GitHub Actions, cloud platform, etc.
- "Blocking conditions/stop rules (Blocking conditions)" are required. When permissions, environment, Secrets, cloud resources or manual confirmation are missing, the Agent must stop and report
- Label the role (such as `role:backend`)
- Mark risk tags (such as `risk:auth`)
- Involving high risks (auth/billing/data/security) requires manual approval

## 4. PR requirements

- Associated Issue (`Closes #id` or `Refs #id`)
- Fill in the change content, testing, risks, and document updates
- Mixing in unrelated refactorings is not allowed
- Business behavior changes must be updated simultaneously with docs
- When infrastructure, environment variables, Secrets, and external services change, the corresponding ledger documents under `docs/inventory/` must be updated simultaneously.

## 5. CI recommended check items

- lint
- unit test
- integration test (on demand)
- migration check (if there are database changes)

## 6. Merge strategy

- Default squash merge
- Passed by at least 1 reviewer
- Merger can only be done after passing all required checks

## 7. CI access control (required)

- All PRs will automatically trigger GitHub Actions CI (`.github/workflows/ci.yml`).
- Push on the `main` branch will also trigger the same set of CI.
- The following checks must be passed before merging:
  - Backend: `npm ci && npm run build && npm test` (in `backend/`)
  - Frontend: `npm ci && npm test && npm run build` (in `frontend/`)
- It is recommended to execute the above equivalent commands before submitting locally to avoid PR red lights.
