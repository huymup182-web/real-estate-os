import { IsIn } from 'class-validator';

import { USER_STATUSES, type UserStatus } from '../user-values.js';

/** `POST /users/:id/status` (TASK-103): kích hoạt, ngừng hoạt động hoặc khoá tài khoản. */
export class ChangeUserStatusDto {
  @IsIn(USER_STATUSES, { message: `status phải là ${USER_STATUSES.join(', ')}` })
  status!: UserStatus;
}
