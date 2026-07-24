'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AuditLogItem, createApiClient } from '../../src/api/client';

function defaults() { const to = new Date(); const from = new Date(to.getTime() - 7 * 86400000); return { from: from.toISOString().slice(0, 16), to: to.toISOString().slice(0, 16) }; }

export default function AuditPage() {
  const api = useMemo(() => createApiClient(), []);
  const initial = useMemo(defaults, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [actor, setActor] = useState('');
  const [rows, setRows] = useState<AuditLogItem[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const params = useCallback(() => new URLSearchParams({ created_from: new Date(from).toISOString(), created_to: new Date(to).toISOString(), ...(action ? { action } : {}), ...(result ? { result } : {}), ...(actor ? { actor_user_id: actor } : {}) }).toString(), [action, actor, from, result, to]);
  const load = useCallback(() => api.getAuditLogs(params()).then((response) => setRows(response.items)), [api, params]);
  useEffect(() => {
    api.getMe().then(({ user }) => {
      if (user.role !== 'tenant_manager') window.location.href = '/';
      else {
        setAuthorized(true);
        const initialParams = new URLSearchParams({
          created_from: new Date(initial.from).toISOString(),
          created_to: new Date(initial.to).toISOString(),
        });
        void api.getAuditLogs(initialParams.toString()).then((response) => setRows(response.items));
      }
    }).catch(() => { window.location.href = '/'; });
  }, [api, initial]);
  function submit(event: FormEvent) { event.preventDefault(); void load(); }
  if (!authorized) return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;
  return <main className="min-h-screen bg-stone-100 p-6"><div className="mx-auto max-w-6xl space-y-5"><header className="flex justify-between"><h1 className="text-2xl font-semibold">审计日志</h1><a href="/" className="text-sm text-emerald-700">返回工作台</a></header><form onSubmit={submit} className="flex flex-wrap gap-3 rounded border bg-white p-4"><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border p-2"/><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border p-2"/><input placeholder="action" value={action} onChange={(e) => setAction(e.target.value)} className="rounded border p-2"/><select aria-label="result" value={result} onChange={(e) => setResult(e.target.value)} className="rounded border p-2"><option value="">全部结果</option><option value="success">success</option><option value="failure">failure</option><option value="denied">denied</option></select><input placeholder="actor user UUID" value={actor} onChange={(e) => setActor(e.target.value)} className="rounded border p-2"/><button className="rounded bg-emerald-700 px-4 text-white">查询</button><button type="button" onClick={() => void api.exportAuditLogs(params())} className="rounded border px-4">导出 CSV</button></form><section className="overflow-x-auto rounded border bg-white"><table className="min-w-full text-left text-sm"><thead><tr><th className="p-3">时间</th><th className="p-3">动作</th><th className="p-3">资源</th><th className="p-3">结果</th><th className="p-3">脱敏元数据</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t" key={row.audit_log_id}><td className="p-3">{new Date(row.created_at).toLocaleString()}</td><td className="p-3">{row.action}</td><td className="p-3">{row.resource_type}/{row.resource_id}</td><td className="p-3">{row.result}</td><td className="max-w-md truncate p-3 font-mono text-xs">{JSON.stringify(row.metadata)}</td></tr>)}</tbody></table></section></div></main>;
}
