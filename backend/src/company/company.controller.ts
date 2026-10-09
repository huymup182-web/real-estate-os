import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf } from '../properties/properties.controller.js';
import { type CompanyInfo, CompanyService } from './company.service.js';
import { type Department, DepartmentsService, type ManagerOption } from './departments.service.js';
import { CreateDepartmentDto, UpdateCompanyDto, UpdateDepartmentDto } from './dto/company.dto.js';

/** Thông tin và cài đặt của công ty đang đăng nhập (TASK-105). Cần `admin.manage`. */
@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @RequirePermission('admin.manage')
  get(@TenantId() tenantId: string, @Req() req: { user: RequestUser }): Promise<CompanyInfo> {
    return this.company.get(actorOf(tenantId, req.user));
  }

  @Patch()
  @RequirePermission('admin.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: UpdateCompanyDto,
  ): Promise<CompanyInfo> {
    return this.company.update(actorOf(tenantId, req.user), dto);
  }
}

/** Phòng ban của công ty (TASK-105). Cần `admin.manage`. */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('admin.manage')
  list(@TenantId() tenantId: string, @Req() req: { user: RequestUser }): Promise<Department[]> {
    return this.departments.list(actorOf(tenantId, req.user));
  }

  /** `GET /api/v1/departments/manager-options` → người dùng chọn làm trưởng phòng được. Khai báo trước `:id`. */
  @Get('manager-options')
  @RequirePermission('admin.manage')
  managerOptions(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
  ): Promise<ManagerOption[]> {
    return this.departments.managerOptions(actorOf(tenantId, req.user));
  }

  @Get(':id')
  @RequirePermission('admin.manage')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<Department> {
    return this.departments.findOne(actorOf(tenantId, req.user), id);
  }

  @Post()
  @RequirePermission('admin.manage')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateDepartmentDto,
  ): Promise<Department> {
    return this.departments.create(actorOf(tenantId, req.user), dto);
  }

  @Patch(':id')
  @RequirePermission('admin.manage')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<Department> {
    return this.departments.update(actorOf(tenantId, req.user), id, dto);
  }

  /** `DELETE /api/v1/departments/:id` → 204. Còn người dùng hoặc team → 422. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('admin.manage')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.departments.remove(actorOf(tenantId, req.user), id);
  }
}
