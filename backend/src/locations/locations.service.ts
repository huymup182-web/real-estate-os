import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';

export interface LocationOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Danh mục địa giới hành chính đang dùng (TASK-013) cho ô chọn khu vực khi tạo, sửa BĐS (TASK-107).
 * Dữ liệu dùng chung, không thuộc công ty nào.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly dataSource: DataSource) {}

  provinces(): Promise<LocationOption[]> {
    return this.dataSource.query(
      `SELECT id, code, name FROM provinces WHERE is_active ORDER BY name, code`,
    );
  }

  /** Phường/xã đang dùng của tỉnh `provinceId`; tỉnh không tồn tại hoặc ngừng dùng → 404. */
  async wards(provinceId: string): Promise<LocationOption[]> {
    const province: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM provinces WHERE id = $1 AND is_active`,
      [provinceId],
    );
    if (province.length === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Không tìm thấy tỉnh/thành');
    }
    return this.dataSource.query(
      `SELECT id, code, name FROM wards WHERE province_id = $1 AND is_active ORDER BY name, code`,
      [provinceId],
    );
  }
}
