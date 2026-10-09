import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { Appointment } from './appointment.entity.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

/** Module lịch hẹn (phase0/02-ARCHITECTURE.md mục 2.1: appointments, đọc customers và properties). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment]),
    AuditModule,
    CustomersModule,
    PropertiesModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
