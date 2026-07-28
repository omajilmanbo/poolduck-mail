'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  LicenseCheck,
  LocationItem,
  MailJobStatus,
  PersonMapping,
  ScanAction,
  ScanActionSource,
  ScanHistoryItem,
  createApiClient,
  isSendAllowed,
  mailStatusLabel,
  scanActionLabel,
} from '../src/api/client';

const HISTORY_POLL_INTERVAL_MS = 2_000;
const HISTORY_MAX_POLL_ATTEMPTS = 10;

type UserSummary = {
  username: string | null;
  email: string | null;
  role: string;
};

type ScanRecord = {
  scanEventId: string;
  mailJobId: string | null;
  mailSubject?: string;
  status: MailJobStatus;
  scanCode: string;
  action: ScanAction;
  actionSource: ScanActionSource;
  personName: string;
  receivedAt: string;
  providerMessage?: string;
};

export function historyItemToRecord(item: ScanHistoryItem): ScanRecord {
  return {
    scanEventId: item.scan_event_id,
    mailJobId: item.mail_job?.mail_job_id ?? null,
    status: item.status,
    scanCode: item.scan_code,
    action: item.action,
    actionSource: item.action_source,
    personName: item.person_name ?? '-',
    receivedAt: item.received_at,
    providerMessage: item.mail_job?.error_message ?? undefined,
  };
}

export function shouldPollHistory(records: ScanRecord[], attempts: number) {
  return (
    attempts < HISTORY_MAX_POLL_ATTEMPTS &&
    records.some(
      (record) => record.status === 'queued' || record.status === 'processing',
    )
  );
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFriendlyError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '请求失败';
}

export default function HomePage() {
  const api = useMemo(() => createApiClient(), []);
  const [token, setToken] = useState('');
  const [user, setUser] = useState<UserSummary | null>(null);
  const [tenantCode, setTenantCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [license, setLicense] = useState<LicenseCheck | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [people, setPeople] = useState<PersonMapping[]>([]);
  const [scanCode, setScanCode] = useState('');
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPollAttempts, setHistoryPollAttempts] = useState(0);

  const canSend = isSendAllowed(license);
  const selectedLocation = locations.find((location) => location.location_id === selectedLocationId);

  const clearSession = useCallback(
    (message?: string) => {
      setToken('');
      setUser(null);
      setLicense(null);
      setLocations([]);
      setSelectedLocationId('');
      setPeople([]);
      setRecords([]);
      setWorkspaceError(message ?? '');
    },
    [],
  );

  const loadWorkspace = useCallback(
    async (accessToken: string) => {
      setWorkspaceLoading(true);
      setWorkspaceError('');

      try {
        const [licenseResponse, locationResponse] = await Promise.all([
          api.getLicense(accessToken),
          api.getLocations(accessToken),
        ]);
        setLicense(licenseResponse);
        const activeLocations = locationResponse.filter((location) => location.is_active);
        setLocations(activeLocations);
        setSelectedLocationId((current) => {
          if (current && activeLocations.some((location) => location.location_id === current)) {
            return current;
          }
          return activeLocations[0]?.location_id ?? '';
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearSession('登录已失效，请重新登录');
          return;
        }
        setWorkspaceError(getFriendlyError(error));
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [api, clearSession],
  );

  const loadHistory = useCallback(
    async (accessToken: string, locationId: string, background = false) => {
      if (!background) {
        setHistoryLoading(true);
        setWorkspaceError('');
      }
      try {
        const response = await api.getScanHistory(accessToken, locationId);
        setRecords(response.items.map(historyItemToRecord));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearSession('登录已失效，请重新登录');
          return;
        }
        setWorkspaceError(getFriendlyError(error));
      } finally {
        if (!background) {
          setHistoryLoading(false);
        }
      }
    },
    [api, clearSession],
  );

  useEffect(() => {
    api.getMe().then((response) => {
      const session = 'cookie-session';
      setToken(session);
      setUser({
        username: response.user.username,
        email: response.user.email,
        role: response.user.role,
      });
      void loadWorkspace(session);
    }).catch(() => clearSession());
  }, [api, clearSession, loadWorkspace]);

  useEffect(() => {
    if (!token || !selectedLocationId) {
      setPeople([]);
      return;
    }

    let cancelled = false;
    setWorkspaceError('');

    api
      .getPeople(token, selectedLocationId)
      .then((peopleResponse) => {
        if (!cancelled) {
          setPeople(peopleResponse);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          clearSession('登录已失效，请重新登录');
          return;
        }
        setPeople([]);
        setWorkspaceError(getFriendlyError(error));
      });

    return () => {
      cancelled = true;
    };
  }, [api, clearSession, selectedLocationId, token]);

  useEffect(() => {
    if (!token || !selectedLocationId) {
      setRecords([]);
      return;
    }
    setHistoryPollAttempts(0);
    void loadHistory(token, selectedLocationId);
  }, [loadHistory, selectedLocationId, token]);

  useEffect(() => {
    if (
      !token ||
      !selectedLocationId ||
      !shouldPollHistory(records, historyPollAttempts)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHistoryPollAttempts((current) => current + 1);
      void loadHistory(token, selectedLocationId, true);
    }, HISTORY_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [historyPollAttempts, loadHistory, records, selectedLocationId, token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const response = await api.login({
        tenant_code: tenantCode.trim().toUpperCase(),
        identifier: identifier.trim(),
        password,
      });
      const session = 'cookie-session';
      setToken(session);
      setUser({
        username: response.user.username,
        email: response.user.email,
        role: response.user.role,
      });
      setPassword('');
      await loadWorkspace(session);
    } catch (error) {
      setLoginError(getFriendlyError(error));
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedLocation || !scanCode.trim() || !canSend) {
      return;
    }

    setScanLoading(true);
    setWorkspaceError('');

    try {
      const response = await api.createScanEvent(token, selectedLocation.location_id, scanCode.trim());
      setRecords((current) => [
        {
          scanEventId: response.scan_event_id,
          mailJobId: response.mail_job_id,
          mailSubject: response.mail_subject,
          status: response.status,
          scanCode: response.person_code,
          action: response.action,
          actionSource: response.action_source,
          personName:
            people.find((person) => person.person_code === response.person_code)
              ?.person_name ?? '-',
          receivedAt: new Date().toISOString(),
          providerMessage: response.error_message ?? undefined,
        },
        ...current,
      ]);
      setHistoryPollAttempts(0);
      setScanCode('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession('登录已失效，请重新登录');
        return;
      }
      setWorkspaceError(getFriendlyError(error));
      await loadHistory(token, selectedLocation.location_id, true);
    } finally {
      setScanLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-stone-100 text-slate-950">
        <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px]">
            <div className="self-center">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Poolduck Mail</p>
              <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight">扫码邮件工作台</h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
                本地 MVP 黑盒验证入口，连接后端 sandbox provider，完成登录、location 选择、扫码记录和邮件发送触发。
              </p>
            </div>

            <form onSubmit={handleLogin} className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold">登录</h2>
                <p className="mt-1 text-sm text-slate-500">API: {api.baseUrl}</p>
              </div>

              <label className="mb-4 block text-sm font-medium">
                tenant_code
                <input
                  data-testid="tenant-code-input"
                  name="organization"
                  autoCapitalize="characters"
                  autoComplete="organization"
                  maxLength={10}
                  pattern="[0-9A-HJKMNP-TV-Z]{10}"
                  placeholder="例如：10CA000001"
                  value={tenantCode}
                  onChange={(event) =>
                    setTenantCode(event.target.value.toUpperCase())
                  }
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  required
                />
              </label>

              <label className="mb-4 block text-sm font-medium">
                用户名/邮箱
                <input
                  data-testid="identifier-input"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  required
                />
              </label>

              <label className="mb-5 block text-sm font-medium">
                password
                <input
                  data-testid="password-input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  required
                />
              </label>

              {loginError ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {loginError}
                </div>
              ) : null}

              <button
                data-testid="login-submit"
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loginLoading ? '登录中' : '进入工作台'}
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Poolduck Mail</p>
            <h1 className="text-2xl font-semibold">扫码工作台</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">
              {user?.username ?? user?.email ?? '已登录'}
            </span>
            <a href="/people" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">
              人员管理
            </a>
            <a href="/unmapped" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">
              未映射扫码
            </a>
            {user?.role === 'tenant_manager' ? (
              <>
                <a href="/users" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">用户管理</a>
                <a href="/locations" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">地点管理</a>
                <a href="/audit" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">审计</a>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void api.logout().finally(() => clearSession())}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">订阅状态</h2>
                <p className="mt-1 text-sm text-slate-500">{license?.plan ?? '-'}</p>
              </div>
              <span
                data-testid="license-status"
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  canSend ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                }`}
              >
                {license?.status ?? 'loading'}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">can_send</dt>
                <dd className="font-semibold">{canSend ? 'true' : 'false'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <label className="block text-sm font-semibold">
              location
              <select
                data-testid="location-select"
                value={selectedLocationId}
                onChange={(event) => setSelectedLocationId(event.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              >
                {locations.map((location) => (
                  <option key={location.location_id} value={location.location_id}>
                    {location.location_name} / {location.location_code}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold">人员映射</h2>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 py-2 pr-2">姓名</th>
                    <th className="border-b border-slate-200 py-2 pr-2">扫码</th>
                    <th className="border-b border-slate-200 py-2">邮箱</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.person_id}>
                      <td className="border-b border-slate-100 py-2 pr-2">{person.person_name}</td>
                      <td className="border-b border-slate-100 py-2 pr-2 font-mono text-xs">{person.scan_code}</td>
                      <td className="border-b border-slate-100 py-2 text-xs">{person.email_masked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!people.length ? <p className="py-4 text-sm text-slate-500">暂无映射</p> : null}
            </div>
          </section>
        </aside>

        <section className="space-y-5">
          {workspaceError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {workspaceError}
            </div>
          ) : null}

          <form onSubmit={handleScan} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex-1 text-sm font-semibold">
                人员动作码
                <input
                  data-testid="scan-code-input"
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 font-mono text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  disabled={!canSend || workspaceLoading}
                  autoFocus
                  placeholder="PD1|ENTRY|<person_code> 或 PD1|EXIT|<person_code>"
                />
              </label>
              <button
                data-testid="scan-submit"
                type="submit"
                disabled={!canSend || !selectedLocationId || !scanCode.trim() || scanLoading || workspaceLoading}
                className="rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {scanLoading ? '提交中' : '提交扫码'}
              </button>
            </div>
            {!canSend ? (
              <p className="mt-3 text-sm text-red-700">订阅状态不可发送，扫码与发送入口已禁用。</p>
            ) : null}
          </form>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold">扫码记录</h2>
              {user?.role === 'tenant_manager' && selectedLocationId ? (
                <div className="flex gap-2">
                  <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs" onClick={() => {
                    const to = new Date();
                    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
                    const params = new URLSearchParams({ created_from: from.toISOString(), created_to: to.toISOString(), location_id: selectedLocationId });
                    void api.exportScanEvents(params.toString());
                  }}>导出扫描</button>
                  <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs" onClick={() => {
                    const to = new Date();
                    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
                    const params = new URLSearchParams({ created_from: from.toISOString(), created_to: to.toISOString(), location_id: selectedLocationId });
                    void api.exportMailJobs(params.toString());
                  }}>导出邮件</button>
                </div>
              ) : null}
              <button
                type="button"
                data-testid="history-refresh"
                disabled={historyLoading || !selectedLocationId}
                onClick={() => {
                  setHistoryPollAttempts(0);
                  void loadHistory(token, selectedLocationId);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {historyLoading ? '加载中' : '刷新'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table aria-label="扫码记录" className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">人员名称</th>
                    <th className="px-4 py-3">scan_code</th>
                    <th className="px-4 py-3">动作</th>
                    <th className="px-4 py-3">时间</th>
                    <th className="px-4 py-3">mail_job</th>
                    <th className="px-4 py-3">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.scanEventId}>
                      <td className="border-t border-slate-100 px-4 py-3">{record.personName}</td>
                      <td className="border-t border-slate-100 px-4 py-3 font-mono text-xs">{record.scanCode}</td>
                      <td className="border-t border-slate-100 px-4 py-3">
                        <span
                          data-testid="scan-action"
                          title={record.actionSource}
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            record.action === 'entry'
                              ? 'bg-sky-100 text-sky-800'
                              : record.action === 'exit'
                                ? 'bg-violet-100 text-violet-800'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {scanActionLabel(record.action)}
                        </span>
                      </td>
                      <td className="border-t border-slate-100 px-4 py-3 text-xs">{formatDateTime(record.receivedAt)}</td>
                      <td className="border-t border-slate-100 px-4 py-3">
                        <div className="font-mono text-xs">{record.mailJobId ?? '-'}</div>
                        {record.mailSubject ? (
                          <div className="mt-1 max-w-md truncate text-xs text-slate-500">{record.mailSubject}</div>
                        ) : null}
                        {record.providerMessage ? (
                          <div className="mt-1 max-w-md truncate text-xs text-slate-500">{record.providerMessage}</div>
                        ) : null}
                      </td>
                      <td className="border-t border-slate-100 px-4 py-3">
                        <span
                          data-testid="mail-status"
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            record.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800'
                              : record.status === 'failed' || record.status === 'unmapped'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {mailStatusLabel(record.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.length ? (
                <p className="px-4 py-8 text-sm text-slate-500">
                  {historyLoading ? '正在加载扫码记录…' : '暂无扫码记录'}
                </p>
              ) : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
