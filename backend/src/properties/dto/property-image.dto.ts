import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import {
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGES_PER_PROPERTY,
} from '../property-images.values.js';

const mimeMessage = `mimeType phải là một trong: ${IMAGE_MIME_TYPES.join(', ')}`;

/** Xin link upload một ảnh (TASK-057). */
export class CreateImageUploadDto {
  @IsIn(IMAGE_MIME_TYPES, { message: mimeMessage })
  mimeType!: ImageMimeType;

  @IsInt({ message: 'sizeBytes phải là số nguyên (byte)' })
  @Min(1)
  @Max(MAX_IMAGE_BYTES, { message: `Ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024}MB` })
  sizeBytes!: number;
}

/** Xác nhận đã upload xong ảnh để ghi vào BĐS (TASK-057). */
export class ConfirmImageDto {
  @IsUUID('all', { message: 'imageId phải là UUID' })
  imageId!: string;

  @IsIn(IMAGE_MIME_TYPES, { message: mimeMessage })
  mimeType!: ImageMimeType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_DIMENSION)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_DIMENSION)
  height?: number;
}

/** Thứ tự mới của toàn bộ ảnh đang có của BĐS (TASK-057). */
export class ReorderImagesDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_PROPERTY)
  @ArrayUnique({ message: 'imageIds không được trùng' })
  @IsUUID('all', { each: true, message: 'imageIds phải là danh sách UUID' })
  @Type(() => String)
  imageIds!: string[];
}
