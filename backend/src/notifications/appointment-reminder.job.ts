import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { MetricsService } from '../monitoring/metrics.service.js';

import {
  APPOINTMENT_REMINDER_LEAD_MINUTES,
  DISPLAY_TIME_ZONE,
  NOTIFICATION_BODY_MAX,
} from './notification-values.js';
import { NotificationsService } from './notifications.service.js';

export const APPOINTMENT_REMINDER_JOB = 'appointment-reminder';
export const APPOINTMENT_REMINDER_TITLE = 'Sắp tới giờ hẹn dẫn khách';

interface DueAppointment {
  id: string;
  tenant_id: string;
  agent_id: string;
  scheduled_at: Date;
  location: string | null;
  customer_name: string;
  property_code: string;
  property_title: string;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  hour12: false,
});

/** Giờ hẹn theo giờ Việt Nam, vd `14:30 ngày 09/10`. */
export function formatAppointmentTime(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    TIME_FORMAT.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ngày ${part('day')}/${part('month')}`;
}

/**
 * Nhắc lịch hẹn (TASK-097): mỗi 5 phút, lịch SCHEDULED chưa xoá, chưa nhắc, sẽ diễn ra trong
 * APPOINTMENT_REMINDER_LEAD_MINUTES phút tới thì môi giới phụ trách nhận thông báo VIEWING_REMINDER.
 * Đánh dấu `reminder_sent_at` bằng một lệnh UPDATE ... RETURNING trước khi gửi, nên nhiều instance cùng
 * chạy không nhắc trùng. Lịch đã qua giờ mà chưa nhắc (server tắt) thì bỏ qua. Đổi giờ hẹn thì nhắc lại.
 */
@Injectable()
export class AppointmentReminderJob {
  private readonly logger = new Logger(AppointmentReminderJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: APPOINTMENT_REMINDER_JOB })
  async run(): Promise<void> {
    try {
      const count = await this.sendDue();
      if (count > 0) {
        this.logger.log('Đã nhắc lịch hẹn', { count });
      }
      this.metrics.jobFinished(APPOINTMENT_REMINDER_JOB, true);
    } catch (error: unknown) {
      this.metrics.jobFinished(APPOINTMENT_REMINDER_JOB, false);
      this.logger.error('Job nhắc lịch hẹn lỗi', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Gửi nhắc cho các lịch tới hạn; trả số lịch đã nhắc. */
  async sendDue(): Promise<number> {
    const appointments = (await this.dataSource.query(
      `WITH claimed AS (
         UPDATE appointments SET reminder_sent_at = now()
          WHERE status = 'SCHEDULED' AND deleted_at IS NULL AND reminder_sent_at IS NULL
            AND scheduled_at > now()
            AND scheduled_at <= now() + make_interval(mins => $1)
          RETURNING id, tenant_id, agent_id, customer_id, property_id, scheduled_at, location
       )
       SELECT a.id, a.tenant_id, a.agent_id, a.scheduled_at, a.location,
              c.full_name AS customer_name, p.code AS property_code, p.title AS property_title
         FROM claimed a
         JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id
         JOIN properties p ON p.tenant_id = a.tenant_id AND p.id = a.property_id
        ORDER BY a.scheduled_at`,
      [APPOINTMENT_REMINDER_LEAD_MINUTES],
    )) as DueAppointment[];

    for (const appointment of appointments) {
      try {
        await this.notifications.notify({
          tenantId: appointment.tenant_id,
          userIds: [appointment.agent_id],
          type: 'VIEWING_REMINDER',
          title: APPOINTMENT_REMINDER_TITLE,
          body: reminderBody(appointment),
          data: { appointmentId: appointment.id },
        });
      } catch (error: unknown) {
        // Đã đánh dấu nhắc: không thử lại để tránh nhắc trùng; ghi log để kiểm tra.
        this.logger.error('Không gửi được nhắc lịch hẹn', {
          appointmentId: appointment.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return appointments.length;
  }
}

/** Vd `14:30 ngày 09/10 · Anh An xem BDS-000123 Nhà phố. Địa điểm: 12 Lê Lợi`. */
function reminderBody(appointment: DueAppointment): string {
  const place = appointment.location ? `. Địa điểm: ${appointment.location}` : '';
  return `${formatAppointmentTime(appointment.scheduled_at)} · ${appointment.customer_name} xem ${
    appointment.property_code
  } ${appointment.property_title}${place}`.slice(0, NOTIFICATION_BODY_MAX);
}
