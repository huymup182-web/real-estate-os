import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';

/** Số thành viên tối đa gửi trong một lần (một team môi giới thường dưới vài chục người). */
export const MAX_TEAM_MEMBERS = 200;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `PATCH /teams/:id` (TASK-106): chỉ sửa trường có gửi; `memberIds` thay toàn bộ danh sách thành viên. */
export class UpdateTeamDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(255)
  @NoHtml()
  name?: string;

  @IsOptional()
  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId?: string;

  /** `null` để bỏ trưởng nhóm. */
  @ValidateIf((dto: UpdateTeamDto) => dto.leaderId !== undefined && dto.leaderId !== null)
  @IsUUID('all', { message: 'leaderId không hợp lệ' })
  leaderId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEAM_MEMBERS)
  @ArrayUnique({ message: 'memberIds bị lặp' })
  @IsUUID('all', { each: true, message: 'memberIds không hợp lệ' })
  memberIds?: string[];
}

/** `POST /teams`. */
export class CreateTeamDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name không được để trống' })
  @MaxLength(255)
  @NoHtml()
  name!: string;

  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId!: string;

  @ValidateIf((dto: CreateTeamDto) => dto.leaderId !== undefined && dto.leaderId !== null)
  @IsUUID('all', { message: 'leaderId không hợp lệ' })
  leaderId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEAM_MEMBERS)
  @ArrayUnique({ message: 'memberIds bị lặp' })
  @IsUUID('all', { each: true, message: 'memberIds không hợp lệ' })
  memberIds?: string[];
}

/** `GET /teams?departmentId=`. */
export class TeamListQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'departmentId không hợp lệ' })
  departmentId?: string;
}
