'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  CreatedPlatformTenant,
  PlatformAdminSummary,
  PlatformTenantSummary,
  createPlatformApiClient,
} from '../../src/api/client';

function localInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function message(error: unknown) {
  if (error instanceof ApiError) {
    const safe: Record<string, string> = {
      LOCATION_LIMIT_BELOW_CURRENT_USAGE: '新额度不能低于当前地点计数。',
      PLATFORM_VERSION_CONFLICT: '数据已更新，请刷新后重试。',
      IDEMPOTENCY_KEY_CONFLICT: '本次提交标识已用于其他请求，请重新提交。',
    };
    return (error.code && safe[error.code]) || error.message;
  }
  return '网络请求失败，请确认后端状态后重试。';
}

export default function PlatformPage() {
  const api = useMemo(() => createPlatformApiClient(), []);
  const [admin, setAdmin] = useState<PlatformAdminSummary | null>(null);
  const [tenants, setTenants] = useState<PlatformTenantSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedPlatformTenant | null>(null);
  const [name, setName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [status, setStatus] = useState<'trial' | 'active'>('trial');
  const [startAt, setStartAt] = useState(() => localInput(new Date()));
  const [endAt, setEndAt] = useState(() =>
    localInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
  const [limit, setLimit] = useState(1);
  const [limitDraft, setLimitDraft] = useState(1);
  const [subscriptionStartDraft, setSubscriptionStartDraft] = useState('');
  const [subscriptionEndDraft, setSubscriptionEndDraft] = useState('');

  const selected = tenants.find((tenant) => tenant.tenant_code === selectedCode);

  const load = useCallback(async () => {
    try {
      const [me, items] = await Promise.all([api.getMe(), api.getTenants()]);
      setAdmin(me.admin);
      setTenants(items);
      setSelectedCode((current) =>
        items.some((item) => item.tenant_code === current)
          ? current
          : (items[0]?.tenant_code ?? ''),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        window.location.replace('/platform/login');
        return;
      }
      setError(message(caught));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selected) {
      setLimitDraft(selected.location_limit);
      if (selected.subscription) {
        setSubscriptionStartDraft(
          localInput(new Date(selected.subscription.start_at)),
        );
        setSubscriptionEndDraft(
          localInput(new Date(selected.subscription.end_at)),
        );
      }
    }
  }, [selected]);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`创建租户“${name}”并开通 ${status} 订阅？`)) return;
    setBusy(true);
    setError('');
    setCreated(null);
    try {
      const result = await api.createTenant(
        {
          name,
          manager_email: managerEmail,
          subscription_status: status,
          start_at: new Date(startAt).toISOString(),
          end_at: new Date(endAt).toISOString(),
          location_limit: limit,
        },
        crypto.randomUUID(),
      );
      setCreated(result);
      setName('');
      setManagerEmail('');
      await load();
      setSelectedCode(result.tenant_code);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeLimit() {
    if (!selected) return;
    if (
      !window.confirm(
        `确认将 ${selected.name} (${selected.tenant_code}) 的地点额度从 ${selected.location_limit} 调整为 ${limitDraft}？`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api.updateLocationLimit(
        selected.tenant_code,
        limitDraft,
        selected.platform_version,
      );
      setTenants((items) =>
        items.map((item) =>
          item.tenant_code === updated.tenant_code ? updated : item,
        ),
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeSubscription(
    next: 'trial' | 'active' | 'expired' | 'suspended',
  ) {
    if (!selected?.subscription) return;
    if (
      !window.confirm(
        `确认将 ${selected.name} (${selected.tenant_code}) 的订阅状态改为 ${next}？`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const preserveInterval = next === 'suspended';
      const updated = await api.updateSubscription(selected.tenant_code, {
        status: next,
        start_at: preserveInterval
          ? selected.subscription.start_at
          : new Date(subscriptionStartDraft).toISOString(),
        end_at: preserveInterval
          ? selected.subscription.end_at
          : new Date(subscriptionEndDraft).toISOString(),
        version: selected.subscription.version,
      });
      setTenants((items) =>
        items.map((item) =>
          item.tenant_code === updated.tenant_code ? updated : item,
        ),
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
            Poolduck Control Plane
          </p>
          <h1 className="mt-1 text-2xl font-semibold">平台运营控制台</h1>
          <p className="mt-1 text-sm text-slate-400">{admin?.email_masked}</p>
        </div>
        <button
          onClick={() =>
            void api.logout().finally(() => window.location.replace('/platform/login'))
          }
          className="rounded-md border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
        >
          退出平台
        </button>
      </header>

      {error ? (
        <div className="mt-5 rounded-md border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {created ? (
        <section className="mt-5 rounded-lg border border-amber-500 bg-amber-950/40 p-5">
          <h2 className="font-semibold text-amber-200">一次性临时凭据</h2>
          <p className="mt-2 text-sm text-amber-100">
            仅通过已批准的安全渠道交付。关闭此区域后无法从控制台再次读取。
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">tenant_code</dt><dd className="font-mono">{created.tenant_code}</dd></div>
            <div><dt className="text-slate-400">临时密码</dt><dd data-testid="temporary-password" className="break-all font-mono">{created.temporary_password}</dd></div>
          </dl>
          <button
            onClick={() => setCreated(null)}
            className="mt-4 rounded-md bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950"
          >
            我已安全保存，清除显示
          </button>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <form
          onSubmit={createTenant}
          className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5"
        >
          <h2 className="text-lg font-semibold">创建租户</h2>
          <label className="mt-4 block text-sm">租户名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} required className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
          <label className="mt-4 block text-sm">首个 tenant_manager 邮箱<input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
          <label className="mt-4 block text-sm">初始订阅<select value={status} onChange={(e) => setStatus(e.target.value as 'trial' | 'active')} className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2"><option value="trial">trial</option><option value="active">active</option></select></label>
          <label className="mt-4 block text-sm">start_at<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
          <label className="mt-4 block text-sm">end_at<input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
          <label className="mt-4 block text-sm">location_limit<input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} required className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
          <button disabled={busy} className="sticky bottom-0 mt-5 w-full rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">确认并创建</button>
        </form>

        <section className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">租户摘要</h2>
            <select value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)} className="max-w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm">
              {tenants.map((tenant) => <option key={tenant.tenant_code} value={tenant.tenant_code}>{tenant.name} / {tenant.tenant_code}</option>)}
            </select>
          </div>
          {selected ? (
            <div className="mt-5 space-y-5">
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-slate-400">tenant_code</dt><dd className="font-mono">{selected.tenant_code}</dd></div>
                <div><dt className="text-slate-400">subscription</dt><dd>{selected.subscription?.status ?? '-'}</dd></div>
                <div><dt className="text-slate-400">manager</dt><dd>{selected.manager?.email_masked ?? '-'}</dd></div>
                <div><dt className="text-slate-400">locations</dt><dd>{selected.location_count} / {selected.location_limit}</dd></div>
                <div><dt className="text-slate-400">subscription version</dt><dd>{selected.subscription?.version ?? '-'}</dd></div>
                <div><dt className="text-slate-400">platform version</dt><dd>{selected.platform_version}</dd></div>
              </dl>
              <div className="rounded-md border border-slate-700 p-4">
                <h3 className="font-medium">订阅操作</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">start_at<input type="datetime-local" value={subscriptionStartDraft} onChange={(e) => setSubscriptionStartDraft(e.target.value)} className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
                  <label className="text-sm">end_at<input type="datetime-local" value={subscriptionEndDraft} onChange={(e) => setSubscriptionEndDraft(e.target.value)} className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" /></label>
                </div>
                <p className="mt-2 text-xs text-slate-400">暂停会保留当前时间区间；恢复 trial/active 时 end_at 必须晚于当前时间；expired 的 end_at 不能晚于当前时间。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['trial', 'active', 'expired', 'suspended'] as const).map((next) => (
                    <button key={next} disabled={busy || selected.subscription?.status === next} onClick={() => void changeSubscription(next)} className="rounded-md border border-slate-600 px-3 py-2 text-sm disabled:opacity-40">{next}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-700 p-4">
                <h3 className="font-medium">地点额度</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input aria-label="location limit" type="number" min={1} value={limitDraft} onChange={(e) => setLimitDraft(Number(e.target.value))} className="w-32 rounded-md border border-slate-600 bg-slate-950 px-3 py-2" />
                  <button disabled={busy || limitDraft < 1} onClick={() => void changeLimit()} className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">确认调整</button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                控制台仅显示租户、订阅、额度与脱敏管理员摘要，不提供人员、扫码、邮件、租户审计或 impersonation。
              </p>
            </div>
          ) : <p className="mt-5 text-sm text-slate-400">暂无租户。</p>}
        </section>
      </div>
    </main>
  );
}
