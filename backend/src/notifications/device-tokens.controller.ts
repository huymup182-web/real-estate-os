import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { type DeviceTokenResponse, DeviceTokensService } from './device-tokens.service.js';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';

/**
 * Thiết bị nhận thông báo đẩy của người đang đăng nhập (TASK-094). Chỉ cần đăng nhập, không cần
 * permission: mỗi người chỉ thấy và gỡ được thiết bị của chính mình.
 */
@Controller('device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  /** `POST /api/v1/device-tokens` {token, platform} → 201; token đã có thì làm mới và chuyển sang mình. */
  @Post()
  register(
    @Req() req: { user: RequestUser },
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponse> {
    return this.deviceTokens.register(req.user, dto);
  }

  /** `GET /api/v1/device-tokens` → thiết bị của mình (không trả token). */
  @Get()
  findAll(@Req() req: { user: RequestUser }): Promise<DeviceTokenResponse[]> {
    return this.deviceTokens.findAll(req.user);
  }

  /** `DELETE /api/v1/device-tokens/:id` → 204; gọi khi đăng xuất để thiết bị ngừng nhận tin. */
  @Delete(':id')
  @HttpCode(204)
  async unregister(
    @Req() req: { user: RequestUser },
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<void> {
    await this.deviceTokens.unregister(req.user, id);
  }
}
