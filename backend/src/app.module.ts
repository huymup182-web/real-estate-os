import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AiModule } from './ai/ai.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { CompanyModule } from './company/company.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DealsModule } from './deals/deals.module.js';
import { HealthModule } from './health/health.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RolesModule } from './roles/roles.module.js';
import { TeamsModule } from './teams/teams.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Module gốc. Các module nghiệp vụ (auth, properties, customers…) được thêm vào `imports`
 * ở các task sau, theo ranh giới module trong phase0/02-ARCHITECTURE.md mục 2.1.
 */
@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    CommonModule,
    HealthModule,
    AuthModule,
    PropertiesModule,
    NotificationsModule,
    CustomersModule,
    AppointmentsModule,
    DealsModule,
    MatchingModule,
    ReportsModule,
    UsersModule,
    RolesModule,
    CompanyModule,
    TeamsModule,
    LocationsModule,
    AiModule,
  ],
})
export class AppModule {}
