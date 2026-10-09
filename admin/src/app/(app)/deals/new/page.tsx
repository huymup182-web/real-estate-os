import Link from 'next/link';

import { customerOptions, propertyOptions } from '../../../../lib/appointments.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import { getCustomer } from '../../../../lib/customers.ts';
import { emptyDealForm } from '../../../../lib/deals.ts';
import { createDealAction } from '../actions.ts';
import { DealForm } from '../deal-form.tsx';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tạo giao dịch (TASK-110). Chọn khách, BĐS trong phạm vi xem (100 mới nhất); mở từ trang khách
 * (`?customerId=`) thì chọn sẵn khách đó. Backend kiểm `deal.manage` và quyền với khách, BĐS.
 */
export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { customerId } = await searchParams;
  const preset = typeof customerId === 'string' && UUID.test(customerId) ? customerId : '';
  const token = await accessToken();
  const [customers, properties, presetCustomer] = await Promise.all([
    customerOptions(token),
    propertyOptions(token),
    preset ? getCustomer(token, preset) : null,
  ]);
  const failure = !customers.ok ? customers : !properties.ok ? properties : null;
  const customerList = customers.ok ? customers.data : [];
  if (presetCustomer?.ok && !customerList.some((customer) => customer.id === preset)) {
    customerList.unshift(presetCustomer.data);
  }

  return (
    <main className="page">
      <p>
        <Link href="/deals">← Giao dịch</Link>
      </p>
      <h1>Tạo giao dịch</h1>
      <div className="card">
        {failure || !properties.ok ? (
          <p className="form-error" role="alert">
            {failure?.message}
          </p>
        ) : (
          <DealForm
            action={createDealAction}
            initial={emptyDealForm(presetCustomer?.ok ? preset : '')}
            options={{
              customers: customerList.map((customer) => ({
                id: customer.id,
                label: `${customer.fullName} · ${customer.phone}`,
              })),
              properties: properties.data.map((property) => ({
                id: property.id,
                label: `${property.code} · ${property.title}`,
              })),
            }}
            submitLabel="Tạo giao dịch"
          />
        )}
      </div>
    </main>
  );
}
