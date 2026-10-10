import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { NoHtml } from '../../common/validation/no-html.decorator.js';
import {
  DOCUMENT_MIME_TYPES,
  DOCUMENT_TYPES,
  type DocumentMimeType,
  type DocumentType,
  MAX_DOCUMENT_BYTES,
} from '../property-documents.values.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const typeMessage = `documentType phải là một trong: ${DOCUMENT_TYPES.join(', ')}`;
const mimeMessage = `mimeType phải là một trong: ${DOCUMENT_MIME_TYPES.join(', ')}`;

/** Tên file gốc để hiển thị và tải về: không chứa đường dẫn hay ký tự điều khiển. */
// eslint-disable-next-line no-control-regex
const SAFE_FILE_NAME = /^[^/\\\u0000-\u001f\u007f]+$/;

class DocumentFileDto {
  @IsIn(DOCUMENT_TYPES, { message: typeMessage })
  documentType!: DocumentType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'fileName không được để trống' })
  @MaxLength(255)
  @NoHtml()
  @Matches(SAFE_FILE_NAME, { message: 'fileName không được chứa / \\ hoặc ký tự điều khiển' })
  fileName!: string;

  @IsIn(DOCUMENT_MIME_TYPES, { message: mimeMessage })
  mimeType!: DocumentMimeType;
}

/** Xin link upload một giấy tờ (TASK-058). */
export class CreateDocumentUploadDto extends DocumentFileDto {
  @IsInt({ message: 'sizeBytes phải là số nguyên (byte)' })
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES, { message: `Giấy tờ tối đa ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB` })
  sizeBytes!: number;
}

/** Xác nhận đã upload xong giấy tờ để ghi vào BĐS (TASK-058). */
export class ConfirmDocumentDto extends DocumentFileDto {
  @IsUUID('all', { message: 'documentId phải là UUID' })
  documentId!: string;
}
