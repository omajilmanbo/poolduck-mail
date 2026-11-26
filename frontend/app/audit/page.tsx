'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuditLogResponse, createApiClient } from '../../src/api/client';

type AuditPageResult = {
  query: string;
  cursors: (string | null)[];
  response: AuditLogResponse;
};

function defaults() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400000);
  return { from: from.toISOString().slice(0, 16), to: to.toISOString().slice(0, 16) };
}

function filterParams(from: string, to: string, action = '', result = '', actor = '') {
  return new URLSearchParams({
    created_from: new Date(from).toISOString(),
    created_to: new Date(to).toISOString(),
    ...(action ? { action } : {}),
    ...(result ? { result } : {}),
    ...(actor ? { actor_user_id: actor } : {}),
  }).toString();
}

export default function AuditPage() {
  const api = useMemo(() => createApiClient(), []);
  const initial = useMemo(defaults, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState<AuditPageResult | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);

  const load = useCallback(async (query: string, cursors: (string | null)[]) => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams(query);
    const cursor = cursors.at(-1);
    if (cursor) params.set('cursor', cursor);

    try {
      const response = await api.getAuditLogs(params.toString());
      if (requestId === latestRequest.current) setPage({ query, cursors, response });
    } catch {
      if (requestId === latestRequest.current) setError('审计日志加载失败，请重试。');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    api.getMe().then(({ user }) => {
      if (!active) return;
      if (user.role !== 'tenant_manager') {
        window.location.href = '/';
        return;
      }
      setAuthorized(true);
      void load(filterParams(initial.from, initial.to), [null]);
    }).catch(() => {
      if (active) window.location.href = '/';
    });
    return () => {
      active = false;
      latestRequest.current += 1;
    };
  }, [api, initial, load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load(filterParams(from, to, action, result, actor), [null]);
  }

  const next = page?.response.next_cursor;
  const pageNumber = page?.cursors.length ?? 1;
  const navigationButton = 'rounded border px-3 py-2 disabled:cursor-not-allowed disabled:text-stone-400';

  if (!authorized) return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;

  return (
    <main className="min-h-screen bg-stone-100 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex justify-between">
          <h1 className="text-2xl font-semibold">审计日志</h1>
          <a href="/" className="text-sm text-emerald-700">返回工作台</a>
        </header>
        <form onSubmit={submit} className="flex flex-wrap gap-3 rounded border bg-white p-4">
          <input type="datetime-local" aria-label="开始时间" required value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border p-2" />
          <input type="datetime-local" aria-label="结束时间" required value={to} onChange={(e) => setTo(e.target.value)} className="rounded border p-2" />
          <input placeholder="action" value={action} onChange={(e) => setAction(e.target.value)} className="rounded border p-2" />
          <select aria-label="result" value={result} onChange={(e) => setResult(e.target.value)} className="rounded border p-2">
            <option value="">全部结果</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="denied">denied</option>
          </select>
          <input placeholder="actor user UUID" value={actor} onChange={(e) => setActor(e.target.value)} className="rounded border p-2" />
          <button className="rounded bg-emerald-700 px-4 text-white">查询</button>
          <button type="button" onClick={() => void api.exportAuditLogs(filterParams(from, to, action, result, actor))} className="rounded border px-4">导出 CSV</button>
        </form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <section aria-busy={loading} className="overflow-x-auto rounded border bg-white">
          <table aria-label="审计日志" className="min-w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-3">时间</th>
                <th className="p-3">动作</th>
                <th className="p-3">资源</th>
                <th className="p-3">结果</th>
                <th className="p-3">脱敏元数据</th>
              </tr>
            </thead>
            <tbody>
              {page?.response.items.map((row) => (
                <tr className="border-t" key={row.audit_log_id}>
                  <td className="p-3">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="p-3">{row.action}</td>
                  <td className="p-3">{row.resource_type}/{row.resource_id}</td>
                  <td className="p-3">{row.result}</td>
                  <td className="max-w-md truncate p-3 font-mono text-xs">{JSON.stringify(row.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <nav aria-label="审计日志分页" className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={loading || pageNumber === 1} onClick={() => page && void load(page.query, page.cursors.slice(0, -1))} className={navigationButton}>上一页</button>
          <button type="button" disabled={loading || !next} onClick={() => page && next && void load(page.query, [...page.cursors, next])} className={navigationButton}>下一页</button>
          <span role="status" className="text-stone-600">
            {loading ? '正在加载审计日志…' : page && `第 ${pageNumber} 页 · ${page.response.items.length} 条记录`}
          </span>
        </nav>
      </div>
    </main>
  );
}
