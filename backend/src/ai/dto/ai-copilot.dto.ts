import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Số lượt hội thoại tối đa app gửi lên (cả câu hỏi lẫn câu trả lời trước). */
export const COPILOT_MAX_MESSAGES = 20;
export const COPILOT_MESSAGE_MAX = 4000;

export class CopilotMessageDto {
  @IsIn(['user', 'assistant'], { message: 'role phải là user hoặc assistant' })
  role!: 'user' | 'assistant';

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'content phải là chuỗi' })
  @MinLength(1, { message: 'content không được trống' })
  @MaxLength(COPILOT_MESSAGE_MAX, { message: `content tối đa ${COPILOT_MESSAGE_MAX} ký tự` })
  content!: string;
}

/** Màn hình người dùng mở Copilot (khách, BĐS đang xem). */
export class CopilotContextDto {
  @IsOptional()
  @IsUUID('all', { message: 'customerId phải là UUID' })
  customerId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'propertyId phải là UUID' })
  propertyId?: string;
}

/**
 * `POST /ai/copilot` (TASK-143). Backend không lưu hội thoại: app gửi lại các lượt trước, lượt đầu và lượt cuối
 * là câu hỏi của người dùng, hai lượt liền nhau khác người nói.
 */
export class AiCopilotDto {
  @IsArray({ message: 'messages phải là mảng' })
  @ArrayMinSize(1, { message: 'messages cần ít nhất một câu hỏi' })
  @ArrayMaxSize(COPILOT_MAX_MESSAGES, {
    message: `messages tối đa ${COPILOT_MAX_MESSAGES} lượt`,
  })
  @ValidateNested({ each: true })
  @Type(() => CopilotMessageDto)
  messages!: CopilotMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CopilotContextDto)
  context?: CopilotContextDto;
}
