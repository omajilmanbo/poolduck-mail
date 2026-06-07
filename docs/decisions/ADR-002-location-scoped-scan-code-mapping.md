# ADR-002: Isolate scan code number mapping by office/school context

- Status: Accepted
- Date: 2026-05-20
- Related Issue: #2

## Context

The latest business process requirements: Users must first switch offices/school buildings on the scan code email page, and then search for their mailbox based on the scan code number. The existing draft only has `scan_events` and `mail_jobs`, which lacks the office/school dimension and the "scan code number → personnel mailbox" mapping model, and cannot support "personnel list" and isolation of the same code in different places.

## Decision

- Added `locations` table to carry the office/school dimension within the tenant.
- Added `person_mappings` table, carrying the `scan_code -> person_name/email` relationship under the specified `location`.
- The constraint scan code query must use `(tenant_id, location_id, scan_code)` at the same time, and create a unique index for it. Global search by `scan_code` alone is prohibited.
- `users` is clearly "administrator account that can log in to the system", and the roles are split into:
  - `root_admin`: can edit subscriptions, add or delete locations.
  - `manager`: Only `person_mappings` can be edited.
- `subscriptions` maintains the "tenant-level" model, and the foreign key maintains `tenant_id` (one subscription configuration per tenant).
- The billing strategy in MVP adopts the method of "tenant basic package + location number for subsequent billing expansion": currently, location-level subscription splitting is not introduced to avoid early migration and permission complexity.
- When the number of locations is added in the subscription cycle, the expiry (co-term) is synchronized with the tenant subscription `end_at` and the difference is calculated based on the remaining period to avoid parallel expiration dates.

## Alternatives considered

- Use `offices` single name: clear semantics but cannot directly cover school scenarios.
- Use `schools` single name: also does not cover office scenes.
- Unified naming as `locations`: can cover offices/schools, retain the `type` distinction, and be compatible with subsequent expansions.
- Subscriptions are changed to location level: Pricing can be directly based on location, but it will increase the cost of subscription aggregation judgment, access control implementation and migration.
- Maintain tenant-level subscriptions and bill based on the number of locations: the implementation cost is lower and can meet the rapid implementation of MVP; if there is refined billing in the future, it can be upgraded through the new ADR.

## Consequences

- The data query link adds a location context, and both the front-end and back-end need to explicitly pass the current office/school.
- The same scan code can be reused in different locations without conflicting with each other.
- The management and import process will need to support the location dimension later.
- Subscription gating is still performed in the tenant dimension to avoid cross-location subscription consistency issues during the MVP stage.

## Migration impact

- This time it is only document design and migration will not be implemented.
- The strategy of backfilling location with historical data (if historical data exists) needs to be considered when implementing subsequent migrations.

## Security impact

- Reduce the risk of mischecking and mis-sending emails across tenants, offices/schools.
- It is necessary to double-check tenant and location in subsequent implementations to avoid unauthorized reading of mappings.

## Operational impact

- Operation and maintenance troubleshooting needs to add `tenant_id + location_id + scan_code` triple positioning.
- The test needs to cover the "same code but different location isolation" and unauthorized access denial scenarios.


## Follow-up

- In the subsequent implementation phase, this ADR requirement needs to be mapped to database migration, API contract and test cases.
- If the business rules change, the supersede relationship needs to be clarified through the new ADR.
