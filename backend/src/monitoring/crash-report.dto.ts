import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Nơi gửi báo cáo lỗi: web quản trị (Next.js) hoặc app di động (Flutter). */
export const CRASH_PLATFORMS = ['admin', 'mobile'] as const;
export type CrashPlatform = (typeof CRASH_PLATFORMS)[number];

/** Độ dài tối đa từng trường; client tự cắt trước khi gửi (docs/crash-reporting.md). */
export const CRASH_REPORT_LIMITS = {
  name: 200,
  message: 2000,
  stack: 20_000,
  route: 300,
  appVersion: 50,
  digest: 100,
} as const;

/**
 * `POST /crash-reports` (TASK-159): một lỗi chưa được xử lý ở client. Chỉ có thông tin kỹ thuật; client không gửi
 * dữ liệu người dùng nhập, `route` là đường dẫn không kèm query.
 */
export class CrashReportDto {
  @IsIn(CRASH_PLATFORMS, { message: 'platform phải là admin hoặc mobile' })
  platform!: CrashPlatform;

  /** Loại lỗi, vd `TypeError`, `StateError`. */
  @IsString({ message: 'name phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.name, {
    message: `name tối đa ${CRASH_REPORT_LIMITS.name} ký tự`,
  })
  name!: string;

  @IsString({ message: 'message phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.message, {
    message: `message tối đa ${CRASH_REPORT_LIMITS.message} ký tự`,
  })
  message!: string;

  @IsOptional()
  @IsString({ message: 'stack phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.stack, {
    message: `stack tối đa ${CRASH_REPORT_LIMITS.stack} ký tự`,
  })
  stack?: string;

  /** Màn hình đang mở, vd `/properties/[id]`. */
  @IsOptional()
  @IsString({ message: 'route phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.route, {
    message: `route tối đa ${CRASH_REPORT_LIMITS.route} ký tự`,
  })
  @Matches(/^\/[^?#\s]*$/, { message: 'route phải là đường dẫn bắt đầu bằng /, không có query' })
  route?: string;

  @IsOptional()
  @IsString({ message: 'appVersion phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.appVersion, {
    message: `appVersion tối đa ${CRASH_REPORT_LIMITS.appVersion} ký tự`,
  })
  @Matches(/^[\w.+-]+$/, { message: 'appVersion chỉ gồm chữ, số và . + - _' })
  appVersion?: string;

  /** Mã Next.js gắn cho lỗi ở server, để tìm dòng log tương ứng của web quản trị. */
  @IsOptional()
  @IsString({ message: 'digest phải là chuỗi' })
  @MaxLength(CRASH_REPORT_LIMITS.digest, {
    message: `digest tối đa ${CRASH_REPORT_LIMITS.digest} ký tự`,
  })
  digest?: string;

  /** true khi lỗi làm app dừng hẳn (không chỉ một màn hình). */
  @IsOptional()
  @IsBoolean({ message: 'fatal phải là true hoặc false' })
  fatal?: boolean;
}
