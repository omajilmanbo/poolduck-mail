import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage, {
  cancellationSecondsRemaining,
  historyItemToRecord,
  shouldPollHistory,
} from '../app/page';
import type { ScanHistoryItem } from '../src/api/client';

const locationId = '44444444-4444-4444-8444-444444444444';

describe('history workspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads persisted history after restoring a session', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [historyItem('sent')], next_cursor: null }));
    render(<HomePage />);

    expect(await screen.findByText('01K0ABC80001')).not.toBeNull();
    const historyTable = screen.getByRole('table', { name: '扫码记录' });
    expect(within(historyTable).getByRole('columnheader', { name: '人员名称' })).not.toBeNull();
    expect(within(historyTable).queryByRole('columnheader', { name: 'location' })).toBeNull();
    expect(within(historyTable).getByRole('cell', { name: 'History Person' })).not.toBeNull();
    expect(screen.getByTestId('scan-action').textContent).toContain('进入');
    expect(screen.queryByText(/2026-12-31/)).toBeNull();
    expect(screen.getByTestId('mail-status').textContent).toContain('已发送');
  });

  it('shows an empty history state', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [], next_cursor: null }));
    render(<HomePage />);
    expect(await screen.findByText('暂无扫码记录')).not.toBeNull();
  });

  it.each([
    ['exit', 'person_action_code', '离开'],
    ['unknown', 'legacy_unknown', '动作未知'],
  ] as const)('renders persisted %s history as %s', async (action, source, label) => {
    const item = historyItem('sent');
    item.action = action;
    item.action_source = source;
    if (item.mail_job) {
      item.mail_job.action = action;
    }
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [item], next_cursor: null }));
    render(<HomePage />);

    expect((await screen.findByTestId('scan-action')).textContent).toContain(label);
  });

  it('shows a safe network error when history loading fails', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch(new TypeError('Failed to fetch')));
    render(<HomePage />);
    expect(await screen.findByText(/无法连接后端 API/)).not.toBeNull();
  });

  it('clears an expired session when history returns 401', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ status: 401 }));
    render(<HomePage />);

    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeNull());
    expect(window.localStorage.getItem('poolduck.accessToken')).toBeNull();
  });

  it('polls only pending records and stops at final status or the attempt cap', () => {
    const queued = historyItemToRecord(historyItem('queued'));
    const processing = historyItemToRecord(historyItem('processing'));
    const sent = historyItemToRecord(historyItem('sent'));

    expect(shouldPollHistory([queued], 0)).toBe(true);
    expect(shouldPollHistory([processing], 9)).toBe(true);
    expect(shouldPollHistory([sent], 0)).toBe(false);
    expect(shouldPollHistory([queued], 10)).toBe(false);
  });

  it('uses a fallback when historical person name is unavailable', () => {
    const item = historyItem('sent');
    item.person_name = null;

    expect(historyItemToRecord(item).personName).toBe('-');
  });

  it('uses server offset for countdown and never extends a slept or skewed client deadline', () => {
    const clientNow = new Date('2026-07-20T02:02:04.000Z').getTime();
    const serverNow = new Date('2026-07-20T01:02:04.000Z').getTime();
    const offset = serverNow - clientNow;

    expect(
      cancellationSecondsRemaining(
        '2026-07-20T01:02:13.000Z',
        offset,
        clientNow,
      ),
    ).toBe(9);
    expect(
      cancellationSecondsRemaining(
        '2026-07-20T01:02:13.000Z',
        offset,
        clientNow + 10_000,
      ),
    ).toBe(0);
  });

  it('shows cancellation result unknown and refreshes instead of claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      createWorkspaceFetch(
        { items: [historyItem('waiting')], next_cursor: null },
        new TypeError('Failed to fetch'),
      ),
    );
    render(<HomePage />);

    const cancel = await screen.findByTestId('scan-cancel');
    fireEvent.click(cancel);

    expect(
      await screen.findByText('取消结果未知，正在刷新权威状态。'),
    ).not.toBeNull();
    expect(screen.getByTestId('mail-status').textContent).toContain('可取消等待中');
    expect(screen.queryByText('已取消')).toBeNull();
  });
});

function createWorkspaceFetch(
  history:
    | { items: ScanHistoryItem[]; next_cursor: null }
    | { status: 401 }
    | TypeError,
  cancelError?: TypeError,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/auth/me')) {
      return jsonResponse({ user: { user_id: 'user-1', tenant_code: '10CA000001', email: 'operator@example.local', role: 'operator' } });
    }
    if (url.endsWith('/api/auth/refresh')) {
      if (!(history instanceof TypeError) && 'status' in history) {
        return jsonResponse({ code: 'UNAUTHORIZED' }, 401);
      }
      return jsonResponse({ expires_in: 900, user: {} });
    }
    if (url.endsWith('/api/license/check')) {
      return jsonResponse({
        status: 'active',
        plan: 'mvp',
        end_at: '2026-12-31T00:00:00.000Z',
        expired_at: '2026-12-31T00:00:00.000Z',
        grace_period: null,
        can_send: true,
      });
    }
    if (url.endsWith('/api/locations')) {
      return jsonResponse([
        {
          location_id: locationId,
          location_code: 'OFFICE-A',
          location_name: 'Office A',
          type: 'office',
          is_active: true,
        },
      ]);
    }
    if (url.includes('/people')) {
      return jsonResponse([]);
    }
    if (url.includes('/api/scan-events?')) {
      if (history instanceof TypeError) {
        throw history;
      }
      if ('status' in history) {
        return jsonResponse({ code: 'UNAUTHORIZED', message: '登录已失效' }, history.status);
      }
      return jsonResponse(history);
    }
    if (url.includes('/api/scan-events/') && url.endsWith('/cancel')) {
      if (cancelError) throw cancelError;
      return jsonResponse({
        scan_event_id: '55555555-5555-4555-8555-555555555555',
        mail_job_id: '66666666-6666-4666-8666-666666666666',
        effective_status: 'canceled',
        mail_status: 'canceled',
        canceled_at: '2026-07-20T01:02:05.000Z',
        server_time: '2026-07-20T01:02:05.000Z',
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function historyItem(status: ScanHistoryItem['status']): ScanHistoryItem {
  return {
    scan_event_id: '55555555-5555-4555-8555-555555555555',
    location_id: locationId,
    location_name: 'Office A',
    person_code: '01K0ABC80001',
    person_name: 'History Person',
    scan_code: '01K0ABC80001',
    scan_type: 'entry',
    action: 'entry',
    action_source: 'person_action_code',
    received_at: '2026-07-20T01:02:03.000Z',
    status,
    effective_status: status === 'canceled' ? 'canceled' : 'active',
    mail_status: status,
    can_cancel: status === 'waiting',
    cancel_until: status === 'waiting' ? '2026-07-20T01:02:13.000Z' : null,
    server_time: '2026-07-20T01:02:04.000Z',
    canceled_at: status === 'canceled' ? '2026-07-20T01:02:05.000Z' : null,
    mail_job: {
      mail_job_id: '66666666-6666-4666-8666-666666666666',
      status,
      action: 'entry',
      sent_at: status === 'sent' ? '2026-07-20T01:03:03.000Z' : null,
      error_message: status === 'failed' ? '邮件发送失败' : null,
    },
  };
}
