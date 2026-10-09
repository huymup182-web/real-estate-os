import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import { MAX_USER_ROLES, PHONE_MESSAGE, PHONE_PATTERN } from '../user-values.js';
import { trim } from './create-user.dto.js';

/** Chuỗi rỗng sau khi trim = xoá giá trị (null). */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/**
 * `PATCH /users/:id` (TASK-103): chỉ sửa trường có gửi. `email`/`phone`/`departmentId` gửi null để xoá,
 * nhưng user phải còn email hoặc số điện thoại. `roleIds` thay toàn bộ danh sách role.
 */
export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  fullName?: string;

  @Transform(trimToNull)
  @ValidateIf((dto: UpdateUserDto) => dto.email !== undefined && dto.email !== null)
  @IsEmail({}, { message: 'email không hợp lệ' })
  email?: string | null;

  @Transform(trimToNull)
  @ValidateIf((dto: UpdateUserDto) => dto.phone !== undefined && dto.phone !== null)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;

  @ValidateIf((dto: UpdateUserDto) => dto.departmentId !== undefined && dto.departmentId !== null)
  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần chọn ít nhất một vai trò' })
  @ArrayMaxSize(MAX_USER_ROLES)
  @ArrayUnique({ message: 'roleIds bị trùng' })
  @IsUUID('all', { each: true, message: 'roleIds không hợp lệ' })
  roleIds?: string[];
}
