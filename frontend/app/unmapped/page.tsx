'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocationItem, UnmappedScanCase, createApiClient } from '../../src/api/client';

export default function UnmappedScansPage() {
  const api = useMemo(() => createApiClient(), []);
  const [rows, setRows] = useState<UnmappedScanCase[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState<'open' | 'resolved' | 'ignored' | ''>('open');
  const [error, setError] = useState('');
  const [authorized, setAuthorized] = useState(false);

  const reload = useCallback(async () => {
    const params = new URLSearchParams();
    if (locationId) params.set('location_id', locationId);
    if (status) params.set('status', status);
    setRows(await api.getUnmappedScans(params.toString()));
  }, [api, locationId, status]);

  useEffect(() => {
    Promise.all([api.getMe(), api.getLocations('cookie')]).then(([session, locationRows]) => {
      if (!['tenant_manager', 'operator'].includes(session.user.role)) {
        window.location.href = '/';
        return;
      }
      setAuthorized(true);
      setLocations(locationRows);
    }).catch(() => { window.location.href = '/'; });
  }, [api]);

  useEffect(() => {
    if (!authorized) return;
    reload().catch((cause) => setError(cause instanceof Error ? cause.message : '加载失败'));
  }, [authorized, reload]);

  async function handle(caseId: string, next: 'resolved' | 'ignored') {
    if (!window.confirm(next === 'resolved' ? '确认数据已修正？历史邮件不会自动补发。' : '确认忽略此未映射扫码？')) return;
    try {
      await api.updateUnmappedScan(caseId, next);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新失败');
    }
  }

  if (!authorized) return <main className="min-h-screen bg-stone-100 p-6">正在验证权限…</main>;

  return <main className="min-h-screen bg-stone-100 p-6 text-slate-950">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-center justify-between"><h1 className="text-2xl font-semibold">未映射扫码处理</h1><a href="/" className="text-sm text-emerald-700">返回工作台</a></header>
      <p className="text-sm text-slate-600">“已修正”仅表示映射数据已修正，不会自动补发历史邮件。</p>
      {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <section className="flex gap-3 rounded border bg-white p-4">
        <select aria-label="地点" value={locationId} onChange={(event) => setLocationId(event.target.value)} className="rounded border px-3 py-2"><option value="">全部地点</option>{locations.map((row) => <option key={row.location_id} value={row.location_id}>{row.location_name}{row.is_active ? '' : '（已停用）'}</option>)}</select>
        <select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded border px-3 py-2"><option value="">全部状态</option><option value="open">待处理</option><option value="resolved">已修正</option><option value="ignored">已忽略</option></select>
      </section>
      <section className="overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">时间</th><th className="p-3">地点</th><th className="p-3">扫描码</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.case_id} className="border-t"><td className="p-3">{new Date(row.received_at).toLocaleString('ja-JP')}</td><td className="p-3">{row.location_name ?? '-'}{row.location_active ? '' : '（已停用）'}</td><td className="p-3 font-mono">{row.scan_code}</td><td className="p-3">{{ open: '待处理', resolved: '已修正', ignored: '已忽略' }[row.status]}</td><td className="p-3">{row.status === 'open' ? <div className="flex gap-3">{row.mapping_prefill_allowed && row.location_id ? <a className="text-emerald-700" href={`/people?location_id=${encodeURIComponent(row.location_id)}&scan_code=${encodeURIComponent(row.scan_code)}`}>修正映射</a> : <span className="text-slate-400">地点不可写</span>}<button className="text-emerald-700" onClick={() => void handle(row.case_id, 'resolved')}>标记已修正</button><button className="text-slate-600" onClick={() => void handle(row.case_id, 'ignored')}>忽略</button></div> : '-'}</td></tr>)}</tbody></table>{!rows.length ? <p className="p-6 text-sm text-slate-500">暂无记录</p> : null}</section>
    </div>
  </main>;
}
