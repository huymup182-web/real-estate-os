import Link from 'next/link';
import { notFound } from 'next/navigation';

import { accessToken } from '../../../../../lib/auth/server-session.ts';
import {
  getProperty,
  getProvinces,
  getWards,
  propertyFormValues,
} from '../../../../../lib/properties.ts';
import { updatePropertyAction } from '../../actions.ts';
import { PropertyForm } from '../../property-form.tsx';

export const dynamic = 'force-dynamic';

/** Sửa BĐS (TASK-107). Không sửa được (ngoài phạm vi `property.edit`) thì backend trả 403 khi lưu. */
export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await accessToken();
  const property = await getProperty(token, id);
  if (!property.ok && (property.status === 404 || property.status === 400)) {
    notFound();
  }
  const [provinces, wards] = property.ok
    ? await Promise.all([getProvinces(token), getWards(token, property.data.provinceId)])
    : [null, null];
  const failure = !property.ok ? property : provinces && !provinces.ok ? provinces : null;

  return (
    <main className="page">
      <p>
        <Link href={`/properties/${id}`}>← Chi tiết BĐS</Link>
      </p>
      {!property.ok || !provinces?.ok ? (
        <div className="card">
          <p className="form-error" role="alert">
            {failure?.message}
          </p>
        </div>
      ) : (
        <>
          <h1>Sửa {property.data.code}</h1>
          <div className="card">
            <PropertyForm
              action={updatePropertyAction.bind(
                null,
                property.data.id,
                property.data.updatedAt,
                property.data.ownerContactVisible,
              )}
              initial={propertyFormValues(property.data)}
              provinces={provinces.data}
              initialWards={wards?.ok ? wards.data : []}
              withStreetAddress={property.data.ownerContactVisible}
              submitLabel="Lưu thay đổi"
            />
          </div>
        </>
      )}
    </main>
  );
}
