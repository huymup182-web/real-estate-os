import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  APPOINTMENT_STATUS_LABELS,
  getAppointment,
  OUTCOME_LABELS,
} from '../../../../lib/appointments.ts';
import { currentUser } from '../../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../../lib/auth/permissions.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getUser } from '../../../../lib/users.ts';
import { DeleteButton } from '../../delete-button.tsx';
import { changeStatusAction, deleteAppointmentAction } from '../actions.ts';
import { timeFormat } from '../format.ts';
import { StatusForm } from '../status-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã đặt lịch hẹn.',
  updated: 'Đã lưu thay đổi.',
  status: 'Đã cập nhật trạng thái.',
};

/**
 * Chi tiết lịch hẹn (TASK-109) và các thao tác. Nút chỉ hiện khi có `appointment.manage`; backend vẫn kiểm
 * phạm vi theo từng lịch và báo lỗi cạnh nút.
 */
export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, appointment] = await Promise.all([currentUser(token), getAppointment(token, id)]);
  if (!appointment.ok && (appointment.status === 404 || appointment.status === 400)) {
    notFound();
  }
  if (!appointment.ok) {
    return (
      <main className="page">
        <p>
          <Link href="/appointments">← Lịch hẹn</Link>
        </p>
        <div className="card">
          <p className="form-error" role="alert">
            {appointment.status === 403 ? 'Bạn chưa có quyền xem lịch hẹn.' : appointment.message}
          </p>
        </div>
      </main>
    );
  }
  const can = (code: string) => me.ok && hasPermission(me.data, code);
  const data = appointment.data;
  const agent = can('user.view') ? await getUser(token, data.agentId) : null;

  return (
    <main className="page">
      <p>
        <Link href="/appointments">← Lịch hẹn</Link>
      </p>
      <div className="page-heading">
        <div>
          <h1>{timeFormat.format(new Date(data.scheduledAt))}</h1>
          <p className="muted">
            <span className={`badge badge-appointment-${data.status.toLowerCase()}`}>
              {APPOINTMENT_STATUS_LABELS[data.status] ?? data.status}
            </span>
            {data.outcome && <> · {OUTCOME_LABELS[data.outcome] ?? data.outcome}</>}
          </p>
        </div>
        {can('appointment.manage') && (
          <Link href={`/appointments/${data.id}/edit`} className="button">
            Sửa
          </Link>
        )}
      </div>
      {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
        <p className="form-success" role="status">
          {SAVED_MESSAGES[saved]}
        </p>
      )}

      <section className="card">
        <h2>Thông tin</h2>
        <dl className="details">
          <dt>Khách</dt>
          <dd>
            {can('customer.view') ? (
              <Link href={`/customers/${data.customer.id}`}>{data.customer.fullName}</Link>
            ) : (
              data.customer.fullName
            )}
          </dd>
          <dt>BĐS</dt>
          <dd>
            {can('property.view') ? (
              <Link href={`/properties/${data.property.id}`}>
                {data.property.code} · {data.property.title}
              </Link>
            ) : (
              `${data.property.code} · ${data.property.title}`
            )}
          </dd>
          <dt>Thời lượng</dt>
          <dd>{data.durationMinutes === null ? '—' : `${data.durationMinutes} phút`}</dd>
          <dt>Điểm hẹn</dt>
          <dd>{data.location ?? 'Tại BĐS'}</dd>
          <dt>Môi giới</dt>
          <dd>{agent?.ok ? agent.data.fullName : '—'}</dd>
        </dl>
        {data.notes && <p className="prewrap">{data.notes}</p>}
      </section>

      {can('appointment.manage') && (
        <section className="card">
          <h2>Trạng thái</h2>
          <p className="muted">
            "Đã xem" và "Khách không đến" chỉ chọn được khi đã tới giờ hẹn và ghi thêm một dòng lên
            timeline của khách.
          </p>
          <StatusForm
            action={changeStatusAction.bind(null, data.id, data.updatedAt)}
            status={data.status}
            outcome={data.outcome}
          />
        </section>
      )}

      {can('appointment.manage') && (
        <section className="card">
          <h2>Xoá lịch hẹn</h2>
          <p className="muted">
            Lịch bị ẩn khỏi mọi danh sách. Muốn giữ lịch sử thì chọn "Đã huỷ".
          </p>
          <DeleteButton
            action={deleteAppointmentAction.bind(null, data.id)}
            label="Xoá lịch hẹn"
            confirmText="Xoá lịch hẹn này?"
          />
        </section>
      )}
    </main>
  );
}
