'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  CreatedPlatformTenant,
  PlatformAdminSummary,
  PlatformEnvironment,
  PlatformTenantSummary,
  createPlatformApiClient,
} from '../../src/api/client';
import { downloadTenantProvisioningCsv } from '../../src/platform/tenant-provisioning-csv';

type CreatedTenantProvisioning = {
  tenant: CreatedPlatformTenant;
  initialName: string;
  managerEmail: string;
};

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
      PLATFORM_DELETE_PASSWORD_INVALID: '管理员密码错误，未执行删除。',
      PLATFORM_TENANT_ACTIVE_SUBSCRIPTION: '订阅为 active 的租户不能删除。',
      PLATFORM_TENANT_RESTORE_EXPIRED: '恢复期限已过，无法恢复。',
    };
    return (error.code && safe[error.code]) || error.message;
  }
  return '网络请求失败，请确认后端状态后重试。';
}

function stagingCleanupState(tenant: PlatformTenantSummary, now: number) {
  if (tenant.status !== 'staging_deleting') return null;
  const operation = tenant.recent_platform_operation;
  if (operation?.action === 'platform.tenant.staging_delete' && operation.result === 'failure') {
    return 'failed';
  }
  const startedAt = operation ? Date.parse(operation.created_at) : NaN;
  if (operation?.action === 'platform.tenant.staging_delete_started' &&
      operation.result === 'success' && Number.isFinite(startedAt) &&
      startedAt <= now && now - startedAt < 10 * 60_000) {
    return 'in_progress';
  }
  return 'unknown';
}

export default function PlatformPage() {
  const api = useMemo(() => createPlatformApiClient(), []);
  const [admin, setAdmin] = useState<PlatformAdminSummary | null>(null);
  const [mailMode, setMailMode] = useState<'mock' | 'oci_email_delivery_https' | 'unknown'>('unknown');
  const [environment, setEnvironment] = useState<PlatformEnvironment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformTenantSummary | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<PlatformTenantSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [created, setCreated] = useState<CreatedTenantProvisioning | null>(null);
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
    if (!tenants.some((tenant) => tenant.status === 'staging_deleting')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [tenants]);

  useEffect(() => {
    void api.getMailMode()
      .then((result) => {
        setMailMode(
          result?.mode === 'mock' || result?.mode === 'oci_email_delivery_https'
            ? result.mode
            : 'unknown',
        );
      })
      .catch(() => setMailMode('unknown'));
  }, [api]);

  useEffect(() => {
    void api.getEnvironment().then(setEnvironment).catch(() => setEnvironment(null));
  }, [api]);

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
      const initialName = name.trim();
      const initialManagerEmail = managerEmail.trim().toLowerCase();
      const result = await api.createTenant(
        {
          name: initialName,
          manager_email: initialManagerEmail,
          subscription_status: status,
          start_at: new Date(startAt).toISOString(),
          end_at: new Date(endAt).toISOString(),
          location_limit: limit,
        },
        crypto.randomUUID(),
      );
      setCreated({
        tenant: result,
        initialName,
        managerEmail: initialManagerEmail,
      });
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

  async function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || !deletePassword || busy) return;
    const targetCode = deleteTarget.tenant_code;
    const password = deletePassword;
    setDeletePassword('');
    setBusy(true);
    setError('');
    setDeleteError('');
    setNotice('');
    try {
      const result = await api.deleteTenant(targetCode, password);
      setDeleteTarget(null);
      await load();
      setNotice(result.status === 'deleted'
        ? `租户 ${targetCode} 的 Staging 在线数据已删除，无法恢复。`
        : `租户 ${targetCode} 已进入删除期。请以服务端显示的恢复截止时间为准。`);
    } catch (caught) {
      setDeleteError(caught instanceof ApiError && caught.code !== 'NETWORK_ERROR'
        ? message(caught)
        : '请求结果未知。请刷新租户状态；若 Staging 显示清理中，重新输入密码后重试。');
      if (!(caught instanceof ApiError && caught.code === 'PLATFORM_DELETE_PASSWORD_INVALID')) {
        void load();
      }
    } finally {
      setBusy(false);
      setDeletePassword('');
    }
  }

  async function restoreSelected() {
    if (!selected || busy || environment?.environment !== 'production') return;
    if (!window.confirm(`恢复租户“${selected.name}” (${selected.tenant_code})？订阅有效期不会延长，邮件不会重新发送。`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.restoreTenant(selected.tenant_code);
      await load();
      setNotice(`租户 ${selected.tenant_code} 已恢复；订阅仍按原有效期判断。`);
    } catch (caught) {
      setError(message(caught));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const environmentLabel = environment?.environment === 'production' ? 'Production'
    : environment?.environment === 'staging' ? 'Staging' : '环境未知';
  const pending = selected?.status === 'pending_delete';
  const expired = pending && selected?.purge_after
    ? new Date(selected.purge_after).getTime() <= Date.now() : false;
  const cleanupState = selected ? stagingCleanupState(selected, now) : null;

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

      <section className="mt-5 rounded-lg border border-slate-700 bg-slate-900 p-4" aria-label="当前邮件发信模式">
        <h2 className="text-sm font-semibold text-slate-200">当前邮件发信模式</h2>
        <p className="mt-1 text-lg font-semibold" data-testid="platform-mail-mode">
          {mailMode === 'mock'
            ? '模拟发信（mock）'
            : mailMode === 'oci_email_delivery_https'
              ? '真实发信（OCI）'
              : '状态未知'}
        </p>
        <p className="mt-1 text-xs text-slate-400">当前后端的邮件提交模式；不代表单封邮件已送达。</p>
      </section>

      <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4" aria-label="服务端环境">
        <h2 className="text-sm font-semibold text-slate-200">服务端环境</h2>
        <p className="mt-1 text-lg font-semibold">{environmentLabel}</p>
        {!environment?.deletion_enabled ? <p className="text-xs text-amber-200">当前环境未开放租户删除。</p> : null}
      </section>

      {error ? (
        <div className="mt-5 rounded-md border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {notice ? <p role="status" className="mt-5 rounded-md border border-emerald-700 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">{notice}</p> : null}

      {created ? (
        <section className="mt-5 rounded-lg border border-amber-500 bg-amber-950/40 p-5">
          <h2 className="font-semibold text-amber-200">一次性临时凭据</h2>
          <p className="mt-2 text-sm text-amber-100">
            仅通过已批准的安全渠道交付。关闭此区域后无法从控制台再次读取。
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">租户名称</dt><dd>{created.initialName}</dd></div>
            <div><dt className="text-slate-400">tenant_code</dt><dd className="font-mono">{created.tenant.tenant_code}</dd></div>
            <div><dt className="text-slate-400">tenant_manager 邮箱</dt><dd className="break-all">{created.managerEmail}</dd></div>
            <div><dt className="text-slate-400">临时密码</dt><dd data-testid="temporary-password" className="break-all font-mono">{created.tenant.temporary_password}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-amber-100">
            CSV 包含明文临时密码；请安全保存，交付后及时删除。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadTenantProvisioningCsv({
                tenantName: created.initialName,
                tenantCode: created.tenant.tenant_code,
                managerEmail: created.managerEmail,
                temporaryPassword: created.tenant.temporary_password,
              })}
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"
            >
              下载创建信息 CSV
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="rounded-md bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950"
            >
              我已安全保存，清除显示
            </button>
          </div>
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
                <div><dt className="text-slate-400">租户状态</dt><dd>{selected.status}</dd></div>
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
                    <button key={next} disabled={busy || selected.status === 'pending_delete' || selected.status === 'purged' || selected.status === 'staging_deleting' || selected.subscription?.status === next} onClick={() => void changeSubscription(next)} className="rounded-md border border-slate-600 px-3 py-2 text-sm disabled:opacity-40">{next}</button>
                  ))}
                </div>
              </div>
              <section className="rounded-md border border-rose-800 p-4" aria-label="租户删除与恢复">
                <h3 className="font-medium text-rose-200">租户删除与恢复</h3>
                {pending && environment?.environment === 'production' ? (
                  <p className="mt-2 text-sm text-amber-200">
                    已暂停新业务。恢复截止：{selected.purge_after ? new Date(selected.purge_after).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }) + ' JST' : '未知'}。
                    {expired ? ' 期限已到，不可恢复；等待终结清理。' : ' 截止前可恢复；最终以服务端数据库时间判定。'}
                  </p>
                ) : null}
                {selected.status === 'purged' ? <p className="mt-2 text-sm text-slate-300">已终结清理，不能恢复或重新用于业务。</p> : null}
                {cleanupState === 'in_progress' ? <p role="status" className="mt-2 text-sm text-amber-200">删除中：最近的清理请求已启动，目标已禁止访问。请刷新状态等待结果。</p> : null}
                {cleanupState === 'failed' ? <p role="alert" className="mt-2 text-sm text-rose-200">删除失败：清理事务未完成，目标仍禁止访问。检查故障后重新验密重试。</p> : null}
                {cleanupState === 'unknown' ? <p role="status" className="mt-2 text-sm text-amber-200">删除结果未确认：最近请求可能中断或超时，目标仍禁止访问。请核对后重新验密重试。</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {cleanupState ? <button type="button" disabled={busy} onClick={() => void load()} className="rounded-md border border-slate-600 px-3 py-2 text-sm disabled:opacity-50">刷新删除状态</button> : null}
                  {environment?.deletion_enabled && selected.subscription?.status !== 'active' && !pending && selected.status !== 'purged' && cleanupState !== 'in_progress' ? (
                    <button type="button" disabled={busy} onClick={() => { setDeleteTarget(selected); setDeletePassword(''); setDeleteError(''); setError(''); }} className="rounded-md border border-rose-500 px-3 py-2 text-sm text-rose-100 disabled:opacity-50">
                      {selected.status === 'staging_deleting' ? '重试清理' : '删除租户'}
                    </button>
                  ) : null}
                  {pending && environment?.environment === 'production' && !expired ? (
                    <button type="button" disabled={busy} onClick={() => void restoreSelected()} className="rounded-md border border-amber-500 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">恢复租户</button>
                  ) : null}
                </div>
                {selected.subscription?.status === 'active' ? <p className="mt-2 text-xs text-slate-400">订阅处于 active 状态，不能删除。</p> : null}
              </section>
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
      {deleteTarget ? (
        <div role="dialog" aria-modal="true" aria-label="确认删除租户" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <form onSubmit={(event) => void confirmDeletion(event)} className="w-full max-w-lg rounded-lg border border-rose-600 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-rose-200">确认删除租户</h2>
            <p className="mt-3 text-sm">租户：{deleteTarget.name}</p>
            <p className="mt-1 text-sm">tenant_code：<span className="font-mono">{deleteTarget.tenant_code}</span></p>
            <p className="mt-1 text-sm">服务端环境：{environmentLabel}</p>
            <p className="mt-3 text-sm text-amber-200">
              {environment?.environment === 'production'
                ? '删除后立即暂停新扫码和发信。现存记录在一年恢复期内冻结日常到期清理；截止前可恢复，恢复后超期记录立即重新进入清理队列。到期后销毁在线扫码、邮件和租户审计记录，并仅保留基本数据的非 PII 墓碑。'
                : 'Staging 会立即清理全部在线租户数据和历史，无法恢复。清理失败时保持不可访问，可重新验密重试。'}
            </p>
            <label className="mt-4 block text-sm">当前平台管理员密码
              <input aria-label="删除确认密码" type="password" autoComplete="off" value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)} required autoFocus
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2" />
            </label>
            {deleteError ? <p role="alert" className="mt-3 text-sm text-rose-200">{deleteError}</p> : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError(''); }} className="rounded-md border border-slate-600 px-3 py-2 text-sm">取消</button>
              <button type="submit" disabled={busy || !deletePassword} className="rounded-md bg-rose-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">确认删除</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
