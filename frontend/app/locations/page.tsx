'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { LocationItem, createApiClient } from '../../src/api/client';

export function canManageLocations(role: string) { return role === 'tenant_manager'; }

export default function LocationsPage() {
  const api = useMemo(() => createApiClient(), []);
  const [rows, setRows] = useState<LocationItem[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const reload = useCallback(() => api.getLocations('cookie').then(setRows), [api]);

  useEffect(() => { api.getMe().then(({ user }) => { if (!canManageLocations(user.role)) window.location.href = '/'; else { setAuthorized(true); void reload(); } }).catch(() => { window.location.href = '/'; }); }, [api, reload]);

  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      if (editing) await api.updateLocation(editing, { location_name: name });
      else await api.createLocation({ location_name: name });
      setEditing(''); setName(''); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
  }

  if (!authorized) return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;

  return <main className="min-h-screen bg-stone-100 p-6"><div className="mx-auto max-w-5xl space-y-5">
    <header className="flex justify-between"><h1 className="text-2xl font-semibold">地点管理</h1><a href="/" className="text-sm text-emerald-700">返回工作台</a></header>
    {error ? <p className="rounded bg-red-50 p-3 text-red-700">{error}</p> : null}
    <form onSubmit={save} className="grid gap-3 rounded border bg-white p-4 md:grid-cols-2"><input required placeholder="地点名称" value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-3 py-2"/><button className="rounded bg-emerald-700 px-4 py-2 text-white">{editing ? '保存' : '新增地点'}</button></form>
    <section className="rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">地点 ID</th><th className="p-3">名称</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.location_id}><td className="p-3 font-mono">{row.location_code}</td><td className="p-3">{row.location_name}</td><td className="p-3">{row.is_active ? '启用' : '停用'}</td><td className="p-3"><button className="mr-3 text-emerald-700" onClick={() => { setEditing(row.location_id); setName(row.location_name); }}>编辑</button>{row.is_active ? <button className="text-red-700" onClick={() => { if (window.confirm('停用后禁止新扫描和映射写入，排队邮件将安全终止，历史记录仍保留。确认停用？')) void api.deactivateLocation(row.location_id).then(reload); }}>停用</button> : <button className="text-emerald-700" onClick={() => { if (window.confirm('重新启用后可恢复新的扫描和人员映射写入。确认启用？')) void api.reactivateLocation(row.location_id).then(reload); }}>重新启用</button>}</td></tr>)}</tbody></table></section>
  </div></main>;
}
