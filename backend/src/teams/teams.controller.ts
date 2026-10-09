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
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import { CreateTeamDto, TeamListQueryDto, UpdateTeamDto } from './dto/team.dto.js';
import {
  type TeamDetail,
  type TeamOptions,
  TeamsService,
  type TeamSummary,
} from './teams.service.js';

/** Team và thành viên (TASK-106). Xem cần `team.view`, sửa cần `team.manage`; service kiểm phạm vi. */
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** `GET /api/v1/teams?departmentId=` → team trong phạm vi `team.view`. */
  @Get()
  @RequirePermission('team.view')
  list(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: TeamListQueryDto,
  ): Promise<TeamSummary[]> {
    return this.teams.list(
      actorOf(tenantId, req.user),
      req.user.permissions['team.view'] ?? 'OWN',
      query,
    );
  }

  /** `GET /api/v1/teams/options` → phòng ban và người dùng cho form. Khai báo trước `:id`. */
  @Get('options')
  @RequirePermission('team.manage')
  options(@TenantId() tenantId: string, @Req() req: { user: RequestUser }): Promise<TeamOptions> {
    return this.teams.options(actorOf(tenantId, req.user), req.user);
  }

  @Get(':id')
  @RequirePermission('team.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<TeamDetail> {
    return this.teams.findOne(actorOf(tenantId, req.user), id, req.user);
  }

  @Post()
  @RequirePermission('team.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateTeamDto,
  ): Promise<TeamDetail> {
    return this.teams.create(actorOf(tenantId, req.user), dto, req.user);
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamDetail> {
    return this.teams.update(actorOf(tenantId, req.user), id, dto, req.user);
  }

  /** `DELETE /api/v1/teams/:id` → 204, xoá mềm. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('team.manage')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.teams.remove(actorOf(tenantId, req.user), id, req.user);
  }
}
