import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { USER_STATUSES, type UserStatus } from '../user-values.js';
import { trimToUndefined } from './create-user.dto.js';

/** `GET /users?q&status&roleId&departmentId&page&pageSize` (TASK-103). */
export class UserListQueryDto extends PaginationQueryDto {
  /** Tìm theo tên, email hoặc số điện thoại (chứa chuỗi, không phân biệt hoa thường). */
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(USER_STATUSES, { message: `status phải là ${USER_STATUSES.join(', ')}` })
  status?: UserStatus;

  @IsOptional()
  @IsUUID('all', { message: 'roleId không hợp lệ' })
  roleId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId?: string;
}
