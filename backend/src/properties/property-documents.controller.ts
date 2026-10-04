import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { ConfirmDocumentDto, CreateDocumentUploadDto } from './dto/property-document.dto.js';
import { actorOf, scopesOf } from './properties.controller.js';
import {
  type DocumentUploadResponse,
  type PropertyDocumentResponse,
  PropertyDocumentsService,
} from './property-documents.service.js';

/**
 * Giấy tờ pháp lý của BĐS (TASK-058). Upload 3 bước như ảnh: xin link → PUT file → xác nhận.
 * Xem cần `property.view_documents` với BĐS; thêm, xoá cần thêm `property.edit`. CCCD chủ nhà cần thêm
 * `property.view_owner_contact`.
 */
@Controller('properties/:id/documents')
export class PropertyDocumentsController {
  constructor(private readonly documents: PropertyDocumentsService) {}

  /** `POST /api/v1/properties/:id/documents/upload-url` → 201 link upload có hạn 15 phút. */
  @Post('upload-url')
  @RequirePermission('property.edit')
  createUpload(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateDocumentUploadDto,
  ): Promise<DocumentUploadResponse> {
    return this.documents.createUpload(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `POST /api/v1/properties/:id/documents` → 201 giấy tờ vừa ghi, sau khi file đã lên storage. */
  @Post()
  @RequirePermission('property.edit')
  confirm(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ConfirmDocumentDto,
  ): Promise<PropertyDocumentResponse> {
    return this.documents.confirm(actorOf(tenantId, req.user), id, dto, scopesOf(req.user));
  }

  /** `GET /api/v1/properties/:id/documents` → giấy tờ, mới trước, kèm link tải có hạn 5 phút. */
  @Get()
  @RequirePermission('property.view_documents')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<PropertyDocumentResponse[]> {
    return this.documents.findAll(actorOf(tenantId, req.user), id, scopesOf(req.user));
  }

  /** `DELETE /api/v1/properties/:id/documents/:documentId` → 204, xoá mềm. */
  @Delete(':documentId')
  @HttpCode(204)
  @RequirePermission('property.edit')
  async remove(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
    @Param('documentId', ParseUuidPipe) documentId: string,
  ): Promise<void> {
    await this.documents.remove(actorOf(tenantId, req.user), id, documentId, scopesOf(req.user));
  }
}
