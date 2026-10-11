import { OciMailAppMetricsService, parseMailMetricsConfig, summarizeMailMetrics } from '../src/mail-jobs/oci-mail-app-metrics.service';

describe('OCI staging mail application metrics', () => {
  const before = { ...process.env };
  afterEach(() => { process.env = { ...before }; });

  it('is disabled by default and rejects activation outside staging or without identifiers', () => {
    expect(parseMailMetricsConfig({})).toBeNull();
    expect(() => parseMailMetricsConfig({ OCI_MAIL_APP_ALERTS_ENABLED: 'true', APP_ENV: 'local' })).toThrow('OCI_MAIL_APP_ALERTS_REQUIRES_STAGING');
    expect(() => parseMailMetricsConfig({ OCI_MAIL_APP_ALERTS_ENABLED: 'true', APP_ENV: 'staging' })).toThrow('OCI_MAIL_APP_ALERTS_CONFIG_INVALID');
  });

  it('counts safe OCI outcomes and resets consecutive failures after success', () => {
    const now = new Date();
    const rows = [
      { errorCode: 'OCI_QUOTA_REJECTED', status: 'retry_scheduled', completedAt: now },
      { errorCode: 'OCI_QUOTA_REJECTED', status: 'retry_scheduled', completedAt: now },
      { errorCode: null, status: 'sent', completedAt: now },
      { errorCode: 'OCI_AUTH_REJECTED', status: 'failed', completedAt: now },
      { errorCode: 'PROVIDER_OUTCOME_UNKNOWN', status: 'delivery_unknown', completedAt: now },
    ];
    expect(summarizeMailMetrics(rows, 5100)).toEqual({
      DeliveryUnknownNew: 1, AuthRejectedNew: 1, QuotaRejectedNew: 2,
      QuotaRejectedConsecutive: 2, ProviderFailureConsecutive: 2,
      DueBacklogOldestMs: 5100, CollectorHeartbeat: 1,
    });
  });

  it('publishes only fixed metric names and dimensions, with no recipient data', async () => {
    process.env = {
      ...before, OCI_MAIL_APP_ALERTS_ENABLED: 'true', APP_ENV: 'staging',
      OCI_MONITORING_REGION: 'ap-tokyo-1',
      OCI_MONITORING_COMPARTMENT_ID: 'ocid1.compartment.oc1..synthetic',
    };
    const query = jest.fn().mockResolvedValueOnce([{ errorCode: 'OCI_AUTH_REJECTED', status: 'failed', completedAt: new Date() }])
      .mockResolvedValueOnce([{ oldestDueMs: 0 }]);
    const post = jest.fn().mockResolvedValue({ postMetricDataResponseDetails: { failedMetricsCount: 0 } });
    const service = new OciMailAppMetricsService({ $queryRawUnsafe: query } as never);
    service.setPublisherForTest({ postMetricData: post });
    await service.publishSnapshot(new Date('2026-10-11T00:00:00.000Z'));
    const body = JSON.stringify(post.mock.calls[0][0]);
    expect(body).toContain('AuthRejectedNew');
    expect(body).not.toContain('recipient@example.com');
    expect(body).not.toContain('tenantId');
    expect(body).not.toContain('mailJobId');
    expect(post.mock.calls[0][0].postMetricDataDetails.metricData).toHaveLength(7);
    expect(query.mock.calls[0][0]).not.toContain('to_email');
  });

  it('fails closed on partial metric ingestion', async () => {
    process.env = {
      ...before, OCI_MAIL_APP_ALERTS_ENABLED: 'true', APP_ENV: 'staging',
      OCI_MONITORING_REGION: 'ap-tokyo-1',
      OCI_MONITORING_COMPARTMENT_ID: 'ocid1.compartment.oc1..synthetic',
    };
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ oldestDueMs: 0 }]);
    const service = new OciMailAppMetricsService({ $queryRawUnsafe: query } as never);
    service.setPublisherForTest({ postMetricData: jest.fn().mockResolvedValue({ postMetricDataResponseDetails: { failedMetricsCount: 1 } }) });
    await expect(service.publishSnapshot()).rejects.toThrow('OCI_MAIL_APP_METRIC_PARTIAL_FAILURE');
  });
});
