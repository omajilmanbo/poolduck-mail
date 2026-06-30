import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiNetworkError,
  createApiClient,
  createScanEventBody,
  isSendAllowed,
  mailStatusLabel,
} from '../src/api/client';

describe('frontend API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates API client with default backend URL', () => {
    const client = createApiClient();

    expect(client.baseUrl).toBe('http://localhost:3001');
  });

  it('posts scan events without tenant_id or custom mail body fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          scan_event_id: 'scan-1',
          mail_job_id: 'mail-1',
          mail_subject: 'subject',
          status: 'queued',
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient({ baseUrl: 'http://api.local/' });
    await client.createScanEvent('token-1', 'location-1', 'SCAN-001');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/api/scan-events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(createScanEventBody('location-1', 'SCAN-001')),
      }),
    );

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      location_id: 'location-1',
      scan_code: 'SCAN-001',
    });
    expect(body).not.toHaveProperty('tenant_id');
    expect(body).not.toHaveProperty('custom_message');
    expect(body).not.toHaveProperty('custom_text');
    expect(body).not.toHaveProperty('mail_body');
  });

  it('turns login network failures into a clear API connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const client = createApiClient({ baseUrl: 'http://api.local/' });

    await expect(
      client.login({
        tenant_id: '11111111-1111-4111-8111-111111111111',
        email: 'manager@example.local',
        password: 'PoolduckLocal123!',
      }),
    ).rejects.toMatchObject({
      name: 'ApiNetworkError',
      status: 0,
      code: 'NETWORK_ERROR',
      message: expect.stringContaining('无法连接后端 API'),
    });

    await expect(
      client.login({
        tenant_id: '11111111-1111-4111-8111-111111111111',
        email: 'manager@example.local',
        password: 'PoolduckLocal123!',
      }),
    ).rejects.toBeInstanceOf(ApiNetworkError);
  });
});

describe('workspace helpers', () => {
  it('disables sending when subscription cannot send', () => {
    expect(
      isSendAllowed({
        status: 'expired',
        plan: 'mvp',
        end_at: '2026-01-01T00:00:00.000Z',
        expired_at: '2026-01-01T00:00:00.000Z',
        grace_period: null,
        can_send: false,
      }),
    ).toBe(false);
  });

  it('uses MVP status labels for mail jobs', () => {
    expect(mailStatusLabel('queued')).toBe('发送中');
    expect(mailStatusLabel('sent')).toBe('已发送');
    expect(mailStatusLabel('failed')).toBe('发送失败');
  });
});
