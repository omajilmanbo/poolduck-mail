-- Runs only in the test harness's new, empty database. No application constraints
-- are altered. Small integer keys make broken edges explicit in each test.
CREATE TABLE fixture_tenants (id int PRIMARY KEY);
-- The baseline can only pass if the CLI uses the promised transaction mode.
CREATE VIEW tenants AS SELECT id FROM fixture_tenants
  WHERE current_setting('transaction_read_only') = 'on'
    AND current_setting('transaction_isolation') = 'repeatable read';
CREATE TABLE locations (id int PRIMARY KEY, tenant_id int, status text,
  deleted_at timestamp, purge_after timestamp, deleted_from_status text);
CREATE TABLE person_mappings (id int PRIMARY KEY, tenant_id int, location_id int,
  person_code text, status text, deleted_at timestamp, purge_after timestamp, deleted_from_status text);
CREATE TABLE devices (id int PRIMARY KEY, tenant_id int);
CREATE TABLE users (id int PRIMARY KEY, tenant_id int);
CREATE TABLE scan_events (id int PRIMARY KEY, tenant_id int, location_id int, person_mapping_id int,
  scan_type text, action_source text, device_id int, created_by_user_id int, canceled_by_user_id int);
CREATE TABLE mail_jobs (id int PRIMARY KEY, tenant_id int, location_id int, person_mapping_id int, scan_event_id int);
CREATE TABLE mail_delivery_attempts (id int PRIMARY KEY, tenant_id int, mail_job_id int);
CREATE TABLE scan_request_idempotency (id int PRIMARY KEY, tenant_id int, scan_event_id int, mail_job_id int);

-- Reset fixture rows
TRUNCATE fixture_tenants, locations, person_mappings, devices, users, scan_events,
  mail_jobs, mail_delivery_attempts, scan_request_idempotency;
INSERT INTO fixture_tenants VALUES (1), (2);
INSERT INTO locations VALUES (10, 1, 'active', NULL, NULL, NULL),
  (11, 1, 'inactive', NULL, NULL, NULL), (20, 2, 'purged', NULL, NULL, NULL),
  (21, 2, 'pending_delete', '2000-01-01', '2000-01-15', 'inactive');
INSERT INTO person_mappings VALUES (100, 1, 10, 'fixture-a', 'active', NULL, NULL, NULL),
  (101, 1, 11, 'fixture-b', 'inactive', NULL, NULL, NULL),
  (200, 2, 20, 'fixture-c', 'purged', '2000-01-01', '2000-01-15', NULL),
  (201, 2, 20, 'fixture-d', 'purged', NULL, NULL, NULL),
  (202, 2, 21, 'fixture-e', 'pending_delete', '2090-01-01', '2090-01-15', 'active');
INSERT INTO devices VALUES (1, 1), (2, 2);
INSERT INTO users VALUES (1, 1), (2, 2);
INSERT INTO scan_events VALUES (1, 1, 10, 100, 'entry', 'person_action_code', 1, 1, 1),
  (2, 2, 20, 200, 'barcode', 'legacy_unknown', NULL, NULL, NULL),
  (3, 1, 10, 100, 'exit', 'person_action_code', NULL, NULL, NULL);
INSERT INTO mail_jobs VALUES (1, 1, 10, 100, 1), (2, 2, 20, 200, 2), (3, 1, 10, 100, 3);
INSERT INTO mail_delivery_attempts VALUES (1, 1, 1);
INSERT INTO scan_request_idempotency VALUES (1, 1, 1, 1);
