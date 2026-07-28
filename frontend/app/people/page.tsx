'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LocationItem,
  PersonMapping,
  createApiClient,
} from '../../src/api/client';
import { deletionDaysRemaining } from '../../src/deletion';
import PersonActionCodesDialog from './PersonActionCodesDialog';

export function canManagePeople(role: string) {
  return role === 'tenant_manager' || role === 'operator';
}

export default function PeoplePage() {
  const api = useMemo(() => createApiClient(), []);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [locationId, setLocationId] = useState('');
  const [people, setPeople] = useState<PersonMapping[]>([]);
  const [editingId, setEditingId] = useState('');
  const [personName, setPersonName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewPersonCode, setPreviewPersonCode] = useState<string | null>(null);

  const reloadPeople = useCallback(async () => {
    if (!locationId) return;
    setPeople(await api.getPeople('cookie', locationId, true));
  }, [api, locationId]);

  useEffect(() => {
    Promise.all([api.getMe(), api.getLocations('cookie')])
      .then(([session, rows]) => {
        if (!canManagePeople(session.user.role)) {
          window.location.href = '/';
          return;
        }
        setAuthorized(true);
        setLocations(rows);
        const params = new URLSearchParams(window.location.search);
        const requestedLocation = params.get('location_id') ?? '';
        setLocationId(
          rows.some((row) => row.location_id === requestedLocation)
            ? requestedLocation
            : (rows[0]?.location_id ?? ''),
        );
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, [api]);

  useEffect(() => {
    if (!locationId) return;
    void api
      .getPeople('cookie', locationId, true)
      .then(setPeople)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [api, locationId]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await reloadPeople();
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
      if (editingId) {
        await api.updatePerson(locationId, editingId, {
          person_name: personName,
          email,
        });
      } else {
        await api.createPerson(locationId, {
          person_name: personName,
          email,
        });
      }
      reset();
    }, editingId ? '人员资料已更新' : '人员已新增');
  }

  async function edit(person: PersonMapping) {
    setError('');
    try {
      const detail = await api.getPerson(locationId, person.person_id);
      setEditingId(person.person_id);
      setPersonName(detail.person_name);
      setEmail(detail.email);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取人员资料失败');
    }
  }

  function reset() {
    setEditingId('');
    setPersonName('');
    setEmail('');
  }

  if (!authorized) {
    return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;
  }

  const selectedLocationActive =
    locations.find((row) => row.location_id === locationId)?.is_active ?? false;

  return (
    <main className="min-h-screen bg-stone-100 p-4 text-slate-950 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">人员映射管理</h1>
          <a href="/" className="text-sm text-emerald-700">返回工作台</a>
        </header>
        {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
        <section className="rounded-md border bg-white p-4">
          <label className="text-sm font-medium">
            地点
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setPreviewPersonCode(null);
                reset();
              }}
              className="ml-3 max-w-full rounded border px-3 py-2"
            >
              {locations.map((row) => (
                <option key={row.location_id} value={row.location_id}>
                  {row.location_name}{row.is_active ? '' : '（已停用）'}
                </option>
              ))}
            </select>
          </label>
        </section>
        <form onSubmit={save} className="grid gap-3 rounded-md border bg-white p-4 md:grid-cols-3">
          <input
            aria-label="姓名"
            required
            placeholder="姓名"
            value={personName}
            onChange={(event) => setPersonName(event.target.value)}
            className="rounded border px-3 py-2"
          />
          <input
            aria-label="邮箱"
            required
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border px-3 py-2"
          />
          <div className="flex gap-2">
            <button
              disabled={!selectedLocationActive || busy}
              className="rounded bg-emerald-700 px-4 py-2 text-white disabled:bg-slate-400"
            >
              {editingId ? '保存' : '新增'}
            </button>
            {editingId ? (
              <button type="button" onClick={reset} className="rounded border px-4 py-2">
                取消
              </button>
            ) : null}
          </div>
        </form>
        <section className="overflow-x-auto rounded-md border bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3">姓名</th>
                <th className="p-3">人员 ID / 扫描码</th>
                <th className="p-3">邮箱</th>
                <th className="p-3">状态</th>
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const pendingDeletion = person.deletion_status === 'scheduled';
                const remaining = deletionDaysRemaining(person.purge_after);
                return (
                  <tr key={person.person_id} className="border-t">
                    <td className="p-3">{person.person_name}</td>
                    <td className="p-3 font-mono">{person.person_code}</td>
                    <td className="p-3">{person.email_masked}</td>
                    <td className="p-3">
                      {pendingDeletion
                        ? `待删除（剩余 ${remaining} 天）`
                        : person.is_active ? '启用' : '停用'}
                      {pendingDeletion && person.purge_after ? (
                        <span className="mt-1 block text-xs text-slate-500">
                          最终删除：{new Date(person.purge_after).toLocaleString()}
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
                              () => api.restorePerson(locationId, person.person_id),
                              '人员已恢复到删除前状态',
                            )}
                          >
                            恢复
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          <button
                            disabled={busy}
                            onClick={() => setPreviewPersonCode(person.person_code ?? '')}
                            className="text-sky-700 disabled:text-slate-400"
                          >
                            查看动作码
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void edit(person)}
                            className="text-emerald-700 disabled:text-slate-400"
                          >
                            编辑
                          </button>
                          {person.is_active ? (
                            <button
                              disabled={busy}
                              className="text-amber-700 disabled:text-slate-400"
                              onClick={() => {
                                if (window.confirm('停用后将禁止新的扫描映射，历史记录仍保留。确认停用？')) {
                                  void run(
                                    () => api.deactivatePerson(locationId, person.person_id),
                                    '人员已停用',
                                  );
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
                                if (window.confirm('重新启用后可恢复该人员的扫描映射。确认启用？')) {
                                  void run(
                                    () => api.reactivatePerson(locationId, person.person_id),
                                    '人员已重新启用',
                                  );
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
                              if (window.confirm('删除后人员会立即停止使用，14 天内可以恢复；到期后将清除当前姓名和邮箱且无法恢复。确认删除？')) {
                                void run(
                                  () => api.schedulePersonDeletion(locationId, person.person_id),
                                  '人员已进入 14 天待删除期',
                                );
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
      {previewPersonCode !== null ? (
        <PersonActionCodesDialog
          personCode={previewPersonCode}
          onClose={() => setPreviewPersonCode(null)}
        />
      ) : null}
    </main>
  );
}
