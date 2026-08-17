'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LocationItem,
  ManagedOperator,
  createApiClient,
} from '../../src/api/client';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'tenant_manager',
  'operator',
  'platform_admin',
  'poolduck',
]);

export function canManageUsers(role: string) {
  return role === 'tenant_manager';
}

export function isValidOperatorPassword(password: string) {
  return PASSWORD_PATTERN.test(password);
}

export function isValidOperatorUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  return (
    USERNAME_PATTERN.test(normalized) &&
    !RESERVED_USERNAMES.has(normalized)
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '尚未登录';
}

export default function UsersPage() {
  const api = useMemo(() => createApiClient(), []);
  const [rows, setRows] = useState<ManagedOperator[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [assignments, setAssignments] = useState<Record<string, LocationItem[]>>({});
  const [authorized, setAuthorized] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingUsername, setEditingUsername] = useState('');
  const [editingEmail, setEditingEmail] = useState('');
  const [resettingId, setResettingId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [assignmentEditingId, setAssignmentEditingId] = useState('');
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [operators, tenantLocations] = await Promise.all([
      api.getUsers(),
      api.getLocations('cookie-session'),
    ]);
    const assignmentResponses = await Promise.all(
      operators.map((operator) =>
        api.getUserLocationAssignments(operator.user_id),
      ),
    );
    setRows(operators);
    setLocations(tenantLocations);
    setAssignments(
      Object.fromEntries(
        assignmentResponses.map((response) => [
          response.operator_id,
          response.locations,
        ]),
      ),
    );
  }, [api]);

  const showError = useCallback((cause: unknown) => {
    setNotice('');
    setError(cause instanceof Error ? cause.message : '请求失败');
  }, []);

  useEffect(() => {
    api.getMe()
      .then(({ user }) => {
        if (!canManageUsers(user.role)) {
          window.location.href = '/';
          return;
        }
        setAuthorized(true);
        void reload().catch(showError);
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, [api, reload, showError]);

  async function createOperator(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!isValidOperatorPassword(password)) {
      setError('密码至少 8 位，并且必须同时包含英文字母和数字');
      return;
    }
    if (!isValidOperatorUsername(username)) {
      setError('用户名必须为 3–32 位小写字母、数字、点、下划线或连字符，且不能使用保留字');
      return;
    }

    setBusy(true);
    try {
      await api.createUser({
        username: username.trim().toLowerCase(),
        email: email.trim() ? email.trim().toLowerCase() : null,
        password,
        role: 'operator',
      });
      setUsername('');
      setEmail('');
      setPassword('');
      setNotice('operator 已创建');
      await reload();
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function saveIdentity(userId: string) {
    setError('');
    setNotice('');
    if (!isValidOperatorUsername(editingUsername)) {
      setError('用户名必须为 3–32 位小写字母、数字、点、下划线或连字符，且不能使用保留字');
      return;
    }
    setBusy(true);
    try {
      await api.updateUser(userId, {
        username: editingUsername.trim().toLowerCase(),
        email: editingEmail.trim() ? editingEmail.trim().toLowerCase() : null,
        role: 'operator',
      });
      setEditingId('');
      setEditingUsername('');
      setEditingEmail('');
      setNotice('登录身份已更新，旧会话已撤销');
      await reload();
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(row: ManagedOperator) {
    const nextStatus = row.status === 'active' ? 'inactive' : 'active';
    if (
      nextStatus === 'inactive' &&
      !window.confirm('停用后该 operator 的现有会话会立即失效。确认停用？')
    ) {
      return;
    }

    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.updateUser(row.user_id, { status: nextStatus, role: 'operator' });
      setNotice(nextStatus === 'inactive' ? 'operator 已停用' : 'operator 已启用');
      await reload();
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset(event: FormEvent, userId: string) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!isValidOperatorPassword(resetPassword)) {
      setError('密码至少 8 位，并且必须同时包含英文字母和数字');
      return;
    }
    if (!window.confirm('重置密码后该 operator 的现有会话会立即失效。确认重置？')) {
      return;
    }

    setBusy(true);
    try {
      await api.resetUserPassword(userId, resetPassword);
      setResetPassword('');
      setResettingId('');
      setNotice('密码已重置，请通过安全渠道交付新密码');
      await reload();
    } catch (cause) {
      showError(cause);
    } finally {
      setResetPassword('');
      setBusy(false);
    }
  }

  function openAssignmentEditor(row: ManagedOperator) {
    const currentAssignments = assignments[row.user_id] ?? [];
    setAssignmentEditingId(row.user_id);
    setSelectedLocationIds(
      currentAssignments
        .filter((location) => location.is_active)
        .map((location) => location.location_id),
    );
    setError('');
    setNotice('');
  }

  function toggleLocation(locationId: string) {
    setSelectedLocationIds((current) =>
      current.includes(locationId)
        ? current.filter((id) => id !== locationId)
        : [...current, locationId],
    );
  }

  async function saveLocationAssignments(row: ManagedOperator) {
    const currentAssignments = assignments[row.user_id] ?? [];
    const removedAssignments = currentAssignments.filter(
      (location) => !selectedLocationIds.includes(location.location_id),
    );
    if (
      removedAssignments.length > 0 &&
      !window.confirm(
        `撤销 ${removedAssignments.map((location) => location.location_name).join('、')} 后，` +
          `${row.username} 对这些地点的新扫码、人员写入和历史请求会立即被拒绝。确认保存？`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.setUserLocationAssignments(
        row.user_id,
        selectedLocationIds,
      );
      setAssignments((current) => ({
        ...current,
        [row.user_id]: response.locations,
      }));
      setAssignmentEditingId('');
      setSelectedLocationIds([]);
      setNotice(
        removedAssignments.length > 0
          ? '地点权限已更新；被撤销地点的后续请求会立即被拒绝'
          : '地点权限已更新',
      );
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!authorized) {
    return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;
  }

  return (
    <main className="min-h-screen bg-stone-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">用户管理</h1>
            <p className="mt-1 text-sm text-slate-500">仅管理当前租户的 operator 账号</p>
          </div>
          <a href="/" className="text-sm text-emerald-700">返回工作台</a>
        </header>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        <form onSubmit={createOperator} className="grid gap-3 rounded-md border bg-white p-4 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
          <label className="text-sm font-medium">
            用户名
            <input
              data-testid="create-user-username"
              type="text"
              required
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2 font-normal"
              autoComplete="off"
            />
          </label>
          <label className="text-sm font-medium">
            邮箱（可选）
            <input
              data-testid="create-user-email"
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2 font-normal"
              autoComplete="off"
            />
          </label>
          <label className="text-sm font-medium">
            初始密码
            <input
              data-testid="create-user-password"
              type="password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2 font-normal"
              autoComplete="new-password"
            />
          </label>
          <label className="text-sm font-medium">
            角色
            <input
              value="operator"
              readOnly
              aria-label="新用户角色"
              className="mt-1 block w-full rounded border bg-slate-50 px-3 py-2 font-normal"
            />
          </label>
          <button
            data-testid="create-user-submit"
            disabled={busy}
            className="self-end rounded bg-emerald-700 px-4 py-2 text-white disabled:bg-slate-300"
          >
            创建 operator
          </button>
          <p className="text-xs text-slate-500 md:col-span-5">
            用户名在当前租户内唯一；密码至少 8 位且同时包含英文字母和数字。密码提交后不会保存或再次显示。
          </p>
        </form>

        <section className="overflow-x-auto rounded-md border bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3">用户名</th>
                <th className="p-3">邮箱</th>
                <th className="p-3">角色</th>
                <th className="p-3">状态</th>
                <th className="p-3">最后登录</th>
                <th className="p-3">地点权限</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className="border-t" data-testid={`user-row-${row.user_id}`}>
                  <td className="p-3">
                    {editingId === row.user_id ? (
                      <input
                        aria-label="编辑用户名"
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        value={editingUsername}
                        onChange={(event) => setEditingUsername(event.target.value)}
                        className="rounded border px-2 py-1"
                      />
                    ) : row.username}
                  </td>
                  <td className="p-3">
                    {editingId === row.user_id ? (
                      <input
                        aria-label="编辑邮箱"
                        type="email"
                        maxLength={254}
                        value={editingEmail}
                        onChange={(event) => setEditingEmail(event.target.value)}
                        className="rounded border px-2 py-1"
                      />
                    ) : row.email ?? '未绑定'}
                  </td>
                  <td className="p-3">{row.role}</td>
                  <td className="p-3">{row.status === 'active' ? '启用' : '停用'}</td>
                  <td className="p-3">{formatTime(row.last_login_at)}</td>
                  <td className="min-w-52 p-3">
                    {(assignments[row.user_id] ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(assignments[row.user_id] ?? []).map((location) => (
                          <span
                            key={location.location_id}
                            className={`rounded px-2 py-1 text-xs ${
                              location.is_active
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {location.location_name}
                            {location.is_active ? '' : '（已停用）'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500">未分配地点</span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openAssignmentEditor(row)}
                      className="mt-2 text-emerald-700 disabled:text-slate-400"
                    >
                      配置地点
                    </button>
                  </td>
                  <td className="min-w-80 p-3">
                    {editingId === row.user_id ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveIdentity(row.user_id)}
                          className="mr-3 text-emerald-700"
                        >
                          保存身份
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId('');
                            setEditingUsername('');
                            setEditingEmail('');
                          }}
                          className="mr-3 text-slate-600"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(row.user_id);
                          setEditingUsername(row.username);
                          setEditingEmail(row.email ?? '');
                        }}
                        className="mr-3 text-emerald-700"
                      >
                        修改身份
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void changeStatus(row)}
                      className={`mr-3 ${row.status === 'active' ? 'text-red-700' : 'text-emerald-700'}`}
                    >
                      {row.status === 'active' ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResettingId(row.user_id);
                        setResetPassword('');
                      }}
                      className="text-amber-700"
                    >
                      重置密码
                    </button>
                    {resettingId === row.user_id ? (
                      <form
                        onSubmit={(event) => void submitPasswordReset(event, row.user_id)}
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        <input
                          aria-label="新密码"
                          type="password"
                          required
                          maxLength={128}
                          value={resetPassword}
                          onChange={(event) => setResetPassword(event.target.value)}
                          autoComplete="new-password"
                          className="rounded border px-2 py-1"
                        />
                        <button disabled={busy} className="rounded bg-amber-700 px-3 py-1 text-white">
                          确认重置
                        </button>
                        <button
                          type="button"
                          onClick={() => { setResettingId(''); setResetPassword(''); }}
                          className="rounded border px-3 py-1"
                        >
                          取消
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-slate-500">暂无 operator</td></tr>
              ) : null}
            </tbody>
          </table>
        </section>
        {assignmentEditingId ? (() => {
          const row = rows.find((item) => item.user_id === assignmentEditingId);
          if (!row) return null;
          const currentAssignments = assignments[row.user_id] ?? [];
          const inactiveLocations = locations.filter((location) => !location.is_active);
          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="location-assignment-title"
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-2 sm:items-center sm:p-4"
            >
              <section className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl sm:max-h-[calc(100dvh-2rem)]">
                <header className="shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
                  <h2 id="location-assignment-title" className="text-lg font-semibold">
                    配置 {row.username} 的地点权限
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    仅可分配当前租户的启用地点。保存后，operator 的后续请求立即使用新权限。
                  </p>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">可分配地点</legend>
                  <div
                    className="max-h-[min(40dvh,20rem)] space-y-2 overflow-y-auto overscroll-contain pr-1"
                    data-testid="assignable-location-list"
                  >
                    {locations.filter((location) => location.is_active).map((location) => (
                      <label key={location.location_id} className="flex items-center gap-2 rounded border p-3">
                        <input
                          type="checkbox"
                          checked={selectedLocationIds.includes(location.location_id)}
                          onChange={() => toggleLocation(location.location_id)}
                        />
                        <span className="min-w-0 break-words">{location.location_name}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-slate-500">{location.location_code}</span>
                      </label>
                    ))}
                    {locations.every((location) => !location.is_active) ? (
                      <p className="text-sm text-slate-500">当前没有可分配的启用地点。</p>
                    ) : null}
                  </div>
                </fieldset>
                {inactiveLocations.length > 0 ? (
                  <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-medium">已停用地点（不可新增分配）</p>
                    <ul className="mt-2 space-y-1 text-slate-600">
                      {inactiveLocations.map((location) => {
                        const isAssigned = currentAssignments.some(
                          (assigned) => assigned.location_id === location.location_id,
                        );
                        return (
                          <li key={location.location_id}>
                            {location.location_name}
                            {isAssigned ? '：当前仍有旧分配，保存时将撤销' : ''}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                </div>
                <footer className="flex shrink-0 justify-end gap-3 border-t bg-white px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAssignmentEditingId('');
                      setSelectedLocationIds([]);
                    }}
                    className="rounded border px-4 py-2"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveLocationAssignments(row)}
                    className="rounded bg-emerald-700 px-4 py-2 text-white disabled:bg-slate-300"
                  >
                    保存地点权限
                  </button>
                </footer>
              </section>
            </div>
          );
        })() : null}
      </div>
    </main>
  );
}
