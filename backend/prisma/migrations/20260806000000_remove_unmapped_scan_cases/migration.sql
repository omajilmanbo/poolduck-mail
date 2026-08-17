-- ADR-018 is a pre-launch direct replacement. The project has no business data,
-- so the obsolete case workflow and its synthetic/development history are removed.
DROP TABLE "unmapped_scan_cases";

DELETE FROM "scan_events"
WHERE "scan_type" = 'unmapped';
