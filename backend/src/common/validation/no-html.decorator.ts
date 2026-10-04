import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';

/** Dấu hiệu thẻ HTML: `<` theo sau là chữ cái, `/`, `!` hoặc `?` (vd `<b>`, `</p>`, `<!--`). `3 < 5` vẫn hợp lệ. */
const HTML_TAG = /<[a-z/!?]/i;

/**
 * Từ chối chuỗi chứa HTML (phase0/05-API-CONVENTIONS.md mục 6: lưu text thuần, client tự escape).
 * Giá trị không phải chuỗi để các decorator khác (`@IsString`…) xử lý.
 */
export function NoHtml(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'noHtml',
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !HTML_TAG.test(value),
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property không được chứa HTML`,
          options,
        ),
      },
    },
    options,
  );
}
