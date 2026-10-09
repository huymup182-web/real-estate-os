import { Injectable, Logger } from '@nestjs/common';

/** BĐS vừa được tạo, transaction tạo đã commit. */
export interface PropertyCreatedEvent {
  tenantId: string;
  propertyId: string;
  createdBy: string;
}

type Listener = (event: PropertyCreatedEvent) => Promise<void>;

/**
 * Sự kiện BĐS cho module khác nghe mà PropertiesModule không phụ thuộc ngược lại (TASK-095: thông báo
 * BĐS mới). Listener chạy nền sau khi API đã trả về; lỗi chỉ ghi log, không ảnh hưởng thao tác BĐS.
 */
@Injectable()
export class PropertyEvents {
  private readonly logger = new Logger(PropertyEvents.name);
  private readonly createdListeners: Listener[] = [];

  onCreated(listener: Listener): void {
    this.createdListeners.push(listener);
  }

  /** Trả promise để test chờ được; nơi phát sự kiện không cần chờ. */
  emitCreated(event: PropertyCreatedEvent): Promise<void> {
    return Promise.all(
      this.createdListeners.map((listener) =>
        listener(event).catch((error: unknown) => {
          this.logger.error('Xử lý sự kiện tạo BĐS lỗi', {
            propertyId: event.propertyId,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ),
    ).then(() => undefined);
  }
}
