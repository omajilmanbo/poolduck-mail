import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LocationResponse, PersonMappingResponse } from './locations.types';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listLocations(tenantId: string): Promise<LocationResponse[]> {
    const locations = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        status: true,
      },
    });

    return locations.map((location) => ({
      location_id: location.id,
      location_code: location.locationCode,
      location_name: location.name,
      type: location.type,
      is_active: location.status === 'active',
    }));
  }

  async listPeople(
    tenantId: string,
    locationId: string,
  ): Promise<PersonMappingResponse[]> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
      },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      });
    }

    const people = await this.prisma.personMapping.findMany({
      where: {
        tenantId,
        locationId,
      },
      orderBy: [{ personName: 'asc' }, { scanCode: 'asc' }],
      select: {
        id: true,
        personName: true,
        scanCode: true,
        email: true,
        status: true,
      },
    });

    return people.map((person) => ({
      person_id: person.id,
      person_name: person.personName,
      scan_code: person.scanCode,
      email_masked: this.maskEmail(person.email),
      is_active: person.status === 'active',
    }));
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');

    if (!localPart || !domain) {
      return '***';
    }

    if (localPart.length === 1) {
      return `*@${domain}`;
    }

    return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
  }
}
