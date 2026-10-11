import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as common from 'oci-common';
import * as monitoring from 'oci-monitoring';
import { PrismaService } from '../prisma.service';

const NAMESPACE = 'poolduck_staging_mail';
const PERIOD_MS = 60_000;
const WINDOW_MS = 120_000;
const METRIC_NAMES = [
  'DeliveryUnknownNew', 'AuthRejectedNew', 'QuotaRejectedNew',
  'QuotaRejectedConsecutive', 'ProviderFailureConsecutive',
  'DueBacklogOldestMs', 'CollectorHeartbeat',
] as const;
type MetricName = typeof METRIC_NAMES[number];
type AttemptRow = { errorCode: string | null; status: string; completedAt: Date };
type BacklogRow = { oldestDueMs: number | string | null };
export type MetricValues = Record<MetricName, number>;
export type MetricPublisher = Pick<monitoring.MonitoringClient, 'postMetricData'>;

function consecutive(rows: AttemptRow[], predicate: (row: AttemptRow) => boolean): number {
  let count = 0;
  for (const row of rows) {
    if (!predicate(row)) break;
    count += 1;
  }
  return count;
}

export function summarizeMailMetrics(rows: AttemptRow[], oldestDueMs: number): MetricValues {
  const quota = (row: AttemptRow) => row.errorCode === 'OCI_QUOTA_REJECTED';
  const failure = (row: AttemptRow) => row.errorCode !== null && row.errorCode !== 'PROVIDER_RATE_LIMITED';
  return {
    DeliveryUnknownNew: rows.filter((row) => row.status === 'delivery_unknown').length,
    AuthRejectedNew: rows.filter((row) => row.errorCode === 'OCI_AUTH_REJECTED').length,
    QuotaRejectedNew: rows.filter(quota).length,
    QuotaRejectedConsecutive: consecutive(rows, quota),
    ProviderFailureConsecutive: consecutive(rows, failure),
    DueBacklogOldestMs: Math.max(0, Math.round(oldestDueMs)),
    CollectorHeartbeat: 1,
  };
}

export function parseMailMetricsConfig(env: NodeJS.ProcessEnv): { region: string; compartmentId: string } | null {
  if (env.OCI_MAIL_APP_ALERTS_ENABLED !== 'true') return null;
  if (env.APP_ENV !== 'staging') throw new Error('OCI_MAIL_APP_ALERTS_REQUIRES_STAGING');
  const region = env.OCI_MONITORING_REGION;
  const compartmentId = env.OCI_MONITORING_COMPARTMENT_ID;
  if (!region || !/^[a-z]{2}-[a-z]+-\d+$/.test(region)
    || !compartmentId || !/^ocid1\.compartment\.[a-z0-9.-]+$/.test(compartmentId)) {
    throw new Error('OCI_MAIL_APP_ALERTS_CONFIG_INVALID');
  }
  return { region, compartmentId };
}

@Injectable()
export class OciMailAppMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OciMailAppMetricsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private client?: MetricPublisher;
  private readonly config = parseMailMetricsConfig(process.env);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.config) return;
    const authProvider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    const client = new monitoring.MonitoringClient(
      { authenticationDetailsProvider: authProvider },
      { retryConfiguration: common.NoRetryConfigurationDetails },
    );
    client.regionId = this.config.region;
    // The SDK defaults to telemetry.*, while PostMetricData requires telemetry-ingestion.*.
    client.endpoint = `https://telemetry-ingestion.${this.config.region}.oraclecloud.com`;
    this.client = client;
    await this.publishSnapshot();
    this.timer = setInterval(() => void this.publishSnapshot().catch((error: unknown) => {
      this.logger.error(`Mail metric publication failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    }), PERIOD_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Tests inject a fake publisher. Production never exposes this client through an API.
  setPublisherForTest(client: MetricPublisher) { this.client = client; }

  async publishSnapshot(now = new Date()): Promise<MetricValues> {
    if (!this.config || !this.client) throw new Error('OCI_MAIL_APP_METRICS_DISABLED');
    if (this.running) throw new Error('OCI_MAIL_APP_METRICS_ALREADY_RUNNING');
    this.running = true;
    try {
      const since = new Date(now.getTime() - WINDOW_MS);
      const rows = await this.prisma.$queryRawUnsafe<AttemptRow[]>(`
        SELECT "error_code" AS "errorCode", "status", "completed_at" AS "completedAt"
        FROM "mail_delivery_attempts"
        WHERE "rfc_message_id" IS NOT NULL AND "completed_at" >= $1 AND "completed_at" <= $2
        ORDER BY "completed_at" DESC, "id" DESC LIMIT 10000
      `, since, now);
      const [backlog] = await this.prisma.$queryRawUnsafe<BacklogRow[]>(`
        SELECT COALESCE(MAX(GREATEST(0, EXTRACT(EPOCH FROM (
          CURRENT_TIMESTAMP - CASE WHEN "status" = 'waiting' THEN "send_not_before"
          ELSE COALESCE("scheduled_at", "created_at") END
        )) * 1000)), 0)::double precision AS "oldestDueMs"
        FROM "mail_jobs"
        WHERE ("status" = 'waiting' AND "send_not_before" <= CURRENT_TIMESTAMP)
           OR ("status" = 'queued' AND "scheduled_at" <= CURRENT_TIMESTAMP)
           OR ("status" = 'queued' AND "scheduled_at" IS NULL AND "send_not_before" IS NULL)
      `);
      const values = summarizeMailMetrics(rows, Number(backlog?.oldestDueMs ?? 0));
      const response = await this.client.postMetricData({
        retryConfiguration: common.NoRetryConfigurationDetails,
        postMetricDataDetails: {
          batchAtomicity: monitoring.models.PostMetricDataDetails.BatchAtomicity.Atomic,
          metricData: METRIC_NAMES.map((name) => ({
            namespace: NAMESPACE,
            compartmentId: this.config!.compartmentId,
            name,
            dimensions: { environment: 'staging', application: 'poolduck-mail' },
            datapoints: [{ timestamp: now, value: values[name] }],
          })),
        },
      });
      if (response.postMetricDataResponseDetails.failedMetricsCount !== 0) {
        throw new Error('OCI_MAIL_APP_METRIC_PARTIAL_FAILURE');
      }
      this.logger.log('Mail application metrics published');
      return values;
    } finally {
      this.running = false;
    }
  }
}
