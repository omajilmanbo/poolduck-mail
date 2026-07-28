import { LocationCodeGenerator } from '../src/locations/location-code.generator';

describe('LocationCodeGenerator', () => {
  it('generates 8-character uppercase Crockford Base32 identifiers', () => {
    const generator = new LocationCodeGenerator();
    const values = Array.from({ length: 100 }, () => generator.generate());

    expect(values.every((value) => /^[0-9A-HJKMNP-TV-Z]{8}$/.test(value))).toBe(
      true,
    );
    expect(new Set(values).size).toBe(values.length);
  });
});
