'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  LicenseCheck,
  LocationItem,
  MailJobStatus,
  PersonMapping,
  ScanAction,
  ScanActionSource,
  ScanHistoryItem,
  ScanHistoryQuery,
  createApiClient,
  isSendAllowed,
  mailStatusLabel,
  scanActionLabel,
} from '../src/api/client';

const HISTORY_POLL_INTERVAL_MS = 2_000;
const HISTORY_MAX_POLL_ATTEMPTS = 10;
const HISTORY_PAGE_SIZE = 25;

function dateBoundary(value: string, endOfDay: boolean) {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).toISOString();
}

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
  canCancel: boolean;
  cancelUntil: string | null;
  canceledAt: string | null;
  effectiveStatus: 'active' | 'canceled';
  serverOffsetMs: number;
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
    canCancel: item.can_cancel,
    cancelUntil: item.cancel_until,
    canceledAt: item.canceled_at,
    effectiveStatus: item.effective_status,
    serverOffsetMs: new Date(item.server_time).getTime() - Date.now(),
  };
}

export function shouldPollHistory(records: ScanRecord[], attempts: number) {
  return (
    attempts < HISTORY_MAX_POLL_ATTEMPTS &&
    records.some(
      (record) =>
        record.status === 'waiting' ||
        record.status === 'queued' ||
        record.status === 'processing',
    )
  );
}

export function cancellationSecondsRemaining(
  cancelUntil: string | null,
  serverOffsetMs: number,
  clientNowMs = Date.now(),
) {
  if (!cancelUntil) return 0;
  return Math.max(
    0,
    Math.ceil(
      (new Date(cancelUntil).getTime() - (clientNowMs + serverOffsetMs)) /
        1_000,
    ),
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
  const [historyError, setHistoryError] = useState('');
  const [historyStatus, setHistoryStatus] = useState<MailJobStatus | ''>('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyCursors, setHistoryCursors] = useState<Array<string | null>>([null]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyPollAttempts, setHistoryPollAttempts] = useState(0);
  const [cancelingScanEventId, setCancelingScanEventId] = useState('');
  const [clockTick, setClockTick] = useState(0);
  const historyRequestId = useRef(0);

  const canSend = isSendAllowed(license);
  const selectedLocation = locations.find((location) => location.location_id === selectedLocationId);
  const historyDateError = historyFrom && historyTo && historyFrom > historyTo
    ? '起始日期不能晚于结束日期'
    : '';
  const historyQuery = useMemo<ScanHistoryQuery>(() => ({
    cursor: historyCursors[historyPage],
    status: historyStatus || undefined,
    createdFrom: dateBoundary(historyFrom, false),
    createdTo: dateBoundary(historyTo, true),
  }), [historyCursors, historyPage, historyStatus, historyFrom, historyTo]);

  const resetHistoryPage = useCallback(() => {
    setHistoryPage(0);
    setHistoryCursors([null]);
    setHistoryNextCursor(null);
    setHistoryPollAttempts(0);
  }, []);

  useEffect(() => {
    if (!records.some((record) => record.status === 'waiting')) return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [records]);

  const clearSession = useCallback(
    (message?: string) => {
      setToken('');
      setUser(null);
      setLicense(null);
      setLocations([]);
      setSelectedLocationId('');
      setPeople([]);
      setRecords([]);
      historyRequestId.current += 1;
      setHistoryError('');
      resetHistoryPage();
      setWorkspaceError(message ?? '');
    },
    [resetHistoryPage],
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
    async (accessToken: string, locationId: string, query: ScanHistoryQuery, background = false) => {
      const requestId = ++historyRequestId.current;
      if (!background) {
        setHistoryLoading(true);
      }
      setHistoryError('');
      try {
        const response = await api.getScanHistory(accessToken, locationId, query);
        if (requestId !== historyRequestId.current) return;
        setRecords(response.items.slice(0, HISTORY_PAGE_SIZE).map(historyItemToRecord));
        setHistoryNextCursor(response.next_cursor);
      } catch (error) {
        if (requestId !== historyRequestId.current) return;
        if (error instanceof ApiError && error.status === 401) {
          clearSession('登录已失效，请重新登录');
          return;
        }
        setHistoryError(error instanceof ApiError && [403, 404].includes(error.status)
          ? '无权限查看此地点的扫码记录'
          : getFriendlyError(error));
      } finally {
        if (!background && requestId === historyRequestId.current) {
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
      historyRequestId.current += 1;
      setRecords([]);
      setHistoryNextCursor(null);
      setHistoryError('');
      return;
    }
    historyRequestId.current += 1;
    setRecords([]);
    setHistoryNextCursor(null);
    setHistoryPollAttempts(0);
    if (historyDateError) {
      setHistoryError(historyDateError);
      setHistoryLoading(false);
      return;
    }
    void loadHistory(token, selectedLocationId, historyQuery);
    return () => { historyRequestId.current += 1; };
  }, [historyDateError, historyQuery, historyRefreshKey, loadHistory, selectedLocationId, token]);

  useEffect(() => {
    if (
      !token ||
      !selectedLocationId ||
      historyLoading ||
      !shouldPollHistory(records, historyPollAttempts)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHistoryPollAttempts((current) => current + 1);
      void loadHistory(token, selectedLocationId, historyQuery, true);
    }, HISTORY_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [historyLoading, historyPollAttempts, historyQuery, loadHistory, records, selectedLocationId, token]);

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
      if (response.user.must_change_password) {
        setPassword('');
        window.location.assign('/change-password');
        return;
      }
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
      await api.createScanEvent(token, selectedLocation.location_id, scanCode);
      setHistoryStatus('');
      setHistoryFrom('');
      setHistoryTo('');
      resetHistoryPage();
      setHistoryRefreshKey((current) => current + 1);
      setScanCode('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession('登录已失效，请重新登录');
        return;
      }
      setWorkspaceError(getFriendlyError(error));
      await loadHistory(token, selectedLocation.location_id, historyQuery, true);
    } finally {
      setScanLoading(false);
    }
  }

  async function handleCancel(record: ScanRecord) {
    if (!token || !record.canCancel || record.status !== 'waiting') return;
    setCancelingScanEventId(record.scanEventId);
    setWorkspaceError('');
    try {
      const response = await api.cancelScanEvent(token, record.scanEventId);
      setRecords((current) => current.map((item) =>
        item.scanEventId === record.scanEventId
          ? {
              ...item,
              status: response.mail_status,
              effectiveStatus: response.effective_status,
              canCancel: false,
              canceledAt: response.canceled_at,
              serverOffsetMs: new Date(response.server_time).getTime() - Date.now(),
            }
          : item,
      ));
      if (selectedLocationId) void loadHistory(token, selectedLocationId, historyQuery, true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession('登录已失效，请重新登录');
        return;
      }
      setWorkspaceError(
        error instanceof ApiError && error.status === 409
          ? '取消窗口已结束或发送已开始，正在刷新权威状态。'
          : '取消结果未知，正在刷新权威状态。',
      );
      if (selectedLocationId) await loadHistory(token, selectedLocationId, historyQuery, true);
    } finally {
      setCancelingScanEventId('');
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
              <a href="/help" target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex rounded-md border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                使用手册（新标签页）
              </a>
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Poolduck Mail</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="text-2xl font-semibold">扫码工作台</h1>
              <a href="/help" target="_blank" rel="noopener noreferrer" className="rounded-md border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                使用手册
              </a>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">
              {user?.username ?? user?.email ?? '已登录'}
            </span>
            <a href="/people" className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">
              人员管理
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
                onChange={(event) => {
                  setSelectedLocationId(event.target.value);
                  resetHistoryPage();
                }}
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
                  placeholder="E<person_code> 或 X<person_code>"
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
                  if (!historyDateError) void loadHistory(token, selectedLocationId, historyQuery);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {historyLoading ? '加载中' : '刷新'}
              </button>
            </div>
            <div className="grid gap-3 border-b border-slate-200 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
              <label className="text-sm font-medium">邮件状态
                <select data-testid="history-status-filter" value={historyStatus} onChange={(event) => {
                  setHistoryStatus(event.target.value as MailJobStatus | '');
                  resetHistoryPage();
                }} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2">
                  <option value="">全部状态</option>
                  {(['waiting', 'queued', 'processing', 'sent', 'failed', 'canceled', 'delivery_unknown'] as const).map((status) => (
                    <option key={status} value={status}>{mailStatusLabel(status)}（{status}）</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">起始日期
                <input data-testid="history-from-filter" type="date" value={historyFrom} onChange={(event) => {
                  setHistoryFrom(event.target.value);
                  resetHistoryPage();
                }} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-medium">结束日期
                <input data-testid="history-to-filter" type="date" value={historyTo} onChange={(event) => {
                  setHistoryTo(event.target.value);
                  resetHistoryPage();
                }} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <button type="button" data-testid="history-clear-filters" onClick={() => {
                setHistoryStatus('');
                setHistoryFrom('');
                setHistoryTo('');
                resetHistoryPage();
              }} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">清除筛选</button>
            </div>
            {historyError ? <p role="alert" className="px-4 py-3 text-sm text-red-700">{historyError}</p> : null}
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
                              : record.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {mailStatusLabel(record.status)}
                        </span>
                        <div className="mt-2">
                          {record.status === 'waiting' ? (() => {
                            const remaining = cancellationSecondsRemaining(
                              record.cancelUntil,
                              record.serverOffsetMs,
                            );
                            void clockTick;
                            return (
                              <button
                                type="button"
                                data-testid="scan-cancel"
                                disabled={!record.canCancel || remaining <= 0 || cancelingScanEventId === record.scanEventId}
                                onClick={() => void handleCancel(record)}
                                className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                              >
                                {cancelingScanEventId === record.scanEventId
                                  ? '取消中…'
                                  : remaining > 0
                                    ? `取消发送 (${remaining}s)`
                                    : '窗口已结束'}
                              </button>
                            );
                          })() : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.length && !historyError ? (
                <p className="px-4 py-8 text-sm text-slate-500">
                  {historyLoading ? '正在加载扫码记录…' : '暂无扫码记录'}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
              <button type="button" data-testid="history-previous" disabled={historyLoading || historyPage === 0} onClick={() => setHistoryPage((page) => page - 1)} className="rounded-md border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-400">上一页</button>
              <span>第 {historyPage + 1} 页 · 每页最多 {HISTORY_PAGE_SIZE} 条</span>
              <button type="button" data-testid="history-next" disabled={historyLoading || !!historyError || !historyNextCursor} onClick={() => {
                if (!historyNextCursor) return;
                setHistoryCursors((current) => [...current.slice(0, historyPage + 1), historyNextCursor]);
                setHistoryPage((page) => page + 1);
              }} className="rounded-md border border-slate-300 px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-400">下一页</button>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
