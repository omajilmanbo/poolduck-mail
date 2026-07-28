import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePage, { canManagePeople } from '../app/people/page';
import LocationsPage, { canManageLocations } from '../app/locations/page';
import { deletionDaysRemaining } from '../src/deletion';

const locationId = '44444444-4444-4444-8444-444444444444';
const personId = '01K0ABC70001';

describe('management pages', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps list email masked and reveals the full value only in the controlled edit form', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'operator' } });
      if (url.endsWith('/api/locations')) return json([{ location_id: locationId, location_code: 'A', location_name: 'Office A', type: 'office', is_active: true }]);
      if (url.endsWith(`/people/${personId}`)) return json({ person_id: personId, person_code: personId, location_id: locationId, person_name: 'Person', scan_code: personId, email: 'person@example.local', email_masked: 'p***n@example.local', is_active: true });
      if (url.includes('/people?include_deleted=true')) return json([{ person_id: personId, person_code: personId, person_name: 'Person', scan_code: personId, email_masked: 'p***n@example.local', is_active: true }]);
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PeoplePage />);
    expect(await screen.findByText('p***n@example.local')).not.toBeNull();
    expect(screen.getByRole('button', { name: '查看动作码' })).not.toBeNull();
    expect(screen.queryByLabelText('scan_code')).toBeNull();
    expect(screen.queryByDisplayValue('person@example.local')).toBeNull();
    fireEvent.click(screen.getByText('编辑'));
    expect(await screen.findByDisplayValue('person@example.local')).not.toBeNull();
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).type).toBe('email');
  });

  it('shows a stop-impact confirmation before soft-deactivation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'operator' } });
      if (url.endsWith('/api/locations')) return json([{ location_id: locationId, location_code: 'A', location_name: 'Office A', type: 'office', is_active: true }]);
      if (url.endsWith(`/people/${personId}`) && init?.method === 'DELETE') return json({ is_active: false });
      if (url.includes('/people?include_deleted=true')) return json([{ person_id: personId, person_code: personId, person_name: 'Person', scan_code: personId, email_masked: 'p***n@example.local', is_active: true }]);
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PeoplePage />);
    fireEvent.click(await screen.findByText('停用'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/people/${personId}`), expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('历史记录仍保留'));
  });

  it('allows only tenant_manager to render location management actions', () => {
    expect(canManageLocations('tenant_manager')).toBe(true);
    expect(canManageLocations('operator')).toBe(false);
    expect(canManagePeople('operator')).toBe(true);
    expect(canManagePeople('viewer')).toBe(false);
  });

  it('creates a location from its name only and reactivates inactive locations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'tenant_manager' } });
      if (url.endsWith('/api/locations') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ location_name: 'Tokyo' });
        return json({ location_id: 'A1B2C3D4', location_code: 'A1B2C3D4', location_name: 'Tokyo', type: 'location', is_active: true });
      }
      if (url.endsWith('/api/locations?include_deleted=true')) return json([{ location_id: 'A1B2C3D4', location_code: 'A1B2C3D4', location_name: 'Tokyo', type: 'location', is_active: false }]);
      if (url.endsWith('/api/locations/A1B2C3D4/reactivate')) return json({ is_active: true });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    render(<LocationsPage />);

    expect(await screen.findByText('A1B2C3D4')).not.toBeNull();
    expect(screen.queryByPlaceholderText('地点代码')).toBeNull();
    expect(screen.queryByText('office')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('地点名称'), { target: { value: 'Tokyo' } });
    fireEvent.click(screen.getByRole('button', { name: '新增地点' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/locations'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ location_name: 'Tokyo' }) }),
    ));
    fireEvent.click(screen.getByRole('button', { name: '重新启用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/locations/A1B2C3D4/reactivate'),
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('reactivates an inactive person from the people page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'operator' } });
      if (url.endsWith('/api/locations')) return json([{ location_id: locationId, location_code: 'A1B2C3D4', location_name: 'Tokyo', type: 'location', is_active: true }]);
      if (url.endsWith(`/people/${personId}/reactivate`) && init?.method === 'POST') return json({ is_active: true });
      if (url.includes('/people?include_deleted=true')) return json([{ person_id: personId, person_code: personId, person_name: 'Person', scan_code: personId, email_masked: 'p***n@example.local', is_active: false }]);
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    render(<PeoplePage />);
    fireEvent.click(await screen.findByRole('button', { name: '重新启用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/people/${personId}/reactivate`),
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('shows a person deletion countdown with restore immediately to its right', async () => {
    const purgeAfter = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'operator' } });
      if (url.endsWith('/api/locations')) return json([{ location_id: locationId, location_code: 'A1B2C3D4', location_name: 'Tokyo', type: 'location', is_active: true }]);
      if (url.endsWith(`/people/${personId}/restore`) && init?.method === 'POST') return json({ deletion_status: null });
      if (url.includes('/people?include_deleted=true')) {
        return json([{
          person_id: personId,
          person_code: personId,
          person_name: 'Person',
          scan_code: personId,
          email_masked: 'p***n@example.local',
          is_active: false,
          deletion_status: 'scheduled',
          purge_after: purgeAfter,
        }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PeoplePage />);

    const restore = await screen.findByRole('button', { name: '恢复' });
    expect(restore.previousElementSibling?.textContent).toContain('删除（剩余 14 天）');
    fireEvent.click(restore);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/people/${personId}/restore`),
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('uses ceiling day boundaries for the deletion countdown', () => {
    const now = Date.parse('2026-07-28T00:00:00.000Z');
    expect(deletionDaysRemaining('2026-08-11T00:00:00.000Z', now)).toBe(14);
    expect(deletionDaysRemaining('2026-07-28T00:00:00.001Z', now)).toBe(1);
    expect(deletionDaysRemaining('2026-07-28T00:00:00.000Z', now)).toBe(0);
  });

  it('shows a location deletion countdown and restores through the dedicated endpoint', async () => {
    const purgeAfter = new Date(Date.now() + 13 * 86_400_000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'tenant_manager' } });
      if (url.endsWith('/api/locations/A1B2C3D4/restore') && init?.method === 'POST') {
        return json({ deletion_status: null });
      }
      if (url.endsWith('/api/locations?include_deleted=true')) {
        return json([{
          location_id: 'A1B2C3D4',
          location_code: 'A1B2C3D4',
          location_name: 'Tokyo',
          type: 'location',
          is_active: false,
          deletion_status: 'scheduled',
          purge_after: purgeAfter,
        }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LocationsPage />);

    const restore = await screen.findByRole('button', { name: '恢复' });
    expect(restore.previousElementSibling?.textContent).toContain('删除（剩余 13 天）');
    fireEvent.click(restore);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/locations/A1B2C3D4/restore'),
      expect.objectContaining({ method: 'POST' }),
    ));
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
