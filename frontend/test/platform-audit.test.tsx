import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlatformAuditPage from '../app/platform/audit/page';

const item = (n: number) => ({
  audit_id: `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  platform_admin_id: 'a1000000-0000-4000-8000-000000000001',
  target_tenant_id: null, target_tenant: null,
  action: 'platform.tenant.staging_deleted', resource_type: 'tenant',
  resource_id: 'a3000000-0000-4000-8000-000000000001', result: 'success',
  metadata: { reason: 'DELETED' }, created_at: '2026-10-22T00:00:00.000Z',
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

describe('platform audit page', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('filters, pages backward and forward, and shows only API safe fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ items: [item(1)], next_cursor: 'cursor-one' }))
      .mockResolvedValueOnce(json({ items: [item(2)], next_cursor: null }))
      .mockResolvedValueOnce(json({ items: [item(1)], next_cursor: 'cursor-one' }))
      .mockResolvedValueOnce(json({ items: [], next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformAuditPage />);
    await waitFor(() => expect(screen.getByText('platform.tenant.staging_deleted')).toBeTruthy());
    expect(screen.getByText('租户已清理')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.getByText('{"reason":"DELETED"}')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=cursor-one'));
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'platform.tenant.create' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(String(fetchMock.mock.calls[3][0])).toContain('action=platform.tenant.create'));
    expect(String(fetchMock.mock.calls[3][0])).not.toContain('cursor=');
    await waitFor(() => expect(screen.getByText(/没有符合条件的平台审计记录/)).toBeTruthy());
  });

  it('shows loading failure and expired platform session safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: '暂不可用' }, 503)));
    render(<PlatformAuditPage />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('暂不可用'));
  });
});
