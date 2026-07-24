import {
  encodeCrockfordBase32,
  formatPersonCode,
  PersonCodeGenerator,
} from '../src/locations/person-code.generator';

describe('person_code generation', () => {
  it('encodes the approved 7-character Unix-second prefix and 5-character suffix', () => {
    const second = 1_785_000_000;
    const code = formatPersonCode(second, 1);

    expect(code).toBe(`${encodeCrockfordBase32(second, 7)}00001`);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('sorts codes from later seconds after earlier seconds', () => {
    const generator = new PersonCodeGenerator();
    const earlier = generator.generate(new Date('2026-07-24T00:00:00.000Z'));
    const later = generator.generate(new Date('2026-07-24T00:00:01.000Z'));

    expect(later.localeCompare(earlier)).toBeGreaterThan(0);
  });

  it('does not repeat codes generated in one process during the same second', () => {
    const generator = new PersonCodeGenerator();
    const now = new Date('2026-07-24T00:00:00.000Z');

    expect(generator.generate(now)).not.toBe(generator.generate(now));
  });
});
