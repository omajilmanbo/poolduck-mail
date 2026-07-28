import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsersPage, {
  canManageUsers,
  isValidOperatorPassword,
  isValidOperatorUsername,
} from '../app/users/page';

const operatorId = '44444444-4444-4444-8444-444444444444';

describe('users page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes the page only to tenant_manager', () => {
    expect(canManageUsers('tenant_manager')).toBe(true);
    expect(canManageUsers('operator')).toBe(false);
    expect(isValidOperatorPassword('abc12345')).toBe(true);
    expect(isValidOperatorPassword('abcdefgh')).toBe(false);
    expect(isValidOperatorPassword('12345678')).toBe(false);
    expect(isValidOperatorPassword('abc1234')).toBe(false);
    expect(isValidOperatorUsername('local-operator')).toBe(true);
    expect(isValidOperatorUsername('operator')).toBe(false);
    expect(isValidOperatorUsername('ｏperator')).toBe(false);
  });

  it('renders operator fields without exposing password material', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    }));

    render(<UsersPage />);

    expect(await screen.findByText('local-operator')).not.toBeNull();
    expect(screen.getByText('未绑定')).not.toBeNull();
    expect(screen.getAllByText('operator').length).toBeGreaterThan(0);
    expect(screen.queryByText('secret-hash')).toBeNull();
    expect(screen.getByLabelText('新用户角色')).toHaveProperty('readOnly', true);
    expect(screen.getByText('Local Office')).not.toBeNull();
  });

  it('rejects an invalid password before sending a create request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    await screen.findByText('local-operator');
    fireEvent.change(screen.getByTestId('create-user-username'), {
      target: { value: 'new-operator' },
    });
    fireEvent.change(screen.getByTestId('create-user-email'), {
      target: { value: 'new-operator@example.local' },
    });
    fireEvent.change(screen.getByTestId('create-user-password'), {
      target: { value: 'abcdefgh' },
    });
    fireEvent.click(screen.getByTestId('create-user-submit'));

    expect((await screen.findByRole('alert')).textContent).toContain('至少 8 位');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('requires confirmation before disabling an operator', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: '停用' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('现有会话会立即失效'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('creates an operator with username and no email', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return json({ user: { role: 'tenant_manager' } });
        }
        if (url.endsWith('/api/users') && init?.method === 'POST') {
          return json(operator(), 201);
        }
        const response = workspaceRead(url, init);
        if (response) return response;
        throw new Error(`Unexpected URL: ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    await screen.findByText('local-operator');
    fireEvent.change(screen.getByTestId('create-user-username'), {
      target: { value: 'New.Operator' },
    });
    fireEvent.change(screen.getByTestId('create-user-password'), {
      target: { value: 'abc12345' },
    });
    fireEvent.click(screen.getByTestId('create-user-submit'));

    await screen.findByRole('status');
    const createCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      username: 'new.operator',
      email: null,
      role: 'operator',
    });
  });

  it('shows backend authorization errors safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'tenant_manager' } });
      if (url.endsWith('/api/locations')) return json(locations());
      if (url.endsWith('/api/users')) {
        return json({ code: 'ROLE_FORBIDDEN', message: '无权管理用户' }, 403);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    render(<UsersPage />);

    expect((await screen.findByRole('alert')).textContent).toContain('无权管理用户');
  });

  it('atomically adds multiple active location assignments', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/users/${operatorId}/location-assignments`) && init?.method === 'PUT') {
        return json({
          operator_id: operatorId,
          locations: [locations()[0], locations()[1]],
        });
      }
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: '配置地点' }));
    const dialog = screen.getByRole('dialog');
    const locationList = screen.getByTestId('assignable-location-list');
    expect(locationList.className).toContain('overflow-y-auto');
    expect(locationList.className).toContain('max-h-');
    expect(dialog.querySelector('section')?.className).toContain('100dvh');
    const school = screen.getByRole('checkbox', { name: /Local School/ });
    expect((screen.getByRole('checkbox', { name: /Local Office/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(school);
    fireEvent.click(screen.getByRole('button', { name: '保存地点权限' }));

    expect((await screen.findByRole('status')).textContent).toContain('地点权限已更新');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Local School')).not.toBeNull();
    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      location_ids: ['10CA1001', '10CA1002'],
    });
    expect(dialog).not.toBeNull();
  });

  it('requires impact confirmation before revoking an assignment', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: '配置地点' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Local Office/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存地点权限' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('请求会立即被拒绝'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('marks inactive locations and does not allow assigning them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    }));
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: '配置地点' }));

    expect(screen.getByText('Closed Office')).not.toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Closed Office/ })).toBeNull();
    expect(screen.getByText('已停用地点（不可新增分配）')).not.toBeNull();
  });

  it('keeps the current assignments when saving fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/users/${operatorId}/location-assignments`) && init?.method === 'PUT') {
        throw new TypeError('Failed to fetch');
      }
      const response = workspaceRead(url, init);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole('button', { name: '配置地点' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Local School/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存地点权限' }));

    expect((await screen.findByRole('alert')).textContent).toContain('无法连接后端 API');
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getAllByText('Local Office').length).toBeGreaterThan(0);
  });
});

function operator() {
  return {
    user_id: operatorId,
    username: 'local-operator',
    email: null,
    role: 'operator',
    status: 'active',
    last_login_at: null,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    passwordHash: 'secret-hash',
  };
}

function locations() {
  return [
    {
      location_id: '10CA1001',
      location_code: '10CA1001',
      location_name: 'Local Office',
      type: 'location',
      is_active: true,
    },
    {
      location_id: '10CA1002',
      location_code: '10CA1002',
      location_name: 'Local School',
      type: 'location',
      is_active: true,
    },
    {
      location_id: '10CA1003',
      location_code: '10CA1003',
      location_name: 'Closed Office',
      type: 'location',
      is_active: false,
    },
  ];
}

function workspaceRead(url: string, init?: RequestInit) {
  if (url.endsWith('/api/auth/me')) {
    return json({ user: { role: 'tenant_manager' } });
  }
  if (url.endsWith('/api/locations')) {
    return json(locations());
  }
  if (
    url.endsWith(`/api/users/${operatorId}/location-assignments`) &&
    (!init?.method || init.method === 'GET')
  ) {
    return json({
      operator_id: operatorId,
      locations: [locations()[0]],
    });
  }
  if (
    url.endsWith('/api/users') &&
    (!init?.method || init.method === 'GET')
  ) {
    return json([operator()]);
  }
  return undefined;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
