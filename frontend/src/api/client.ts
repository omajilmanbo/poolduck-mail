export type ApiClientConfig = {
  baseUrl?: string;
};

export type LoginRequest = {
  tenant_id: string;
  email: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  expires_in: number;
  user: {
    user_id: string;
    tenant_id: string;
    email: string;
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
  person_name: string;
  scan_code: string;
  email_masked: string;
  is_active: boolean;
};

export type ScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  mail_subject: string;
  status: 'queued';
};

export type MailJobStatus = 'queued' | 'sent' | 'failed';

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

type RequestOptions = {
  token?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
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
    queued: '发送中',
    sent: '已发送',
    failed: '发送失败',
  };

  return labels[status];
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
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new ApiNetworkError(baseUrl);
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
    createScanEvent: (token: string, locationId: string, scanCode: string) =>
      request<ScanEventResponse>('/api/scan-events', {
        method: 'POST',
        token,
        body: createScanEventBody(locationId, scanCode),
      }),
    sendMailJob: (token: string, mailJobId: string) =>
      request<SendMailJobResponse>(`/api/mail-jobs/${encodeURIComponent(mailJobId)}/send`, {
        method: 'POST',
        token,
      }),
  };
}
