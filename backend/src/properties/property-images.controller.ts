import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import {
  ConfirmImageDto,
  CreateImageUploadDto,
  ReorderImagesDto,
} from './dto/property-image.dto.js';
import { actorOf, scopesOf } from './properties.controller.js';
import {
  type ImageUploadResponse,
  type PropertyImageResponse,
  PropertyImagesService,
} from './property-images.service.js';

/**
 * Ảnh BĐS (TASK-057). Upload 3 bước: xin link (`upload-url`) → PUT file lên link đó → xác nhận (`POST`).
 * Xem cần `property.view` với BĐS; thay đổi cần `property.edit` với BĐS (ngoài phạm vi sửa → 403).
 */
@Controller('properties/:id/images')
export class PropertyImagesController {
  constructor(private readonly images: PropertyImagesService) {}

  /** `POST /api/v1/properties/:id/images/upload-url` → 201 link upload có hạn 15 phút. */
  @Post('upload-url')
  @RequirePermission('property.edit')
  createUpload(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateImageUploadDto,
  ): Promise<ImageUploadResponse> {
    return this.images.createUpload(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `POST /api/v1/properties/:id/images` → 201 ảnh vừa ghi, sau khi file đã lên storage. */
  @Post()
  @RequirePermission('property.edit')
  confirm(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ConfirmImageDto,
  ): Promise<PropertyImageResponse> {
    return this.images.confirm(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `GET /api/v1/properties/:id/images` → ảnh theo thứ tự hiển thị. */
  @Get()
  @RequirePermission('property.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PropertyImageResponse[]> {
    return this.images.findAll(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }

  /** `PUT /api/v1/properties/:id/images/order` `{ imageIds }` → ảnh theo thứ tự mới. */
  @Put('order')
  @RequirePermission('property.edit')
  reorder(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ReorderImagesDto,
  ): Promise<PropertyImageResponse[]> {
    return this.images.reorder(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `POST /api/v1/properties/:id/images/:imageId/cover` → ảnh sau khi đổi ảnh bìa. */
  @Post(':imageId/cover')
  @HttpCode(200)
  @RequirePermission('property.edit')
  setCover(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Param('imageId', ParseUuidPipe) imageId: string,
  ): Promise<PropertyImageResponse[]> {
    return this.images.setCover(actorOf(tenantId, req.user), id, imageId, scopesOf(req.user));
  }

  /** `DELETE /api/v1/properties/:id/images/:imageId` → 204, xoá mềm. */
  @Delete(':imageId')
  @HttpCode(204)
  @RequirePermission('property.edit')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Param('imageId', ParseUuidPipe) imageId: string,
  ): Promise<void> {
    await this.images.remove(actorOf(tenantId, req.user), id, imageId, scopesOf(req.user));
  }
}
