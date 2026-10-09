import type { Customer } from './customer.entity.js';

/** Khách hàng trả cho client (không có tenantId, deletedAt). */
export interface CustomerResponse {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  purpose: string | null;
  purchaseTimeline: string | null;
  source: string | null;
  agentId: string | null;
  status: string;
  lostReason: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCustomerResponse(customer: Customer): CustomerResponse {
  return {
    id: customer.id,
    fullName: customer.fullName,
    phone: customer.phone,
    email: customer.email,
    purpose: customer.purpose,
    purchaseTimeline: customer.purchaseTimeline,
    source: customer.source,
    agentId: customer.agentId,
    status: customer.status,
    lostReason: customer.lostReason,
    notes: customer.notes,
    createdBy: customer.createdBy,
    updatedBy: customer.updatedBy,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
