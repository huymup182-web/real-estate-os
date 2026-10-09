import Link from 'next/link';

import { emptyCustomerForm } from '../../../../lib/customers.ts';
import { createCustomerAction } from '../actions.ts';
import { CustomerForm } from '../customer-form.tsx';

/** Thêm khách hàng (TASK-108). Người tạo là môi giới phụ trách; backend kiểm `customer.create`. */
export default function NewCustomerPage() {
  return (
    <main className="page">
      <p>
        <Link href="/customers">← Khách hàng</Link>
      </p>
      <h1>Thêm khách hàng</h1>
      <div className="card">
        <CustomerForm
          action={createCustomerAction}
          initial={emptyCustomerForm()}
          submitLabel="Thêm khách"
        />
      </div>
    </main>
  );
}
