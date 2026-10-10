import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID } from 'class-validator';

/** Đổi môi giới phụ trách khách (TASK-079). */
export class AssignCustomerDto {
  @IsUUID('all', { message: 'agentId phải là UUID' })
  agentId!: string;

  /** Chống ghi đè như khi sửa khách: khác `updatedAt` hiện tại → 409. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'expectedUpdatedAt phải là thời điểm ISO 8601' })
  expectedUpdatedAt?: Date;
}
