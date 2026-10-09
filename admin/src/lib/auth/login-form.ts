import { safeNextPath } from './paths.ts';

/** Giới hạn độ dài giống `LoginDto` của backend. */
export const IDENTIFIER_MAX_LENGTH = 255;
export const PASSWORD_MAX_LENGTH = 128;

export interface LoginFormValues {
  identifier: string;
  password: string;
  next: string;
}

/** Trạng thái form đăng nhập trả về trình duyệt: không bao giờ chứa mật khẩu. */
export interface LoginFormState {
  error: string | null;
  identifier: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Đọc form đăng nhập. Email/SĐT được cắt khoảng trắng như backend; mật khẩu giữ nguyên. */
export function readLoginForm(formData: FormData): LoginFormValues {
  return {
    identifier: field(formData, 'identifier').trim(),
    password: field(formData, 'password'),
    next: safeNextPath(field(formData, 'next')),
  };
}

/** Kiểm tra trước khi gọi backend; backend vẫn validate lại. Trả câu lỗi hoặc `null`. */
export function validateLoginForm(values: LoginFormValues): string | null {
  if (values.identifier === '') {
    return 'Vui lòng nhập email hoặc số điện thoại';
  }
  if (values.password === '') {
    return 'Vui lòng nhập mật khẩu';
  }
  if (
    values.identifier.length > IDENTIFIER_MAX_LENGTH ||
    values.password.length > PASSWORD_MAX_LENGTH
  ) {
    return 'Email/số điện thoại hoặc mật khẩu không đúng';
  }
  return null;
}
