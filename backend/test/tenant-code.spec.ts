import {
  generateTenantCode,
  generateUniqueTenantCode,
  normalizeTenantCode,
  TENANT_CODE_PATTERN,
  TenantCodeGenerationExhaustedError,
} from '../src/tenants/tenant-code.generator';

describe('tenant code generation', () => {
  it('generates a ten-character Crockford Base32 code', () => {
    const code = generateTenantCode(() =>
      Buffer.from([0, 1, 8, 9, 16, 17, 24, 25, 30, 31]),
    );

    expect(code).toBe('0189GHRSYZ');
    expect(code).toMatch(TENANT_CODE_PATTERN);
  });

  it('normalizes lowercase input and surrounding whitespace', () => {
    expect(normalizeTenantCode(' 0a12bc34de ')).toBe('0A12BC34DE');
  });

  it('retries collisions and returns the first available code', async () => {
    let sourceCalls = 0;
    const codes = [
      Buffer.alloc(10, 0),
      Buffer.alloc(10, 1),
    ];

    await expect(
      generateUniqueTenantCode(
        async (candidate) => candidate === '0000000000',
        () => codes[sourceCalls++],
      ),
    ).resolves.toBe('1111111111');
  });

  it('fails after five collisions', async () => {
    await expect(
      generateUniqueTenantCode(
        async () => true,
        () => Buffer.alloc(10, 0),
      ),
    ).rejects.toBeInstanceOf(TenantCodeGenerationExhaustedError);
  });
});
