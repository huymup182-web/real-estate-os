import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUser } from '../../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../../lib/auth/permissions.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import {
  ACTIVITY_LABELS,
  CUSTOMER_STATUS_LABELS,
  getActivities,
  getCustomer,
  getPreferences,
  preferenceSummary,
  PURPOSE_LABELS,
  SOURCE_LABELS,
  TIMELINE_LABELS,
} from '../../../../lib/customers.ts';
import { getProvinces, listAgentOptions } from '../../../../lib/properties.ts';
import { getUser } from '../../../../lib/users.ts';
import { DeleteButton } from '../../delete-button.tsx';
import {
  addNoteAction,
  assignAction,
  changeStatusAction,
  deleteCustomerAction,
} from '../actions.ts';
import { AssignForm, NoteForm, StatusForm } from '../customer-actions.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã thêm khách hàng.',
  updated: 'Đã lưu thay đổi.',
  status: 'Đã chuyển bước.',
  assigned: 'Đã giao khách cho môi giới.',
  note: 'Đã thêm ghi chú.',
};

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const label = (labels: Record<string, string>, value: string | null) =>
  value ? (labels[value] ?? value) : '—';

/**
 * Chi tiết khách (TASK-108): thông tin, nhu cầu, timeline hoạt động và các thao tác. Nút chỉ hiện khi người
 * dùng có quyền tương ứng; backend vẫn kiểm phạm vi theo từng khách và báo lỗi cạnh nút.
 */
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, customer] = await Promise.all([currentUser(token), getCustomer(token, id)]);
  if (!customer.ok && (customer.status === 404 || customer.status === 400)) {
    notFound();
  }
  if (!customer.ok) {
    return (
      <main className="page">
        <p>
          <Link href="/customers">← Khách hàng</Link>
        </p>
        <div className="card">
          <p className="form-error" role="alert">
            {customer.status === 403 ? 'Bạn chưa có quyền xem khách hàng.' : customer.message}
          </p>
        </div>
      </main>
    );
  }
  const can = (code: string) => me.ok && hasPermission(me.data, code);
  const data = customer.data;
  const [preferences, activities, provinces, agent, agents] = await Promise.all([
    getPreferences(token, id),
    getActivities(token, id),
    getProvinces(token),
    data.agentId && can('user.view') ? getUser(token, data.agentId) : null,
    can('customer.assign') && can('user.view') ? listAgentOptions(token) : null,
  ]);
  const provinceNames = new Map(
    (provinces.ok ? provinces.data : []).map((province) => [province.id, province.name]),
  );
  const updatedAt = data.updatedAt;

  return (
    <main className="page">
      <p>
        <Link href="/customers">← Khách hàng</Link>
      </p>
      <div className="page-heading">
        <div>
          <h1>{data.fullName}</h1>
          <p className="muted">
            <span className={`badge badge-customer-${data.status.toLowerCase()}`}>
              {CUSTOMER_STATUS_LABELS[data.status] ?? data.status}
            </span>{' '}
            · {data.phone}
          </p>
        </div>
        {can('customer.edit') && (
          <Link href={`/customers/${data.id}/edit`} className="button">
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
          <dt>Điện thoại</dt>
          <dd>{data.phone}</dd>
          <dt>Email</dt>
          <dd>{data.email ?? '—'}</dd>
          <dt>Mục đích</dt>
          <dd>{label(PURPOSE_LABELS, data.purpose)}</dd>
          <dt>Thời gian mua</dt>
          <dd>{label(TIMELINE_LABELS, data.purchaseTimeline)}</dd>
          <dt>Nguồn khách</dt>
          <dd>{label(SOURCE_LABELS, data.source)}</dd>
          <dt>Môi giới phụ trách</dt>
          <dd>{agent?.ok ? agent.data.fullName : data.agentId ? '—' : 'Chưa giao'}</dd>
          {data.status === 'LOST' && (
            <>
              <dt>Lý do mất khách</dt>
              <dd>{data.lostReason ?? '—'}</dd>
            </>
          )}
          <dt>Ngày tạo</dt>
          <dd>{dateFormat.format(new Date(data.createdAt))}</dd>
        </dl>
        {data.notes && <p className="prewrap">{data.notes}</p>}
      </section>

      <section className="card">
        <h2>Nhu cầu</h2>
        {!preferences.ok ? (
          <p className="form-error">{preferences.message}</p>
        ) : preferences.data.length === 0 ? (
          <p className="muted">Chưa nhập nhu cầu.</p>
        ) : (
          <ul className="plain-list">
            {preferences.data.map((preference) => (
              <li key={preference.id}>
                {preferenceSummary(preference, provinceNames)}
                {!preference.isActive && <span className="muted"> (tạm dừng)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(can('customer.edit') || agents?.ok) && (
        <section className="card">
          <h2>Thao tác</h2>
          <div className="action-list">
            {can('customer.edit') && (
              <StatusForm
                action={changeStatusAction.bind(null, data.id, updatedAt)}
                status={data.status}
                lostReason={data.lostReason}
              />
            )}
            {agents?.ok && (
              <AssignForm
                action={assignAction.bind(null, data.id, updatedAt)}
                agents={agents.data}
                agentId={data.agentId}
              />
            )}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Hoạt động</h2>
        {can('customer.edit') && <NoteForm action={addNoteAction.bind(null, data.id)} />}
        {!activities.ok ? (
          <p className="form-error">{activities.message}</p>
        ) : activities.data.length === 0 ? (
          <p className="muted">Chưa có hoạt động nào.</p>
        ) : (
          <ol className="timeline">
            {activities.data.map((activity) => (
              <li key={activity.id}>
                <div className="muted">
                  {timeFormat.format(new Date(activity.occurredAt))} ·{' '}
                  {ACTIVITY_LABELS[activity.type] ?? activity.type}
                  {activity.user && ` · ${activity.user.fullName}`}
                </div>
                {activity.content && <p className="prewrap">{activity.content}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {can('appointment.view') && (
        <section className="card">
          <h2>Lịch hẹn</h2>
          <p>
            <Link href={`/appointments?from=&customerId=${data.id}`}>Xem lịch hẹn của khách</Link>
            {can('appointment.manage') && (
              <>
                {' · '}
                <Link href={`/appointments/new?customerId=${data.id}`}>Đặt lịch xem</Link>
              </>
            )}
          </p>
        </section>
      )}

      {can('deal.view') && (
        <section className="card">
          <h2>Giao dịch</h2>
          <p>
            <Link href={`/deals?customerId=${data.id}`}>Xem giao dịch của khách</Link>
            {can('deal.manage') && (
              <>
                {' · '}
                <Link href={`/deals/new?customerId=${data.id}`}>Tạo giao dịch</Link>
              </>
            )}
          </p>
        </section>
      )}

      {can('customer.delete') && (
        <section className="card">
          <h2>Xoá khách hàng</h2>
          <p className="muted">
            Khách bị ẩn khỏi mọi danh sách; lịch hẹn và giao dịch vẫn được giữ.
          </p>
          <DeleteButton
            action={deleteCustomerAction.bind(null, data.id)}
            label="Xoá khách hàng"
            confirmText={`Xoá khách ${data.fullName}?`}
          />
        </section>
      )}
    </main>
  );
}
