import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlatformLoginPage from '../app/platform/login/page';
import PlatformPage from '../app/platform/page';
import { createPlatformApiClient, type PlatformTenantSummary } from '../src/api/client';

describe('platform API client', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the independent platform login contract without tenant_code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          expires_in: 900,
          admin: {
            platform_admin_id: 'admin-1',
            email_masked: 'r***t@example.local',
            identity_version: 1,
            session_id: 'session-1',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createPlatformApiClient({ baseUrl: 'http://api.local/' }).login(
      'root@example.local',
      'secret',
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://api.local/api/platform/auth/login',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'root@example.local',
      password: 'secret',
    });
    expect(init.body).not.toContain('tenant_code');
  });

  it('refreshes only through the platform auth endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await createPlatformApiClient({ baseUrl: 'http://api.local' }).getTenants();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.local/api/platform/tenants',
      'http://api.local/api/platform/auth/refresh',
      'http://api.local/api/platform/tenants',
    ]);
  });
});

describe('platform login UI', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows an independent email/password login and no MFA or tenant field', () => {
    render(<PlatformLoginPage />);
    expect(screen.getByRole('heading', { name: '平台管理员登录' })).toBeTruthy();
    expect(screen.getByLabelText('平台邮箱')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.queryByText(/tenant_code/i)).toBeNull();
    expect(screen.queryByText(/MFA|TOTP/i)).toBeNull();
  });

  it('does not retain the password after a failed login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(<PlatformLoginPage />);
    fireEvent.change(screen.getByLabelText('平台邮箱'), {
      target: { value: 'root@example.local' },
    });
    const password = screen.getByLabelText('密码') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByTestId('platform-login-submit'));
    await waitFor(() => expect(password.value).toBe(''));
    expect(screen.getByText(/API/)).toBeTruthy();
  });
});

describe('platform mail mode', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ['mock', '模拟发信（mock）'],
    ['oci_email_delivery_https', '真实发信（OCI）'],
    ['invalid', '状态未知'],
  ])('shows %s only in the platform console', async (mode, label) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const payload = url.endsWith('/api/platform/auth/me')
        ? { admin: { platform_admin_id: 'admin-1', email_masked: 'r***t@example.local' } }
        : url.endsWith('/api/platform/tenants')
          ? []
          : { mode };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByTestId('platform-mail-mode').textContent).toBe(label));
  });

});

const deletionSubscription = {
  plan: 'manual', status: 'trial', start_at: '2026-01-01T00:00:00.000Z',
  end_at: '2027-01-01T00:00:00.000Z', version: 1,
} satisfies NonNullable<PlatformTenantSummary['subscription']>;

const deletionTenant: PlatformTenantSummary = {
  tenant_code: '10PDTEST01', name: 'Synthetic Tenant', status: 'active',
  created_at: '2026-01-01T00:00:00.000Z', platform_version: 1,
  location_limit: 1, location_count: 0,
  subscription: deletionSubscription,
  manager: { email_masked: 'm***r@example.local', status: 'active' },
  recent_platform_operation: null,
};

function mockPlatformDeletion(environment: 'production' | 'staging',
  tenant: PlatformTenantSummary = deletionTenant, deleteResponse?: (password: string) => Promise<Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (url.endsWith('/api/platform/auth/me')) return json({ admin: { platform_admin_id: 'admin-1', email_masked: 'a***n@example.local' } });
    if (url.endsWith('/api/platform/auth/environment')) return json({ environment, deletion_enabled: true });
    if (url.endsWith('/api/platform/auth/mail-mode')) return json({ mode: 'mock' });
    if (url.endsWith('/api/platform/tenants')) return json([tenant]);
    if (url.endsWith('/delete') && init?.method === 'POST') {
      return deleteResponse
        ? deleteResponse((JSON.parse(init.body as string) as { password: string }).password)
        : json({ tenant_code: tenant.tenant_code, status: 'pending_delete',
          deleted_at: '2026-10-20T00:00:00.000Z', purge_after: '2027-10-20T00:00:00.000Z' });
    }
    return json({});
  });
}

describe('platform tenant deletion UI', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Production target and password confirmation without persisting it', async () => {
    const fetchMock = mockPlatformDeletion('production');
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除租户' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除租户' }));
    expect(screen.getByRole('dialog').textContent).toContain('Synthetic Tenant');
    expect(screen.getByRole('dialog').textContent).toContain('10PDTEST01');
    expect(screen.getByRole('dialog').textContent).toContain('Production');
    expect(screen.getByRole('dialog').textContent).toContain('恢复后超期记录立即重新进入清理队列');
    const password = screen.getByLabelText('删除确认密码') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(password.value).toBe(''));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/delete'))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/delete'));
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ password: 'synthetic-secret' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('keeps a wrong-password result unsucceeded and clears the field', async () => {
    vi.stubGlobal('fetch', mockPlatformDeletion('production', deletionTenant, async () =>
      new Response(JSON.stringify({ code: 'PLATFORM_DELETE_PASSWORD_INVALID', message: 'Wrong password' }),
        { status: 403, headers: { 'content-type': 'application/json' } })));
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除租户' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除租户' }));
    const password = screen.getByLabelText('删除确认密码') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(password.value).toBe(''));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('管理员密码错误，未执行删除。'));
    expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('管理员密码错误，未执行删除。')).toBeNull();
    expect(screen.queryByText(/已进入删除期/)).toBeNull();
  });

  it('shows Staging as irreversible and never offers restore', async () => {
    vi.stubGlobal('fetch', mockPlatformDeletion('staging', {
      ...deletionTenant, status: 'staging_deleting', subscription: { ...deletionSubscription, status: 'suspended' },
    }));
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '重试清理' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '恢复租户' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试清理' }));
    expect(screen.getByRole('dialog').textContent).toContain('无法恢复');
  });

  it.each([
    { action: 'platform.tenant.staging_delete_started', result: 'success',
      created_at: new Date().toISOString(), label: '删除中', retry: false },
    { action: 'platform.tenant.staging_delete', result: 'failure',
      created_at: new Date().toISOString(), label: '删除失败', retry: true },
    { action: 'platform.tenant.staging_delete_started', result: 'success',
      created_at: '2020-01-01T00:00:00.000Z', label: '删除结果未确认', retry: true },
  ])('distinguishes staging cleanup: $label', async (operation) => {
    vi.stubGlobal('fetch', mockPlatformDeletion('staging', {
      ...deletionTenant, status: 'staging_deleting',
      subscription: { ...deletionSubscription, status: 'suspended' },
      recent_platform_operation: { audit_id: 'synthetic-audit', ...operation },
    }));
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByText(new RegExp(operation.label))).toBeTruthy());
    expect(Boolean(screen.queryByRole('button', { name: '重试清理' }))).toBe(operation.retry);
    expect(screen.getByRole('button', { name: '刷新删除状态' })).toBeTruthy();
  });

  it('sends one deletion request when confirm is clicked twice', async () => {
    let finish: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = mockPlatformDeletion('production', deletionTenant, () => pendingResponse);
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除租户' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除租户' }));
    fireEvent.change(screen.getByLabelText('删除确认密码'), { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/delete'))).toHaveLength(1);
    finish?.(new Response(JSON.stringify({ tenant_code: deletionTenant.tenant_code,
      status: 'pending_delete', purge_after: '2027-10-20T00:00:00.000Z' }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers Production restoration before the deadline', async () => {
    const pendingTenant = { ...deletionTenant, status: 'pending_delete',
      purge_after: '2099-01-01T00:00:00.000Z',
      subscription: { ...deletionSubscription, status: 'suspended' } };
    const base = mockPlatformDeletion('production', pendingTenant);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/restore')) return new Response(JSON.stringify(deletionTenant), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
      return base(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复租户' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '恢复租户' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/restore'))).toBe(true));
    await waitFor(() => expect(screen.getByText(/已恢复；订阅仍按原有效期判断/)).toBeTruthy());
  });

  it('hides expired Production restore and handles network uncertainty', async () => {
    const expiredTenant = { ...deletionTenant, status: 'pending_delete',
      purge_after: '2020-01-01T00:00:00.000Z',
      subscription: { ...deletionSubscription, status: 'suspended' } };
    vi.stubGlobal('fetch', mockPlatformDeletion('production', expiredTenant));
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByText(/期限已到，不可恢复/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '恢复租户' })).toBeNull();
    cleanup();
    const fetchMock = mockPlatformDeletion('staging', deletionTenant, async () => { throw new TypeError('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除租户' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除租户' }));
    const password = screen.getByLabelText('删除确认密码') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('请求结果未知'));
    expect(password.value).toBe('');
    expect(screen.queryByText(/在线数据已删除/)).toBeNull();
  });
});
