export type ApiClientConfig = {
  baseUrl?: string;
};

export type LoginRequest = {
  tenant_code: string;
  identifier: string;
  password: string;
};

export type LoginResponse = {
  expires_in: number;
  user: {
    user_id: string;
    tenant_code: string;
    username: string | null;
    email: string | null;
    role: string;
  };
};

export type LicenseCheck = {
  status: 'trial' | 'active' | 'expired' | 'suspended' | string;
  plan: string;
  end_at: string;
  expired_at: string;
  grace_period: null | string;
  can_send: boolean;
};

export type LocationItem = {
  location_id: string;
  location_code: string;
  location_name: string;
  type: string;
  is_active: boolean;
};

export type PersonMapping = {
  person_id: string;
  person_code: string;
  person_name: string;
  scan_code: string;
  email_masked: string;
  is_active: boolean;
};

export type PersonMappingDetail = PersonMapping & { location_id: string; email: string };
export type PersonMappingInput = {
  person_name: string;
  email: string;
  status?: 'active' | 'inactive';
};
export type LocationInput = {
  location_name: string;
};
export type AuditLogItem = {
  audit_log_id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  result: string;
  metadata: unknown;
  created_at: string;
};
export type AuditLogResponse = { items: AuditLogItem[]; next_cursor: string | null };

export type ScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  mail_subject: string;
  person_code: string;
  action: 'entry' | 'exit';
  action_source: ScanActionSource;
  status: Extract<MailJobStatus, 'queued' | 'processing' | 'sent' | 'failed'>;
  retry_count: number;
  scheduled_at: string | null;
  error_message: string | null;
  deduplicated: boolean;
};

export type MailJobStatus = 'unmapped' | 'queued' | 'processing' | 'sent' | 'failed';
export type ScanAction = 'entry' | 'exit' | 'unknown';
export type ScanActionSource =
  | 'person_action_code'
  | 'manual_adjustment'
  | 'legacy_unknown';

export type ScanHistoryItem = {
  scan_event_id: string;
  location_id: string | null;
  location_name: string | null;
  person_code: string | null;
  person_name: string | null;
  scan_code: string;
  scan_type: string;
  action: ScanAction;
  action_source: ScanActionSource;
  received_at: string;
  status: MailJobStatus;
  mail_job: null | {
    mail_job_id: string;
    status: string;
    action: ScanAction;
    sent_at: string | null;
    error_message: string | null;
  };
};

export type ScanHistoryResponse = {
  items: ScanHistoryItem[];
  next_cursor: string | null;
};

export type SendMailJobResponse = {
  mail_job_id: string;
  status: Extract<MailJobStatus, 'sent' | 'failed'>;
  provider_result: {
    provider: string;
    success: boolean;
    provider_message_id?: string;
    error_message?: string;
  };
};

export type MeResponse = { user: LoginResponse['user'] };

export type ManagedOperator = {
  user_id: string;
  username: string;
  email: string | null;
  role: 'operator';
  status: 'active' | 'inactive' | string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateOperatorInput = {
  username: string;
  email?: string | null;
  password: string;
  role: 'operator';
};

export type UpdateOperatorInput = {
  username?: string;
  email?: string | null;
  status?: 'active' | 'inactive';
  role?: 'operator';
};

type RequestOptions = {
  token?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  retry?: boolean;
  headers?: Record<string, string>;
};

export type UnmappedScanCase = {
  case_id: string;
  scan_event_id: string;
  location_id: string | null;
  location_name: string | null;
  location_active: boolean;
  scan_code: string;
  received_at: string;
  status: 'open' | 'resolved' | 'ignored';
  handled_by_user_id: string | null;
  handled_at: string | null;
  mapping_prefill_allowed: boolean;
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiNetworkError extends ApiError {
  constructor(baseUrl: string) {
    super(
      `无法连接后端 API（${baseUrl}）。请确认后端服务已启动，并且 CORS_ORIGIN 允许当前前端地址。`,
      0,
      'NETWORK_ERROR',
    );
    this.name = 'ApiNetworkError';
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, '');
}

function toErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const message = record.message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(', ');
  }
  if (typeof record.error === 'string') {
    return record.error;
  }

  return fallback;
}

export function isSendAllowed(license: LicenseCheck | null) {
  return license?.can_send === true;
}

export function mailStatusLabel(status: MailJobStatus) {
  const labels: Record<MailJobStatus, string> = {
    unmapped: '未映射',
    queued: '发送中',
    processing: '发送中',
    sent: '已发送',
    failed: '发送失败',
  };

  return labels[status];
}

export function scanActionLabel(action: ScanAction) {
  return {
    entry: '进入',
    exit: '离开',
    unknown: '动作未知',
  }[action];
}

export function createScanEventBody(locationId: string, scanCode: string) {
  return {
    location_id: locationId,
    scan_code: scanCode,
  };
}

export function createApiClient(config: ApiClientConfig = {}) {
  const baseUrl = normalizeBaseUrl(
    config.baseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  );

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'include',
      });
    } catch {
      throw new ApiNetworkError(baseUrl);
    }

    if (
      response.status === 401 &&
      options.retry !== false &&
      path !== '/api/auth/login' &&
      path !== '/api/auth/refresh' &&
      path !== '/api/auth/logout'
    ) {
      const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (refreshed.ok) return request<T>(path, { ...options, retry: false });
    }

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      const fallback = response.status === 401 ? '登录已失效，请重新登录' : '请求失败';
      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
      const code = typeof record?.code === 'string' ? record.code : undefined;
      throw new ApiError(toErrorMessage(payload, fallback), response.status, code);
    }

    return payload as T;
  }

  async function download(path: string, filename: string) {
    let response = await fetch(`${baseUrl}${path}`, { credentials: 'include' });
    if (response.status === 401) {
      const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (refreshed.ok) response = await fetch(`${baseUrl}${path}`, { credentials: 'include' });
    }
    if (!response.ok) throw new ApiError('导出失败', response.status);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return {
    baseUrl,
    login: (body: LoginRequest) =>
      request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body,
      }),
    getLicense: (token: string) => request<LicenseCheck>('/api/license/check', { token }),
    getLocations: (token: string) => request<LocationItem[]>('/api/locations', { token }),
    getPeople: (token: string, locationId: string) =>
      request<PersonMapping[]>(`/api/locations/${encodeURIComponent(locationId)}/people`, { token }),
    getPerson: (locationId: string, personId: string) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}`),
    createPerson: (locationId: string, body: PersonMappingInput) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people`, { method: 'POST', body }),
    updatePerson: (locationId: string, personId: string, body: Partial<PersonMappingInput>) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}`, { method: 'PATCH', body }),
    deactivatePerson: (locationId: string, personId: string) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}`, { method: 'DELETE' }),
    reactivatePerson: (locationId: string, personId: string) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}/reactivate`, { method: 'POST' }),
    createLocation: (body: LocationInput) => request<LocationItem>('/api/locations', { method: 'POST', body }),
    updateLocation: (locationId: string, body: Partial<LocationInput>) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}`, { method: 'PATCH', body }),
    deactivateLocation: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}`, { method: 'DELETE' }),
    reactivateLocation: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}/reactivate`, { method: 'POST' }),
    getAuditLogs: (params = '') => request<AuditLogResponse>(`/api/audit-logs${params ? `?${params}` : ''}`),
    getUnmappedScans: (params = '') =>
      request<UnmappedScanCase[]>(`/api/unmapped-scans${params ? `?${params}` : ''}`),
    updateUnmappedScan: (caseId: string, status: 'resolved' | 'ignored') =>
      request<UnmappedScanCase>(`/api/unmapped-scans/${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: { status },
      }),
    exportAuditLogs: (params: string) => download(`/api/audit-logs/export?${params}`, 'audit-logs.csv'),
    exportScanEvents: (params: string) => download(`/api/scan-events/export?${params}`, 'scan-events.csv'),
    exportMailJobs: (params: string) => download(`/api/mail-jobs/export?${params}`, 'mail-jobs.csv'),
    createScanEvent: (
      token: string,
      locationId: string,
      scanCode: string,
      idempotencyKey = crypto.randomUUID(),
    ) =>
      request<ScanEventResponse>('/api/scan-events', {
        method: 'POST',
        token,
        body: createScanEventBody(locationId, scanCode),
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    refresh: () => request<LoginResponse>('/api/auth/refresh', { method: 'POST', retry: false }),
    logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST', retry: false }),
    getMe: () => request<MeResponse>('/api/auth/me'),
    getUsers: () => request<ManagedOperator[]>('/api/users'),
    createUser: (body: CreateOperatorInput) =>
      request<ManagedOperator>('/api/users', { method: 'POST', body }),
    updateUser: (userId: string, body: UpdateOperatorInput) =>
      request<ManagedOperator>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body }),
    resetUserPassword: (userId: string, newPassword: string) =>
      request<{ user_id: string; status: string }>(
        `/api/users/${encodeURIComponent(userId)}/password`,
        { method: 'POST', body: { new_password: newPassword } },
      ),
    getScanHistory: (token: string, locationId: string, limit = 50) =>
      request<ScanHistoryResponse>(
        `/api/scan-events?location_id=${encodeURIComponent(locationId)}&limit=${limit}`,
        { token },
      ),
  };
}
