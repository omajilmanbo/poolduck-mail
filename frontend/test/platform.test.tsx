import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlatformLoginPage from '../app/platform/login/page';
import { createPlatformApiClient } from '../src/api/client';

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
