import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePage, { canManagePeople } from '../app/people/page';
import { canManageLocations } from '../app/locations/page';

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
      if (url.endsWith('/people')) return json([{ person_id: personId, person_code: personId, person_name: 'Person', scan_code: personId, email_masked: 'p***n@example.local', is_active: true }]);
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
      if (url.endsWith('/people')) return json([{ person_id: personId, person_code: personId, person_name: 'Person', scan_code: personId, email_masked: 'p***n@example.local', is_active: true }]);
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
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
