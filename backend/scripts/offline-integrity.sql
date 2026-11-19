WITH lifecycle AS (
  SELECT status, deleted_at, purge_after, deleted_from_status FROM public.person_mappings
  UNION ALL
  SELECT status, deleted_at, purge_after, deleted_from_status FROM public.locations
),
invalid_lifecycle AS (
  SELECT 1 FROM lifecycle
  WHERE (CASE
    WHEN status IN ('active', 'inactive')
      THEN deleted_at IS NULL AND purge_after IS NULL AND deleted_from_status IS NULL
    WHEN status = 'pending_delete' THEN deleted_from_status IN ('active', 'inactive')
      AND isfinite(deleted_at) AND purge_after = deleted_at + interval '14 days'
    -- Parent cleanup can purge a child that never had its own deletion clock.
    WHEN status = 'purged' THEN deleted_from_status IS NULL AND (
      (deleted_at IS NULL AND purge_after IS NULL)
      OR (isfinite(deleted_at) AND purge_after = deleted_at + interval '14 days'))
    ELSE false
  END) IS NOT TRUE
),
invalid_scans AS (
  SELECT 1 FROM public.scan_events s
  LEFT JOIN public.tenants t ON t.id = s.tenant_id
  LEFT JOIN public.locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
  LEFT JOIN public.person_mappings p ON p.id = s.person_mapping_id
    AND p.tenant_id = s.tenant_id AND p.location_id = s.location_id
  LEFT JOIN public.devices d ON d.id = s.device_id AND d.tenant_id = s.tenant_id
  LEFT JOIN public.users creator ON creator.id = s.created_by_user_id AND creator.tenant_id = s.tenant_id
  LEFT JOIN public.users canceler ON canceler.id = s.canceled_by_user_id AND canceler.tenant_id = s.tenant_id
  WHERE t.id IS NULL OR l.id IS NULL OR p.id IS NULL OR s.scan_type = 'unmapped'
     OR (s.device_id IS NOT NULL AND d.id IS NULL)
     OR (s.created_by_user_id IS NOT NULL AND creator.id IS NULL)
     OR (s.canceled_by_user_id IS NOT NULL AND canceler.id IS NULL)
     -- Before action_source existed, the successful scan path wrote 'entry'
     -- and its initial mail job together. Backfill preserves that scan_type.
     OR ((s.action_source = 'person_action_code' OR s.scan_type IN ('entry', 'exit')) AND
         (SELECT count(*) FROM public.mail_jobs j WHERE j.scan_event_id = s.id) <> 1)
),
invalid_jobs AS (
  SELECT 1 FROM public.mail_jobs j
  LEFT JOIN public.tenants t ON t.id = j.tenant_id
  LEFT JOIN public.scan_events s ON s.id = j.scan_event_id AND s.tenant_id = j.tenant_id
    AND s.location_id = j.location_id AND s.person_mapping_id = j.person_mapping_id
  LEFT JOIN public.locations l ON l.id = j.location_id AND l.tenant_id = j.tenant_id
  LEFT JOIN public.person_mappings p ON p.id = j.person_mapping_id
    AND p.tenant_id = j.tenant_id AND p.location_id = j.location_id
  WHERE t.id IS NULL OR s.id IS NULL OR l.id IS NULL OR p.id IS NULL
),
invalid_attempts AS (
  SELECT 1 FROM public.mail_delivery_attempts a
  LEFT JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.mail_jobs j ON j.id = a.mail_job_id AND j.tenant_id = a.tenant_id
  WHERE t.id IS NULL OR j.id IS NULL
),
invalid_replays AS (
  SELECT 1 FROM public.scan_request_idempotency i
  LEFT JOIN public.tenants t ON t.id = i.tenant_id
  LEFT JOIN public.scan_events s ON s.id = i.scan_event_id AND s.tenant_id = i.tenant_id
  LEFT JOIN public.mail_jobs j ON j.id = i.mail_job_id AND j.tenant_id = i.tenant_id
    AND j.scan_event_id = i.scan_event_id
  WHERE t.id IS NULL OR s.id IS NULL OR j.id IS NULL
)
SELECT
  (SELECT count(*) FROM public.person_mappings p
    LEFT JOIN public.tenants t ON t.id = p.tenant_id
    LEFT JOIN public.locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id
    WHERE t.id IS NULL OR l.id IS NULL) AS person_location_tenant,
  (SELECT count(*) FROM (
    SELECT person_code FROM public.person_mappings GROUP BY person_code
    HAVING count(*) > 1 OR person_code IS NULL
  ) invalid_codes) AS person_code_groups,
  (SELECT count(*) FROM invalid_lifecycle) AS lifecycle_rows,
  (SELECT count(*) FROM invalid_scans) + (SELECT count(*) FROM invalid_jobs)
    + (SELECT count(*) FROM invalid_attempts) + (SELECT count(*) FROM invalid_replays) AS history_rows
