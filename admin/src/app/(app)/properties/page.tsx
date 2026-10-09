import Link from 'next/link';

import { currentUser } from '../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../lib/auth/permissions.ts';
import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  formatArea,
  formatPrice,
  getProvinces,
  listProperties,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  propertyFilters,
  propertyQuery,
  SORT_LABELS,
  VERIFICATION_LABELS,
} from '../../../lib/properties.ts';

export const dynamic = 'force-dynamic';

/** Danh sách BĐS trong phạm vi `property.view` (TASK-107), tìm theo từ khoá, loại, tỉnh và sắp xếp. */
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = propertyFilters(params);
  const token = await accessToken();
  const [me, properties, provinces] = await Promise.all([
    currentUser(token),
    listProperties(token, filters),
    getProvinces(token),
  ]);
  const canCreate = me.ok && hasPermission(me.data, 'property.create');
  const provinceNames = new Map(
    (provinces.ok ? provinces.data : []).map((province) => [province.id, province.name]),
  );

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Bất động sản</h1>
          {properties.ok && (
            <p className="muted">{properties.meta?.total ?? properties.data.length} BĐS</p>
          )}
        </div>
        {canCreate && (
          <Link href="/properties/new" className="button">
            Thêm BĐS
          </Link>
        )}
      </div>
      {params['saved'] === 'deleted' && (
        <p className="form-success" role="status">
          Đã xoá BĐS.
        </p>
      )}

      <form className="filters" role="search">
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Mã BĐS, tiêu đề, mô tả"
          aria-label="Tìm BĐS"
        />
        <select name="propertyType" defaultValue={filters.propertyType} aria-label="Loại BĐS">
          <option value="">Mọi loại</option>
          {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {provinces.ok && (
          <select name="provinceId" defaultValue={filters.provinceId} aria-label="Tỉnh/thành">
            <option value="">Mọi tỉnh/thành</option>
            {provinces.data.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>
        )}
        <select name="sort" defaultValue={filters.sort} aria-label="Sắp xếp">
          <option value="">{filters.q ? 'Phù hợp nhất' : 'Mới nhất'}</option>
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="button button-secondary">
          Lọc
        </button>
      </form>

      {!properties.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {properties.status === 403 ? 'Bạn chưa có quyền xem BĐS.' : properties.message}
          </p>
        </div>
      ) : properties.data.length === 0 ? (
        <div className="card">
          <p className="muted">Không có BĐS nào khớp bộ lọc.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tiêu đề</th>
                <th>Loại</th>
                <th>Giá</th>
                <th>Diện tích</th>
                <th>Khu vực</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {properties.data.map((property) => (
                <tr key={property.id}>
                  <td>
                    <code>{property.code}</code>
                  </td>
                  <td>
                    <Link href={`/properties/${property.id}`}>{property.title}</Link>
                  </td>
                  <td>{PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType}</td>
                  <td>{formatPrice(property.price)}</td>
                  <td>{formatArea(property.area)}</td>
                  <td>{provinceNames.get(property.provinceId) ?? '—'}</td>
                  <td>
                    <span className={`badge badge-property-${property.status.toLowerCase()}`}>
                      {PROPERTY_STATUS_LABELS[property.status] ?? property.status}
                    </span>
                    <div className="muted">
                      {VERIFICATION_LABELS[property.verificationStatus] ??
                        property.verificationStatus}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {properties.ok && properties.meta && properties.meta.totalPages > 1 && (
        <nav className="pager" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link href={`/properties${propertyQuery(filters, filters.page - 1)}`}>← Trước</Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Trang {properties.meta.page}/{properties.meta.totalPages}
          </span>
          {filters.page < properties.meta.totalPages ? (
            <Link href={`/properties${propertyQuery(filters, filters.page + 1)}`}>Sau →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
