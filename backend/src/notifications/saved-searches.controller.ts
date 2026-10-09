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
import { PaginationQueryDto } from '../common/response/pagination-query.dto.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { actorOf, scopesOf } from '../properties/properties.controller.js';
import type { PropertyListItem } from '../properties/property.response.js';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto.js';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto.js';
import { type SavedSearchResponse, SavedSearchesService } from './saved-searches.service.js';

/**
 * Tìm kiếm BĐS đã lưu của người đang đăng nhập (TASK-075). Cần `property.view` vì tìm kiếm là trên BĐS.
 */
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly savedSearches: SavedSearchesService) {}

  /** `POST /api/v1/saved-searches` {name, filters, notify?} → 201. */
  @Post()
  @RequirePermission('property.view')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponse> {
    return this.savedSearches.create(actorOf(tenantId, req.user), dto);
  }

  /** `GET /api/v1/saved-searches?page=1&pageSize=20` → tìm kiếm đã lưu của mình, mới trước. */
  @Get()
  @RequirePermission('property.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SavedSearchResponse>> {
    return this.savedSearches.findAll(actorOf(tenantId, req.user), query);
  }

  /** `GET /api/v1/saved-searches/:id`. */
  @Get(':id')
  @RequirePermission('property.view')
  findOne(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<SavedSearchResponse> {
    return this.savedSearches.findOne(actorOf(tenantId, req.user), id);
  }

  /** `GET /api/v1/saved-searches/:id/properties?page=1&pageSize=20` → chạy lại tìm kiếm đã lưu. */
  @Get(':id/properties')
  @RequirePermission('property.view')
  runSearch(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<PropertyListItem>> {
    return this.savedSearches.runSearch(actorOf(tenantId, req.user), id, query, scopesOf(req.user));
  }

  /** `PATCH /api/v1/saved-searches/:id` {name?, filters?, notify?}. */
  @Patch(':id')
  @RequirePermission('property.view')
  update(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchResponse> {
    return this.savedSearches.update(actorOf(tenantId, req.user), id, dto);
  }

  /** `DELETE /api/v1/saved-searches/:id` → 204. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('property.view')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.savedSearches.remove(actorOf(tenantId, req.user), id);
  }
}
