import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LicenseService } from '../license/license.service';
import { PrismaService } from '../prisma.service';
import { CreateScanEventDto } from './dto';
import { CreateScanEventResponse } from './scan-events.types';

const MAIL_TEMPLATE_KEY = 'scan_entry_notice_v1';

@Injectable()
export class ScanEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
  ) {}

  async createScanEvent(
    user: AuthenticatedUserResponse,
    dto: CreateScanEventDto,
  ): Promise<CreateScanEventResponse> {
    const license = await this.licenseService.checkTenantLicense(user.tenant_id);
    this.licenseService.assertCanSend(license.status);

    const location = await this.prisma.location.findFirst({
      where: {
        id: dto.location_id,
        tenantId: user.tenant_id,
      },
      select: {
        id: true,
        name: true,
        tenant: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      });
    }

    const personMapping = await this.prisma.personMapping.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationId: dto.location_id,
        scanCode: dto.scan_code,
        status: 'active',
      },
      select: {
        personName: true,
        email: true,
      },
    });

    const receivedAt = new Date();
    const rawPayload = JSON.stringify({
      location_id: dto.location_id,
      scan_code: dto.scan_code,
    });

    if (!personMapping) {
      const scanEvent = await this.prisma.scanEvent.create({
        data: {
          tenantId: user.tenant_id,
          locationId: dto.location_id,
          scanCode: dto.scan_code,
          scanType: 'unmapped',
          rawPayload,
          receivedAt,
          createdByUserId: user.user_id,
        },
        select: { id: true },
      });

      throw new NotFoundException({
        code: 'SCAN_CODE_NOT_MAPPED',
        message: 'scan_code未找到映射邮箱',
        scan_event_id: scanEvent.id,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const scanEvent = await tx.scanEvent.create({
        data: {
          tenantId: user.tenant_id,
          locationId: dto.location_id,
          scanCode: dto.scan_code,
          scanType: 'entry',
          rawPayload,
          receivedAt,
          createdByUserId: user.user_id,
        },
        select: { id: true },
      });

      const mailSubject = `${location.name}からのお知らせ`;
      const mailBody = this.buildMailBody({
        tenantName: location.tenant.name,
        locationName: location.name,
        personName: personMapping.personName,
        timestamp: receivedAt.toISOString(),
      });

      const mailJob = await tx.mailJob.create({
        data: {
          tenantId: user.tenant_id,
          scanEventId: scanEvent.id,
          toEmail: personMapping.email,
          subject: mailSubject,
          body: mailBody,
          templateKey: MAIL_TEMPLATE_KEY,
          status: 'queued',
        },
        select: { id: true },
      });

      return {
        scan_event_id: scanEvent.id,
        mail_job_id: mailJob.id,
        mail_subject: mailSubject,
        status: 'queued',
      };
    });
  }

  private buildMailBody(input: {
    tenantName: string;
    locationName: string;
    personName: string;
    timestamp: string;
  }): string {
    return `${input.tenantName}，${input.locationName}からのお知らせ：${input.personName}　さんは　${input.timestamp}　に入室しました。`;
  }
}
