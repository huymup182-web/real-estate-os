'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  DIRECTION_LABELS,
  LEGAL_STATUS_LABELS,
  type LocationOption,
  PROPERTY_TYPE_LABELS,
  type PropertyFormState,
  type PropertyFormValues,
} from '../../../lib/properties.ts';
import { loadWardsAction } from './actions.ts';

type Action = (state: PropertyFormState, formData: FormData) => Promise<PropertyFormState>;

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/**
 * Form tạo/sửa BĐS. Đổi tỉnh/thành thì tải lại danh sách phường/xã. `withStreetAddress = false` khi người
 * dùng không được xem địa chỉ chi tiết (ô bị ẩn, giá trị cũ giữ nguyên).
 */
export function PropertyForm({
  action,
  initial,
  provinces,
  initialWards,
  withStreetAddress,
  submitLabel,
}: {
  action: Action;
  initial: PropertyFormValues;
  provinces: LocationOption[];
  initialWards: LocationOption[];
  withStreetAddress: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    fieldErrors: {},
    values: initial,
  });
  const { values, fieldErrors } = state;
  const [provinceId, setProvinceId] = useState(values.provinceId);
  const [wards, setWards] = useState(initialWards);
  const [loadingWards, startLoading] = useTransition();

  function changeProvince(next: string) {
    setProvinceId(next);
    setWards([]);
    startLoading(async () => {
      setWards(await loadWardsAction(next));
    });
  }

  const text = (name: keyof PropertyFormValues, label: string, extra: object = {}) => (
    <label className="field">
      <span>{label}</span>
      <input name={name} defaultValue={values[name]} {...extra} />
      <FieldError message={fieldErrors[name]} />
    </label>
  );

  return (
    <form action={formAction} className="form" noValidate key={JSON.stringify(values)}>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {text('title', 'Tiêu đề', { maxLength: 255, required: true })}
      <label className="field">
        <span>Mô tả</span>
        <textarea name="description" defaultValue={values.description} maxLength={5000} rows={4} />
        <FieldError message={fieldErrors['description']} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Loại BĐS</span>
          <select name="propertyType" defaultValue={values.propertyType} required>
            <option value="">Chọn loại</option>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['propertyType']} />
        </label>
        <label className="field">
          <span>Pháp lý</span>
          <select name="legalStatus" defaultValue={values.legalStatus}>
            <option value="">Chưa rõ</option>
            {Object.entries(LEGAL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['legalStatus']} />
        </label>
      </div>
      <div className="field-row">
        {text('price', 'Giá (đồng)', {
          inputMode: 'numeric',
          placeholder: '3500000000',
          required: true,
        })}
        {text('area', 'Diện tích (m²)', {
          inputMode: 'decimal',
          placeholder: '80.5',
          required: true,
        })}
      </div>
      <div className="field-row">
        {text('bedrooms', 'Phòng ngủ', { inputMode: 'numeric' })}
        {text('bathrooms', 'Phòng tắm', { inputMode: 'numeric' })}
        {text('floors', 'Số tầng', { inputMode: 'numeric' })}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Hướng</span>
          <select name="direction" defaultValue={values.direction}>
            <option value="">Chưa rõ</option>
            {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['direction']} />
        </label>
        {text('roadWidth', 'Đường, hẻm rộng (m)', { inputMode: 'decimal' })}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Tỉnh/thành</span>
          <select
            name="provinceId"
            value={provinceId}
            onChange={(event) => changeProvince(event.target.value)}
            required
          >
            <option value="">Chọn tỉnh/thành</option>
            {provinces.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['provinceId']} />
        </label>
        <label className="field">
          <span>Phường/xã</span>
          <select
            name="wardId"
            defaultValue={values.wardId}
            key={`${provinceId}-${wards.length}`}
            disabled={loadingWards}
            required
          >
            <option value="">{loadingWards ? 'Đang tải…' : 'Chọn phường/xã'}</option>
            {wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {ward.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors['wardId']} />
        </label>
      </div>
      {withStreetAddress &&
        text('streetAddress', 'Địa chỉ chi tiết', { maxLength: 255, placeholder: 'Số nhà, đường' })}
      <div>
        <button type="submit" className="button" disabled={pending || loadingWards}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
