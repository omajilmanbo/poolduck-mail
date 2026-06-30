import { parseCorsOrigins } from '../src/main';

describe('CORS configuration', () => {
  it('allows the local frontend origin by default', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['http://localhost:3000']);
  });

  it('supports comma-separated explicit origins', () => {
    expect(parseCorsOrigins('http://localhost:3000, https://staging.example.local')).toEqual([
      'http://localhost:3000',
      'https://staging.example.local',
    ]);
  });

  it('rejects wildcard origins for authenticated APIs', () => {
    expect(() => parseCorsOrigins('*')).toThrow('CORS_ORIGIN must not use wildcard origins.');
  });
});
