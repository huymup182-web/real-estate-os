import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUser } from '../../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../../lib/auth/permissions.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import {
  DIRECTION_LABELS,
  formatArea,
  formatPrice,
  getProperty,
  getPropertyImages,
  getProvinces,
  getWards,
  LEGAL_STATUS_LABELS,
  listAgentOptions,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  VERIFICATION_LABELS,
} from '../../../../lib/properties.ts';
import { getUser } from '../../../../lib/users.ts';
import { DeleteButton } from '../../delete-button.tsx';
import {
  assignAction,
  changeStatusAction,
  deletePropertyAction,
  verifyAction,
} from '../actions.ts';
import { AssignForm, StatusForm, VerifyForm } from '../property-actions.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã tạo BĐS.',
  updated: 'Đã lưu thay đổi.',
  status: 'Đã đổi trạng thái.',
  verified: 'Đã xác minh BĐS.',
  assigned: 'Đã giao BĐS cho môi giới.',
};

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * Chi tiết BĐS (TASK-107) và các thao tác quản lý. Nút chỉ hiện khi người dùng có quyền tương ứng; backend
 * vẫn kiểm phạm vi theo từng BĐS và báo lỗi cạnh nút.
 */
export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, property] = await Promise.all([currentUser(token), getProperty(token, id)]);
  if (!property.ok && (property.status === 404 || property.status === 400)) {
    notFound();
  }
  if (!property.ok) {
    return (
      <main className="page">
        <p>
          <Link href="/properties">← Bất động sản</Link>
        </p>
        <div className="card">
          <p className="form-error" role="alert">
            {property.status === 403 ? 'Bạn chưa có quyền xem BĐS.' : property.message}
          </p>
        </div>
      </main>
    );
  }
  const can = (code: string) => me.ok && hasPermission(me.data, code);
  const data = property.data;
  const [images, provinces, wards, agent, agents] = await Promise.all([
    getPropertyImages(token, id),
    getProvinces(token),
    getWards(token, data.provinceId),
    can('user.view') ? getUser(token, data.agentId) : null,
    can('property.assign') && can('user.view') ? listAgentOptions(token) : null,
  ]);
  const province = provinces.ok ? provinces.data.find((item) => item.id === data.provinceId) : null;
  const ward = wards.ok ? wards.data.find((item) => item.id === data.wardId) : null;
  const location = [data.streetAddress, ward?.name, province?.name].filter(Boolean).join(', ');
  const updatedAt = data.updatedAt;

  return (
    <main className="page">
      <p>
        <Link href="/properties">← Bất động sản</Link>
      </p>
      <div className="page-heading">
        <div>
          <h1>{data.title}</h1>
          <p className="muted">
            <code>{data.code}</code> ·{' '}
            <span className={`badge badge-property-${data.status.toLowerCase()}`}>
              {PROPERTY_STATUS_LABELS[data.status] ?? data.status}
            </span>{' '}
            · {VERIFICATION_LABELS[data.verificationStatus] ?? data.verificationStatus}
          </p>
        </div>
        {can('property.edit') && (
          <Link href={`/properties/${data.id}/edit`} className="button">
            Sửa
          </Link>
        )}
      </div>
      {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
        <p className="form-success" role="status">
          {SAVED_MESSAGES[saved]}
        </p>
      )}

      {images.ok && images.data.length > 0 && (
        <div className="gallery">
          {images.data.map((image) => (
            // Ảnh lấy thẳng từ storage/CDN bằng link có hạn, không qua tối ưu ảnh của Next.
            <img
              key={image.id}
              src={image.thumbnailUrl ?? image.url}
              alt={image.isCover ? `Ảnh bìa ${data.code}` : `Ảnh ${data.code}`}
              loading="lazy"
            />
          ))}
        </div>
      )}

      <section className="card">
        <h2>Thông tin</h2>
        <dl className="details">
          <dt>Loại</dt>
          <dd>{PROPERTY_TYPE_LABELS[data.propertyType] ?? data.propertyType}</dd>
          <dt>Giá</dt>
          <dd>
            {formatPrice(data.price)}
            {data.pricePerM2 !== null && (
              <span className="muted"> · {formatPrice(data.pricePerM2)}/m²</span>
            )}
          </dd>
          <dt>Diện tích</dt>
          <dd>{formatArea(data.area)}</dd>
          <dt>Phòng ngủ, tắm, tầng</dt>
          <dd>
            {[data.bedrooms, data.bathrooms, data.floors]
              .map((value) => (value === null ? '—' : value))
              .join(' · ')}
          </dd>
          <dt>Hướng</dt>
          <dd>{data.direction ? (DIRECTION_LABELS[data.direction] ?? data.direction) : '—'}</dd>
          <dt>Đường, hẻm</dt>
          <dd>{data.roadWidth === null ? '—' : `${data.roadWidth} m`}</dd>
          <dt>Pháp lý</dt>
          <dd>
            {data.legalStatus ? (LEGAL_STATUS_LABELS[data.legalStatus] ?? data.legalStatus) : '—'}
          </dd>
          <dt>Khu vực</dt>
          <dd>{location || '—'}</dd>
          <dt>Môi giới phụ trách</dt>
          <dd>{agent?.ok ? agent.data.fullName : '—'}</dd>
          <dt>Xác minh gần nhất</dt>
          <dd>{data.lastVerifiedAt ? dateFormat.format(new Date(data.lastVerifiedAt)) : 'Chưa'}</dd>
          <dt>Ngày tạo</dt>
          <dd>{dateFormat.format(new Date(data.createdAt))}</dd>
        </dl>
        {data.description && <p className="prewrap">{data.description}</p>}
      </section>

      {data.ownerContactVisible && (
        <section className="card">
          <h2>Chủ nhà</h2>
          {data.owner ? (
            <dl className="details">
              <dt>Họ tên</dt>
              <dd>{data.owner.fullName}</dd>
              <dt>Điện thoại</dt>
              <dd>{data.owner.phone}</dd>
              <dt>Email</dt>
              <dd>{data.owner.email ?? '—'}</dd>
              <dt>Ghi chú</dt>
              <dd>{data.owner.notes ?? '—'}</dd>
            </dl>
          ) : (
            <p className="muted">Chưa nhập chủ nhà.</p>
          )}
        </section>
      )}

      {(can('property.edit') || can('property.verify') || agents?.ok) && (
        <section className="card">
          <h2>Thao tác</h2>
          <div className="action-list">
            {can('property.edit') && (
              <StatusForm
                action={changeStatusAction.bind(null, data.id, updatedAt)}
                status={data.status}
              />
            )}
            {can('property.verify') && (
              <VerifyForm action={verifyAction.bind(null, data.id, updatedAt)} />
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

      {can('property.delete') && (
        <section className="card">
          <h2>Xoá BĐS</h2>
          <p className="muted">
            BĐS bị ẩn khỏi mọi danh sách; ảnh, giấy tờ, lịch hẹn và giao dịch vẫn được giữ.
          </p>
          <DeleteButton
            action={deletePropertyAction.bind(null, data.id)}
            label="Xoá BĐS"
            confirmText={`Xoá BĐS ${data.code}?`}
          />
        </section>
      )}
    </main>
  );
}
