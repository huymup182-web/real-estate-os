import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { customerScopesOf } from '../customers/customers.controller.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import {
  type AppointmentResponse,
  type AppointmentScopes,
  AppointmentsService,
  type RelatedScopes,
} from './appointments.service.js';
import {
  AppointmentListQueryDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto.js';

function appointmentScopesOf(user: RequestUser): AppointmentScopes {
  return {
    view: user.permissions['appointment.view'],
    manage: user.permissions['appointment.manage'],
  };
}

function relatedScopesOf(user: RequestUser): RelatedScopes {
  return { customers: customerScopesOf(user), properties: scopesOf(user) };
}

/** Lịch hẹn dẫn khách xem BĐS (TASK-083). */
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /** `POST /api/v1/appointments` {customerId, propertyId, scheduledAt, durationMinutes?, location?, notes?} → 201. */
  @Post()
  @RequirePermission('appointment.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateAppointmentDto,
  ): Promise<AppointmentResponse> {
    return this.appointments.create(
      actorOf(tenantId, req.user),
      dto,
      relatedScopesOf(req.user),
      appointmentScopesOf(req.user),
    );
  }

  /** `GET /api/v1/appointments?from&to&customerId&propertyId&page&pageSize` → lịch hẹn, giờ hẹn sớm trước. */
  @Get()
  @RequirePermission('appointment.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: AppointmentListQueryDto,
  ): Promise<Paginated<AppointmentResponse>> {
    return this.appointments.findAll(
      actorOf(tenantId, req.user),
      query,
      appointmentScopesOf(req.user),
    );
  }

  /** `GET /api/v1/appointments/:id`; không xem được → 404. */
  @Get(':id')
  @RequirePermission('appointment.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<AppointmentResponse> {
    return this.appointments.findOne(
      actorOf(tenantId, req.user),
      id,
      appointmentScopesOf(req.user),
    );
  }

  /** `PATCH /api/v1/appointments/:id` → lịch hẹn sau khi sửa. */
  @Patch(':id')
  @RequirePermission('appointment.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ): Promise<AppointmentResponse> {
    return this.appointments.update(
      actorOf(tenantId, req.user),
      id,
      dto,
      relatedScopesOf(req.user),
      appointmentScopesOf(req.user),
    );
  }

  /** `DELETE /api/v1/appointments/:id` → 204, xoá mềm. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('appointment.manage')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.appointments.remove(actorOf(tenantId, req.user), id, appointmentScopesOf(req.user));
  }
}
