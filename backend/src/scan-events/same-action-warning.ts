import { Prisma } from '@prisma/client';
import { SameActionWarning } from './scan-events.types';

// IDs come from the authorized history read or the scan just created by this transaction.
export async function findSameActionWarnings(
  tx: Prisma.TransactionClient,
  tenantId: string,
  eventIds: string[],
): Promise<Map<string, SameActionWarning>> {
  if (!eventIds.length) return new Map();

  const rows = await tx.$queryRaw<Array<{
    id: string;
    previous_id: string;
    previous_received_at: Date;
  }>>`
    WITH effective_actions AS NOT MATERIALIZED (
      SELECT e.id, e.tenant_id, e.location_id, e.person_mapping_id, e.received_at, e.action
      FROM scan_events e
      WHERE e.tenant_id = ${tenantId}::uuid
        AND e.location_id IS NOT NULL AND e.person_mapping_id IS NOT NULL
        AND e.action IN ('entry', 'exit') AND e.canceled_at IS NULL
        AND (SELECT j.status FROM mail_jobs j
             WHERE j.scan_event_id = e.id AND j.tenant_id = e.tenant_id
             ORDER BY j.created_at DESC, j.id DESC LIMIT 1) IS DISTINCT FROM 'canceled'
    )
    SELECT e.id, prev.id AS previous_id, prev.received_at AS previous_received_at
    FROM effective_actions e
    JOIN LATERAL (
      SELECT p.id, p.received_at, p.action FROM effective_actions p
      WHERE p.tenant_id = e.tenant_id AND p.location_id = e.location_id
        AND p.person_mapping_id = e.person_mapping_id
        AND (p.received_at, p.id) < (e.received_at, e.id)
      ORDER BY p.received_at DESC, p.id DESC LIMIT 1
    ) prev ON prev.action = e.action
    WHERE e.id IN (${Prisma.join(eventIds.map(id => Prisma.sql`${id}::uuid`))})
  `;
  return new Map(rows.map(row => [row.id, {
    previous_scan_event_id: row.previous_id,
    previous_received_at: row.previous_received_at.toISOString(),
  }]));
}
