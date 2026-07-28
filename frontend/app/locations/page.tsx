'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { LocationItem, createApiClient } from '../../src/api/client';
import { deletionDaysRemaining } from '../../src/deletion';

export function canManageLocations(role: string) {
  return role === 'tenant_manager';
}

export default function LocationsPage() {
  const api = useMemo(() => createApiClient(), []);
  const [rows, setRows] = useState<LocationItem[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(
    () => api.getLocations('cookie', true).then(setRows),
    [api],
  );

  useEffect(() => {
    api
      .getMe()
      .then(({ user }) => {
        if (!canManageLocations(user.role)) {
          window.location.href = '/';
          return;
        }
        setAuthorized(true);
        void reload();
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, [api, reload]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await reload();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (editing) await api.updateLocation(editing, { location_name: name });
      else await api.createLocation({ location_name: name });
      setEditing('');
      setName('');
    }, editing ? '地点名称已更新' : '地点已创建');
  }

  if (!authorized) {
    return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;
  }

  return (
    <main className="min-h-screen bg-stone-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">地点管理</h1>
          <a href="/" className="text-sm text-emerald-700">返回工作台</a>
        </header>
        {error ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-800">{notice}</p> : null}
        <form onSubmit={save} className="grid gap-3 rounded border bg-white p-4 md:grid-cols-2">
          <input
            required
            placeholder="地点名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border px-3 py-2"
          />
          <button disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:bg-slate-400">
            {editing ? '保存' : '新增地点'}
          </button>
        </form>
        <section className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr>
                <th className="p-3">地点 ID</th>
                <th className="p-3">名称</th>
                <th className="p-3">状态</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pendingDeletion = row.deletion_status === 'scheduled';
                const remaining = deletionDaysRemaining(row.purge_after);
                return (
                  <tr className="border-t" key={row.location_id}>
                    <td className="p-3 font-mono">{row.location_code}</td>
                    <td className="p-3">{row.location_name}</td>
                    <td className="p-3">
                      {pendingDeletion
                        ? `待删除（剩余 ${remaining} 天）`
                        : row.is_active ? '启用' : '停用'}
                      {pendingDeletion && row.purge_after ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          最终删除：{new Date(row.purge_after).toLocaleString()}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {pendingDeletion ? (
                        <div className="flex items-center gap-3">
                          <span className="text-red-700">删除（剩余 {remaining} 天）</span>
                          <button
                            disabled={busy || remaining === 0}
                            className="text-emerald-700 disabled:text-slate-400"
                            onClick={() => void run(
                              () => api.restoreLocation(row.location_id),
                              '地点已恢复到删除前状态',
                            )}
                          >
                            恢复
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          <button
                            disabled={busy}
                            className="text-emerald-700 disabled:text-slate-400"
                            onClick={() => {
                              setEditing(row.location_id);
                              setName(row.location_name);
                            }}
                          >
                            编辑
                          </button>
                          {row.is_active ? (
                            <button
                              disabled={busy}
                              className="text-amber-700 disabled:text-slate-400"
                              onClick={() => {
                                if (window.confirm('停用后禁止新扫描和映射写入，排队邮件将安全终止，历史记录仍保留。确认停用？')) {
                                  void run(() => api.deactivateLocation(row.location_id), '地点已停用');
                                }
                              }}
                            >
                              停用
                            </button>
                          ) : (
                            <button
                              disabled={busy}
                              className="text-emerald-700 disabled:text-slate-400"
                              onClick={() => {
                                if (window.confirm('重新启用后可恢复新的扫描和人员映射写入。确认启用？')) {
                                  void run(() => api.reactivateLocation(row.location_id), '地点已重新启用');
                                }
                              }}
                            >
                              重新启用
                            </button>
                          )}
                          <button
                            disabled={busy}
                            className="text-red-700 disabled:text-slate-400"
                            onClick={() => {
                              if (window.confirm('删除后地点会立即停止使用，14 天内可以恢复；到期后将清除当前资料且无法恢复。确认删除？')) {
                                void run(() => api.scheduleLocationDeletion(row.location_id), '地点已进入 14 天待删除期');
                              }
                            }}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
