import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../../lib/auth/server-session.ts';
import { dealFormValues, getDeal } from '../../../../../lib/deals.ts';
import { updateDealAction } from '../../actions.ts';
import { DealForm } from '../../deal-form.tsx';

export const dynamic = 'force-dynamic';

/** Sửa giao dịch (TASK-110): giá chốt, tiền cọc, ngày cọc, ghi chú; không đổi khách, BĐS. */
export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(await accessToken(), id);
  if (!deal.ok && (deal.status === 404 || deal.status === 400)) {
    notFound();
  }

  return (
    <main className="page">
      <p>
        <Link href={`/deals/${id}`}>← Chi tiết giao dịch</Link>
      </p>
      {!deal.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {deal.message}
          </p>
        </div>
      ) : (
        <>
          <h1>
            Sửa giao dịch {deal.data.customer.fullName} · {deal.data.property.code}
          </h1>
          <div className="card">
            <DealForm
              action={updateDealAction.bind(
                null,
                deal.data.id,
                deal.data.updatedAt,
                deal.data.depositAt,
              )}
              initial={dealFormValues(deal.data)}
              options={null}
              submitLabel="Lưu thay đổi"
            />
          </div>
        </>
      )}
    </main>
  );
}
