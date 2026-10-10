import { Injectable, Logger } from '@nestjs/common';

/** BĐS vừa được tạo, transaction tạo đã commit. */
export interface PropertyCreatedEvent {
  tenantId: string;
  propertyId: string;
  createdBy: string;
}

/** BĐS vừa bị job chuyển sang VERIFY_REQUIRED vì quá hạn xác minh (TASK-062). */
export interface ExpiredVerification {
  tenantId: string;
  propertyId: string;
  agentId: string;
  code: string;
  title: string;
}

type Listener<T> = (event: T) => Promise<void>;

/**
 * Sự kiện BĐS cho module khác nghe mà PropertiesModule không phụ thuộc ngược lại (TASK-095: thông báo
 * BĐS mới; TASK-098: nhắc xác minh). Listener chạy nền sau khi API đã trả về; lỗi chỉ ghi log, không ảnh hưởng thao tác BĐS.
 */
@Injectable()
export class PropertyEvents {
  private readonly logger = new Logger(PropertyEvents.name);
  private readonly createdListeners: Listener<PropertyCreatedEvent>[] = [];
  private readonly expiredListeners: Listener<ExpiredVerification[]>[] = [];

  onCreated(listener: Listener<PropertyCreatedEvent>): void {
    this.createdListeners.push(listener);
  }

  /** Trả promise để test chờ được; nơi phát sự kiện không cần chờ. */
  emitCreated(event: PropertyCreatedEvent): Promise<void> {
    return this.emit(this.createdListeners, event, 'Xử lý sự kiện tạo BĐS lỗi');
  }

  /** Các BĐS một lần chạy job vừa chuyển sang VERIFY_REQUIRED (TASK-098: nhắc xác minh). */
  onVerificationExpired(listener: Listener<ExpiredVerification[]>): void {
    this.expiredListeners.push(listener);
  }

  emitVerificationExpired(properties: ExpiredVerification[]): Promise<void> {
    return this.emit(this.expiredListeners, properties, 'Xử lý sự kiện BĐS quá hạn xác minh lỗi');
  }

  private emit<T>(listeners: Listener<T>[], event: T, failure: string): Promise<void> {
    return Promise.all(
      listeners.map((listener) =>
        listener(event).catch((error: unknown) => {
          this.logger.error(failure, {
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ),
    ).then(() => undefined);
  }
}
