import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../../lib/auth/server-session.ts';
import { customerFormValues, getCustomer } from '../../../../../lib/customers.ts';
import { updateCustomerAction } from '../../actions.ts';
import { CustomerForm } from '../../customer-form.tsx';

export const dynamic = 'force-dynamic';

/** Sửa khách hàng (TASK-108). Ngoài phạm vi `customer.edit` thì backend trả 403 khi lưu. */
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomer(await accessToken(), id);
  if (!customer.ok && (customer.status === 404 || customer.status === 400)) {
    notFound();
  }

  return (
    <main className="page">
      <p>
        <Link href={`/customers/${id}`}>← Chi tiết khách</Link>
      </p>
      {!customer.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {customer.message}
          </p>
        </div>
      ) : (
        <>
          <h1>Sửa {customer.data.fullName}</h1>
          <div className="card">
            <CustomerForm
              action={updateCustomerAction.bind(null, customer.data.id, customer.data.updatedAt)}
              initial={customerFormValues(customer.data)}
              submitLabel="Lưu thay đổi"
            />
          </div>
        </>
      )}
    </main>
  );
}
