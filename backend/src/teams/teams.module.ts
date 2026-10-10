import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/** Module team (phase0/02-ARCHITECTURE.md mục 2.1: teams, team_members). */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
