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
    must_change_password?: boolean;
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
  deletion_status?: 'scheduled' | null;
  deleted_at?: string | null;
  purge_after?: string | null;
};

export type PersonMapping = {
  person_id: string;
  person_code: string;
  person_name: string;
  scan_code: string;
  email_masked: string;
  is_active: boolean;
  deletion_status?: 'scheduled' | null;
  deleted_at?: string | null;
  purge_after?: string | null;
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
  status: MailJobStatus;
  effective_status: 'active' | 'canceled';
  mail_status: MailJobStatus;
  can_cancel: boolean;
  cancel_until: string | null;
  server_time: string;
  canceled_at: string | null;
  retry_count: number;
  scheduled_at: string | null;
  error_message: string | null;
  deduplicated: boolean;
};

export type MailJobStatus =
  | 'waiting'
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'canceled'
  | 'delivery_unknown';
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
  effective_status: 'active' | 'canceled';
  mail_status: MailJobStatus;
  can_cancel: boolean;
  cancel_until: string | null;
  server_time: string;
  canceled_at: string | null;
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

export type CancelScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  effective_status: 'canceled';
  mail_status: 'canceled';
  canceled_at: string;
  server_time: string;
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

export type PlatformAdminSummary = {
  platform_admin_id: string;
  email_masked: string;
  identity_version: number;
  session_id: string;
};

export type PlatformTenantSummary = {
  tenant_code: string;
  name: string;
  status: string;
  created_at: string;
  platform_version: number;
  location_limit: number;
  location_count: number;
  subscription: null | {
    plan: string;
    status: 'trial' | 'active' | 'expired' | 'suspended' | string;
    start_at: string;
    end_at: string;
    version: number;
  };
  manager: null | { email_masked: string | null; status: string };
  recent_platform_operation: null | {
    audit_id: string;
    created_at: string;
    result: string;
  };
};

export type CreatePlatformTenantInput = {
  name: string;
  manager_email: string;
  subscription_status: 'trial' | 'active';
  start_at: string;
  end_at: string;
  location_limit: number;
};

export type CreatedPlatformTenant = PlatformTenantSummary & {
  temporary_password: string;
  idempotency_replayed: boolean;
};

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

export type OperatorLocationAssignments = {
  operator_id: string;
  locations: LocationItem[];
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  retry?: boolean;
  headers?: Record<string, string>;
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
    waiting: '可取消等待中',
    queued: '发送中',
    processing: '发送中',
    sent: '已发送',
    failed: '发送失败',
    canceled: '已取消',
    delivery_unknown: '投递结果未知',
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
    getLocations: (token: string, includeDeleted = false) =>
      request<LocationItem[]>(
        `/api/locations${includeDeleted ? '?include_deleted=true' : ''}`,
        { token },
      ),
    getPeople: (token: string, locationId: string, includeDeleted = false) =>
      request<PersonMapping[]>(
        `/api/locations/${encodeURIComponent(locationId)}/people${includeDeleted ? '?include_deleted=true' : ''}`,
        { token },
      ),
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
    schedulePersonDeletion: (locationId: string, personId: string) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}/delete`, { method: 'POST' }),
    restorePerson: (locationId: string, personId: string) =>
      request<PersonMappingDetail>(`/api/locations/${encodeURIComponent(locationId)}/people/${encodeURIComponent(personId)}/restore`, { method: 'POST' }),
    createLocation: (body: LocationInput) => request<LocationItem>('/api/locations', { method: 'POST', body }),
    updateLocation: (locationId: string, body: Partial<LocationInput>) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}`, { method: 'PATCH', body }),
    deactivateLocation: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}`, { method: 'DELETE' }),
    reactivateLocation: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}/reactivate`, { method: 'POST' }),
    scheduleLocationDeletion: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}/delete`, { method: 'POST' }),
    restoreLocation: (locationId: string) =>
      request<LocationItem>(`/api/locations/${encodeURIComponent(locationId)}/restore`, { method: 'POST' }),
    getAuditLogs: (params = '') => request<AuditLogResponse>(`/api/audit-logs${params ? `?${params}` : ''}`),
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
    cancelScanEvent: (token: string, scanEventId: string) =>
      request<CancelScanEventResponse>(
        `/api/scan-events/${encodeURIComponent(scanEventId)}/cancel`,
        { token, method: 'POST' },
      ),
    refresh: () => request<LoginResponse>('/api/auth/refresh', { method: 'POST', retry: false }),
    logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST', retry: false }),
    getMe: () => request<MeResponse>('/api/auth/me'),
    changeInitialPassword: (newPassword: string) =>
      request<{ status: string; reauthentication_required: boolean }>(
        '/api/auth/change-initial-password',
        { method: 'POST', body: { new_password: newPassword } },
      ),
    getUsers: () => request<ManagedOperator[]>('/api/users'),
    createUser: (body: CreateOperatorInput) =>
      request<ManagedOperator>('/api/users', { method: 'POST', body }),
    updateUser: (userId: string, body: UpdateOperatorInput) =>
      request<ManagedOperator>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body }),
    getUserLocationAssignments: (userId: string) =>
      request<OperatorLocationAssignments>(
        `/api/users/${encodeURIComponent(userId)}/location-assignments`,
      ),
    setUserLocationAssignments: (userId: string, locationIds: string[]) =>
      request<OperatorLocationAssignments>(
        `/api/users/${encodeURIComponent(userId)}/location-assignments`,
        { method: 'PUT', body: { location_ids: locationIds } },
      ),
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

export function createPlatformApiClient(config: ApiClientConfig = {}) {
  const baseUrl = normalizeBaseUrl(
    config.baseUrl ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      'http://localhost:3001',
  );

  async function request<T>(
    path: string,
    options: Omit<RequestOptions, 'token'> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'include',
      });
    } catch {
      throw new ApiNetworkError(baseUrl);
    }
    if (
      response.status === 401 &&
      options.retry !== false &&
      !path.startsWith('/api/platform/auth/')
    ) {
      const refreshed = await fetch(`${baseUrl}/api/platform/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (refreshed.ok) {
        return request<T>(path, { ...options, retry: false });
      }
    }
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : null;
    if (!response.ok) {
      const record =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : null;
      throw new ApiError(
        toErrorMessage(payload, response.status === 401 ? '平台登录已失效' : '请求失败'),
        response.status,
        typeof record?.code === 'string' ? record.code : undefined,
      );
    }
    return payload as T;
  }

  return {
    baseUrl,
    login: (email: string, password: string) =>
      request<{ expires_in: number; admin: PlatformAdminSummary }>(
        '/api/platform/auth/login',
        { method: 'POST', body: { email, password }, retry: false },
      ),
    refresh: () =>
      request<{ expires_in: number; admin: PlatformAdminSummary }>(
        '/api/platform/auth/refresh',
        { method: 'POST', retry: false },
      ),
    logout: () =>
      request<{ status: string }>('/api/platform/auth/logout', {
        method: 'POST',
        retry: false,
      }),
    getMe: () =>
      request<{ admin: PlatformAdminSummary }>('/api/platform/auth/me'),
    getTenants: () =>
      request<PlatformTenantSummary[]>('/api/platform/tenants'),
    getTenant: (tenantCode: string) =>
      request<PlatformTenantSummary>(
        `/api/platform/tenants/${encodeURIComponent(tenantCode)}`,
      ),
    createTenant: (
      body: CreatePlatformTenantInput,
      idempotencyKey: string,
    ) =>
      request<CreatedPlatformTenant>('/api/platform/tenants', {
        method: 'POST',
        body,
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-Request-Id': crypto.randomUUID(),
        },
      }),
    updateSubscription: (
      tenantCode: string,
      body: {
        status: 'trial' | 'active' | 'expired' | 'suspended';
        start_at: string;
        end_at: string;
        version: number;
      },
    ) =>
      request<PlatformTenantSummary>(
        `/api/platform/tenants/${encodeURIComponent(tenantCode)}/subscription`,
        {
          method: 'PATCH',
          body,
          headers: { 'X-Request-Id': crypto.randomUUID() },
        },
      ),
    updateLocationLimit: (
      tenantCode: string,
      locationLimit: number,
      version: number,
    ) =>
      request<PlatformTenantSummary>(
        `/api/platform/tenants/${encodeURIComponent(tenantCode)}/location-limit`,
        {
          method: 'PATCH',
          body: { location_limit: locationLimit, version },
          headers: { 'X-Request-Id': crypto.randomUUID() },
        },
      ),
  };
}
