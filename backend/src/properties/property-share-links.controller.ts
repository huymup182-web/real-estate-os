import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { Public } from '../auth/public.decorator.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { actorOf, scopesOf } from './properties.controller.js';
import {
  type CreatedShareLinkResponse,
  type SharedPropertyResponse,
  type ShareLinkResponse,
  PropertyShareLinksService,
} from './property-share-links.service.js';

/** Môi giới tạo, xem, thu hồi link chia sẻ BĐS cho khách (TASK-061). Cần `property.view` với BĐS. */
@Controller('properties/:id/share-links')
export class PropertyShareLinksController {
  constructor(private readonly shareLinks: PropertyShareLinksService) {}

  /** `POST /api/v1/properties/:id/share-links` → 201 link mới kèm `token` (chỉ trả một lần). */
  @Post()
  @RequirePermission('property.view')
  create(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateShareLinkDto,
  ): Promise<CreatedShareLinkResponse> {
    return this.shareLinks.create(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `GET /api/v1/properties/:id/share-links` → link của BĐS, mới trước. */
  @Get()
  @RequirePermission('property.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<ShareLinkResponse[]> {
    return this.shareLinks.findAll(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }

  /** `DELETE /api/v1/properties/:id/share-links/:linkId` → 204, thu hồi link. */
  @Delete(':linkId')
  @HttpCode(204)
  @RequirePermission('property.view')
  async revoke(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Param('linkId', ParseUuidPipe) linkId: string,
  ): Promise<void> {
    await this.shareLinks.revoke(actorOf(tenantId, req.user), id, linkId, scopesOf(req.user));
  }
}

/** Trang BĐS khách mở qua link chia sẻ, không cần đăng nhập (TASK-061). */
@Controller('shared-properties')
export class SharedPropertiesController {
  constructor(private readonly shareLinks: PropertyShareLinksService) {}

  /** `GET /api/v1/shared-properties/:token` → thông tin BĐS giới hạn; link không dùng được → 404. */
  @Get(':token')
  @Public()
  findOne(@Param('token') token: string): Promise<SharedPropertyResponse> {
    return this.shareLinks.findShared(token);
  }
}
