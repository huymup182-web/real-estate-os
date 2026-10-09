import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';

/** Phạm vi gán được cho role của công ty (PLATFORM chỉ dành cho role nền tảng). */
export const ROLE_SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/** Số quyền tối đa trong một role (danh mục hiện có chưa tới 30 quyền). */
export const MAX_ROLE_PERMISSIONS = 100;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/** Một quyền của role kèm phạm vi dữ liệu. */
export class RolePermissionDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, { message: 'code quyền không hợp lệ' })
  code!: string;

  @IsIn(ROLE_SCOPES, { message: `scope phải là ${ROLE_SCOPES.join(', ')}` })
  scope!: RoleScope;
}

/** `PATCH /roles/:id` (TASK-104): chỉ sửa trường có gửi; `permissions` thay toàn bộ danh sách quyền. */
export class UpdateRoleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(100)
  @NoHtml()
  name?: string;

  /** Gửi null hoặc chuỗi rỗng để xoá mô tả. */
  @Transform(trimToNull)
  @ValidateIf((dto: UpdateRoleDto) => dto.description !== undefined && dto.description !== null)
  @IsString()
  @MaxLength(500)
  @NoHtml()
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROLE_PERMISSIONS)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  permissions?: RolePermissionDto[];
}

/** `POST /roles` (TASK-104): tạo role tuỳ chỉnh. `code` viết hoa, không đổi được sau khi tạo. */
export class CreateRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'code chỉ gồm chữ in hoa, số và dấu gạch dưới, bắt đầu bằng chữ',
  })
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(100)
  @NoHtml()
  name!: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @NoHtml()
  description?: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_ROLE_PERMISSIONS)
  @ValidateNested({ each: true })
  @Type(() => RolePermissionDto)
  permissions!: RolePermissionDto[];
}
