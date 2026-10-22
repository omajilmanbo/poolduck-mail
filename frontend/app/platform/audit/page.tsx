'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, PlatformAuditItem, createPlatformApiClient } from '../../../src/api/client';

type Filters = { from: string; to: string; admin: string; action: string; result: string; tenant: string };
const empty: Filters = { from: '', to: '', admin: '', action: '', result: '', tenant: '' };

function paramsFor(filters: Filters, cursor: string | null) {
  const params = new URLSearchParams({ limit: '25' });
  if (filters.from) params.set('created_from', new Date(filters.from).toISOString());
  if (filters.to) params.set('created_to', new Date(filters.to).toISOString());
  if (filters.admin) params.set('platform_admin_id', filters.admin.trim());
  if (filters.action) params.set('action', filters.action.trim());
  if (filters.result) params.set('result', filters.result);
  if (filters.tenant) params.set('target_tenant_id', filters.tenant.trim());
  if (cursor) params.set('cursor', cursor);
  return params;
}

export default function PlatformAuditPage() {
  const api = useMemo(() => createPlatformApiClient(), []);
  const [draft, setDraft] = useState<Filters>(empty);
  const [filters, setFilters] = useState<Filters>(empty);
  const [cursor, setCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [next, setNext] = useState<string | null>(null);
  const [items, setItems] = useState<PlatformAuditItem[]>([]);
  const [selected, setSelected] = useState<PlatformAuditItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cleaned, setCleaned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await api.getPlatformAudits(paramsFor(filters, cursor));
      setItems(page.items);
      setNext(page.next_cursor);
      setCleaned(page.items.length === 0 && cursor !== null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        window.location.replace('/platform/login');
        return;
      }
      setItems([]);
      setNext(null);
      setError(caught instanceof ApiError ? caught.message : '平台审计加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, [api, filters, cursor]);

  useEffect(() => { void load(); }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && new Date(draft.from) > new Date(draft.to)) {
      setError('起始时间不能晚于结束时间。');
      return;
    }
    setBack([]);
    setCursor(null);
    setSelected(null);
    setFilters({ ...draft });
  }

  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 text-slate-100 sm:px-6">
    <header className="mb-6 flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">平台审计</h1><p className="text-sm text-slate-400">平台操作记录，默认每页 25 条</p></div>
      <a href="/platform" className="rounded border border-slate-600 px-3 py-2 text-sm">返回控制台</a>
    </header>
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4 sm:grid-cols-3" aria-label="平台审计筛选">
      <label className="text-sm">开始时间<input aria-label="开始时间" type="datetime-local" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" /></label>
      <label className="text-sm">结束时间<input aria-label="结束时间" type="datetime-local" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" /></label>
      <label className="text-sm">管理员内部 ID<input aria-label="管理员内部 ID" value={draft.admin} onChange={e => setDraft({ ...draft, admin: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" /></label>
      <label className="text-sm">Action<input aria-label="Action" value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" /></label>
      <label className="text-sm">结果<select aria-label="结果" value={draft.result} onChange={e => setDraft({ ...draft, result: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"><option value="">全部</option><option value="success">成功</option><option value="failure">失败</option><option value="denied">拒绝</option></select></label>
      <label className="text-sm">目标租户内部 ID<input aria-label="目标租户内部 ID" value={draft.tenant} onChange={e => setDraft({ ...draft, tenant: e.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2" /></label>
      <div className="sm:col-span-3"><button className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-950">查询</button></div>
    </form>
    {error && <p role="alert" className="mt-4 rounded border border-red-700 p-3 text-red-300">{error}</p>}
    {loading ? <p className="mt-5">加载中…</p> : items.length === 0 && !error ? <p className="mt-5 text-slate-300">{cleaned ? '此页记录已清理或不再符合筛选条件。' : '没有符合条件的平台审计记录；记录也可能已按保留期清理。'}</p> : null}
    {items.length > 0 && <div className="mt-5 overflow-x-auto rounded-lg border border-slate-700"><table className="min-w-full text-left text-sm"><thead className="bg-slate-900"><tr><th className="p-3">时间</th><th className="p-3">管理员</th><th className="p-3">Action</th><th className="p-3">结果</th><th className="p-3">资源</th><th className="p-3">目标租户</th><th className="p-3">详情</th></tr></thead><tbody>{items.map(item => <tr key={item.audit_id} className="border-t border-slate-700"><td className="p-3 whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td><td className="p-3 font-mono text-xs">{item.platform_admin_id ?? '系统'}</td><td className="p-3">{item.action}</td><td className="p-3">{item.result}</td><td className="p-3">{item.resource_type}/{item.resource_id}</td><td className="p-3">{item.target_tenant ? `${item.target_tenant.tenant_code} · ${item.target_tenant.name}` : item.target_tenant_id ?? (item.action === 'platform.tenant.staging_deleted' ? '租户已清理' : '—')}</td><td className="p-3"><button onClick={() => setSelected(item)} className="text-cyan-300 underline">查看</button></td></tr>)}</tbody></table></div>}
    <nav className="mt-4 flex gap-3" aria-label="分页"><button disabled={back.length === 0 || loading} onClick={() => { setCursor(back.at(-1) ?? null); setBack(back.slice(0, -1)); setSelected(null); }} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">上一页</button><button disabled={!next || loading} onClick={() => { setBack([...back, cursor]); setCursor(next); setSelected(null); }} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">下一页</button></nav>
    {selected && <section className="mt-5 rounded-lg border border-slate-700 bg-slate-900 p-4" aria-label="审计详情"><div className="flex justify-between"><h2 className="font-semibold">审计详情</h2><button onClick={() => setSelected(null)}>关闭</button></div><dl className="mt-3 break-all text-sm"><dt>内部审计 ID</dt><dd className="font-mono">{selected.audit_id}</dd><dt className="mt-2">安全元数据</dt><dd className="font-mono">{JSON.stringify(selected.metadata)}</dd></dl></section>}
  </main>;
}
