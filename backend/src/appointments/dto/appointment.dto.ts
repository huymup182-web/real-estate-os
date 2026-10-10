import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/response/pagination-query.dto.js';
import { NoHtml } from '../../common/validation/no-html.decorator.js';
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from '../appointment-values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Chuỗi rỗng sau khi trim coi như không gửi (tạo) hoặc xoá giá trị (sửa). */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};
const trimToNull = ({ value }: { value: unknown }): unknown => {
  const trimmed = trim({ value });
  return trimmed === '' ? null : trimmed;
};

/** Trường bắt buộc khi sửa: không gửi = giữ nguyên; gửi thì không được null. */
const sent = (_dto: unknown, value: unknown): boolean => value !== undefined;

/** Danh sách trong query: `?status=A,B` hoặc `?status=A&status=B` → `['A', 'B']`. */
const commaList = ({ value }: { value: unknown }): unknown => {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) {
    return value;
  }
  return [
    ...new Set(
      (parts as string[])
        .flatMap((part) => part.split(','))
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
};

/** Thời lượng tối đa của một lịch hẹn: một ngày. */
export const MAX_DURATION_MINUTES = 24 * 60;

/**
 * Tạo lịch hẹn dẫn khách (TASK-083). Môi giới của lịch là người tạo; trạng thái SCHEDULED. Đổi trạng thái,
 * kết quả buổi xem qua `POST /appointments/:id/status` (TASK-084).
 */
export class CreateAppointmentDto {
  @IsUUID('all', { message: 'customerId phải là UUID' })
  customerId!: string;

  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId!: string;

  /** Thời điểm hẹn (ISO 8601), không được ở quá khứ (kiểm ở service). */
  @Type(() => Date)
  @IsDate({ message: 'scheduledAt phải là thời điểm ISO 8601' })
  scheduledAt!: Date;

  @IsOptional()
  @IsInt({ message: 'durationMinutes phải là số phút (số nguyên)' })
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NoHtml()
  location?: string;

  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string;
}

/** Sửa lịch hẹn (TASK-083), PATCH: chỉ đổi trường được gửi; trường tuỳ chọn gửi `null` để xoá. */
export class UpdateAppointmentDto {
  /** Chống ghi đè: `updatedAt` client đang có; khác bản ghi hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;

  @ValidateIf(sent)
  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId?: string;

  @ValidateIf(sent)
  @Type(() => Date)
  @IsDate({ message: 'scheduledAt phải là thời điểm ISO 8601' })
  scheduledAt?: Date;

  @IsOptional()
  @IsInt({ message: 'durationMinutes phải là số phút (số nguyên)' })
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NoHtml()
  location?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @NoHtml()
  notes?: string | null;
}

/** Các trường sửa được (đổi khách thì tạo lịch mới). */
export const EDITABLE_APPOINTMENT_FIELDS = [
  'propertyId',
  'scheduledAt',
  'durationMinutes',
  'location',
  'notes',
] as const satisfies readonly (keyof UpdateAppointmentDto)[];

/** `GET /appointments?from&to&customerId&propertyId&status&page&pageSize`. */
export class AppointmentListQueryDto extends PaginationQueryDto {
  /** Từ thời điểm (gồm), theo `scheduledAt`. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from phải là thời điểm ISO 8601' })
  from?: Date;

  /** Đến trước thời điểm (không gồm), theo `scheduledAt`. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to phải là thời điểm ISO 8601' })
  to?: Date;

  @IsOptional()
  @IsUUID('all', { message: 'customerId phải là UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId?: string;

  /** Lọc theo trạng thái (TASK-084), vd `status=SCHEDULED`. */
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayNotEmpty({ message: 'status không được để trống' })
  @IsIn(APPOINTMENT_STATUSES, {
    each: true,
    message: `status chỉ gồm: ${APPOINTMENT_STATUSES.join(', ')}`,
  })
  status?: string[];
}

/** Đổi trạng thái lịch hẹn / ghi kết quả buổi xem (TASK-084). */
export class ChangeAppointmentStatusDto {
  @IsIn(APPOINTMENT_STATUSES, {
    message: `status phải là một trong: ${APPOINTMENT_STATUSES.join(', ')}`,
  })
  status!: AppointmentStatus;

  /** Kết quả buổi xem: chỉ gửi khi `status` = COMPLETED (kiểm ở service). */
  @IsOptional()
  @IsIn(APPOINTMENT_OUTCOMES, {
    message: `outcome phải là một trong: ${APPOINTMENT_OUTCOMES.join(', ')}`,
  })
  outcome?: string;

  /** Chống ghi đè: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
