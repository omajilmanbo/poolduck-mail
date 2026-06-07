# Release specifications

## 1. Version number rules

Using SemVer: `MAJOR.MINOR.PATCH`
- MAJOR: incompatible changes
- MINOR: new backwards compatible features
- PATCH: backward compatibility issue fixed

## 2. Pre-release inspection

- Associated Issue/PR complete
- All CI passes required
- Test regression completed (see `docs/testing.md`)
- Document update completed
- High-risk changes are reviewed and confirmed by someone

## 3. Publishing steps (recommended)

1. Create release tag from master branch
2. Execute the deployment pipeline
3. Execute smoke test
4. Observation monitoring and logs

## 4. Rollback steps

1. Confirm the scope of impact of the fault
2. Roll back the application version to the previous stable tag
3. If migration is involved, perform rollback/repair according to plan
4. Retest the core path (login, subscription verification, code scanning, sending emails)
5. Record accident review and improvement items
