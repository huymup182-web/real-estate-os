import Link from 'next/link';

import { accessToken } from '../../../../lib/auth/server-session.ts';
import { emptyPropertyForm, getProvinces } from '../../../../lib/properties.ts';
import { createPropertyAction } from '../actions.ts';
import { PropertyForm } from '../property-form.tsx';

export const dynamic = 'force-dynamic';

/** Thêm BĐS (TASK-107). Người tạo là môi giới phụ trách; backend kiểm `property.create`. */
export default async function NewPropertyPage() {
  const provinces = await getProvinces(await accessToken());
  return (
    <main className="page">
      <p>
        <Link href="/properties">← Bất động sản</Link>
      </p>
      <h1>Thêm BĐS</h1>
      <div className="card">
        {provinces.ok ? (
          <PropertyForm
            action={createPropertyAction}
            initial={emptyPropertyForm()}
            provinces={provinces.data}
            initialWards={[]}
            withStreetAddress
            submitLabel="Tạo BĐS"
          />
        ) : (
          <p className="form-error" role="alert">
            {provinces.message}
          </p>
        )}
      </div>
    </main>
  );
}
