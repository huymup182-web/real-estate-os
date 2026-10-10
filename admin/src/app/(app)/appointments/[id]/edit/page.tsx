import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  appointmentFormValues,
  getAppointment,
  propertyOptions,
} from '../../../../../lib/appointments.ts';
import { accessToken } from '../../../../../lib/auth/server-session.ts';
import { AppointmentForm } from '../../appointment-form.tsx';
import { updateAppointmentAction } from '../../actions.ts';

export const dynamic = 'force-dynamic';

/** Sửa lịch hẹn (TASK-109): BĐS, giờ, thời lượng, điểm hẹn, ghi chú; không đổi khách. */
export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await accessToken();
  const [appointment, properties] = await Promise.all([
    getAppointment(token, id),
    propertyOptions(token),
  ]);
  if (!appointment.ok && (appointment.status === 404 || appointment.status === 400)) {
    notFound();
  }
  const failure = !appointment.ok ? appointment : !properties.ok ? properties : null;

  return (
    <main className="page">
      <p>
        <Link href={`/appointments/${id}`}>← Chi tiết lịch hẹn</Link>
      </p>
      {!appointment.ok || !properties.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {failure?.message}
          </p>
        </div>
      ) : (
        <>
          <h1>Sửa lịch hẹn với {appointment.data.customer.fullName}</h1>
          <div className="card">
            <AppointmentForm
              action={updateAppointmentAction.bind(
                null,
                appointment.data.id,
                appointment.data.updatedAt,
                appointment.data.scheduledAt,
              )}
              initial={appointmentFormValues(appointment.data)}
              customers={null}
              properties={withCurrent(
                properties.data.map((property) => ({
                  id: property.id,
                  label: `${property.code} · ${property.title}`,
                })),
                {
                  id: appointment.data.property.id,
                  label: `${appointment.data.property.code} · ${appointment.data.property.title}`,
                },
              )}
              submitLabel="Lưu thay đổi"
            />
          </div>
        </>
      )}
    </main>
  );
}

/** BĐS hiện tại của lịch luôn có trong ô chọn, kể cả khi không nằm trong 100 BĐS mới nhất. */
function withCurrent(
  options: { id: string; label: string }[],
  current: { id: string; label: string },
) {
  return options.some((option) => option.id === current.id) ? options : [current, ...options];
}
