import { Controller, Get, Param } from '@nestjs/common';

import { ParseUuidPipe } from '../common/validation/parse-uuid.pipe.js';
import { type LocationOption, LocationsService } from './locations.service.js';

/** Danh mục tỉnh/thành, phường/xã (TASK-107). Mọi người dùng đã đăng nhập đều xem được. */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  /** `GET /api/v1/locations/provinces`. */
  @Get('provinces')
  provinces(): Promise<LocationOption[]> {
    return this.locations.provinces();
  }

  /** `GET /api/v1/locations/provinces/:id/wards`. */
  @Get('provinces/:id/wards')
  wards(@Param('id', ParseUuidPipe) id: string): Promise<LocationOption[]> {
    return this.locations.wards(id);
  }
}
