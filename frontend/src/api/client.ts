export type ApiClientConfig = {
  baseUrl?: string;
};

export function createApiClient(config: ApiClientConfig = {}) {
  return {
    baseUrl: config.baseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  };
}
