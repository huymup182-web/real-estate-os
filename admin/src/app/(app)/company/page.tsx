import Link from 'next/link';

import { accessToken } from '../../../lib/auth/server-session.ts';
import { COMPANY_STATUS_LABELS, getCompany, listDepartments } from '../../../lib/company.ts';
import { updateCompanyAction } from './actions.ts';
import { CompanyForm } from './company-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  company: 'Đã lưu thông tin công ty.',
  'department-created': 'Đã thêm phòng ban.',
  'department-updated': 'Đã lưu phòng ban.',
  'department-deleted': 'Đã xoá phòng ban.',
};

/** Thông tin, cài đặt và phòng ban của công ty (TASK-105), cần `admin.manage`. */
export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { saved } = await searchParams;
  const token = await accessToken();
  const [company, departments] = await Promise.all([getCompany(token), listDepartments(token)]);

  if (!company.ok) {
    return (
      <main className="page">
        <h1>Công ty</h1>
        <div className="card">
          <p className="form-error" role="alert">
            {company.status === 403 ? 'Bạn chưa có quyền quản lý công ty.' : company.message}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>{company.data.name}</h1>
          <p className="muted">
            <code>{company.data.slug}</code> · {COMPANY_STATUS_LABELS[company.data.status]} ·{' '}
            {company.data.stats.users} người dùng · {company.data.stats.departments} phòng ban ·{' '}
            {company.data.stats.teams} team
          </p>
        </div>
      </div>
      {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
        <p className="form-success" role="status">
          {SAVED_MESSAGES[saved]}
        </p>
      )}

      <section className="card">
        <h2>Thông tin và cài đặt</h2>
        <CompanyForm
          action={updateCompanyAction}
          initial={{
            name: company.data.name,
            verifyIntervalDays: String(company.data.settings.verifyIntervalDays),
          }}
          defaultDays={company.data.settings.verifyIntervalDaysDefault}
        />
      </section>

      <section className="card">
        <div className="page-heading">
          <h2>Phòng ban</h2>
          <Link href="/company/departments/new" className="button">
            Thêm phòng ban
          </Link>
        </div>
        {!departments.ok ? (
          <p className="form-error" role="alert">
            {departments.message}
          </p>
        ) : departments.data.length === 0 ? (
          <p className="muted">Công ty chưa có phòng ban nào.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Trưởng phòng</th>
                  <th>Người dùng</th>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {departments.data.map((department) => (
                  <tr key={department.id}>
                    <td>
                      <Link href={`/company/departments/${department.id}`}>{department.name}</Link>
                    </td>
                    <td>{department.manager?.fullName ?? <span className="muted">—</span>}</td>
                    <td>{department.userCount}</td>
                    <td>{department.teamCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
