import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api/client';

describe('frontend smoke', () => {
  it('creates API client with default backend URL', () => {
    const client = createApiClient();

    expect(client.baseUrl).toBe('http://localhost:3001');
  });
});
