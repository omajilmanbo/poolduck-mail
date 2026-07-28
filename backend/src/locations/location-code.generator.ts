import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOCATION_CODE_LENGTH = 8;

@Injectable()
export class LocationCodeGenerator {
  generate(): string {
    const bytes = randomBytes(LOCATION_CODE_LENGTH);
    let code = '';
    for (const byte of bytes) {
      code += CROCKFORD_BASE32[byte & 31];
    }
    return code;
  }
}
