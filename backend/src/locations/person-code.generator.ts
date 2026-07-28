import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_SUFFIX_MAX = 0x1ffffff;

export function encodeCrockfordBase32(value: number, width: number): string {
  let remaining = Math.floor(value);
  let encoded = '';

  for (let position = 0; position < width; position += 1) {
    encoded = CROCKFORD_BASE32[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }

  if (remaining !== 0) {
    throw new RangeError(`value does not fit in ${width} Crockford Base32 characters`);
  }

  return encoded;
}

export function formatPersonCode(unixSecond: number, randomSuffix: number): string {
  if (
    !Number.isInteger(randomSuffix) ||
    randomSuffix < 0 ||
    randomSuffix > RANDOM_SUFFIX_MAX
  ) {
    throw new RangeError('person_code random suffix must fit in 25 bits');
  }
  return (
    encodeCrockfordBase32(unixSecond, 7) +
    encodeCrockfordBase32(randomSuffix, 5)
  );
}

@Injectable()
export class PersonCodeGenerator {
  private lastSecond = -1;
  private lastSuffix = -1;

  generate(now = new Date()): string {
    const unixSecond = Math.floor(now.getTime() / 1000);
    let suffix = randomBytes(4).readUInt32BE(0) & RANDOM_SUFFIX_MAX;

    if (unixSecond === this.lastSecond) {
      suffix = (this.lastSuffix + 1) & RANDOM_SUFFIX_MAX;
    }

    this.lastSecond = unixSecond;
    this.lastSuffix = suffix;

    return formatPersonCode(unixSecond, suffix);
  }
}
