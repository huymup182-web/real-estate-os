import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { DataSource } from 'typeorm';

import { createCleanTestDataSource, describeTable, insertRow, revertAll } from './helpers.ts';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$test$test';

describe('TASK-022: bảng appointments', () => {
  let db: DataSource;
  let companyA: string;
  let companyB: string;
  let agentA: string;
  let agentB: string;
  let customerA: string;
  let customerB: string;
  let propertyA: string;
  let propertyB: string;
  let province: string;
  let ward: string;
  let seq = 0;

  before(async () => {
    db = await createCleanTestDataSource();
    await db.runMigrations();
    companyA = String((await insertRow(db, 'companies', { name: 'A', slug: 'cong-ty-a' }))['id']);
    companyB = String((await insertRow(db, 'companies', { name: 'B', slug: 'cong-ty-b' }))['id']);
    agentA = await insertUser(companyA);
    agentB = await insertUser(companyB);
    province = String((await insertRow(db, 'provinces', { code: '56', name: 'Khánh Hòa' }))['id']);
    ward = String(
      (
        await insertRow(db, 'wards', {
          province_id: province,
          code: '22333',
          name: 'Bắc Nha Trang',
        })
      )['id'],
    );
    customerA = await insertCustomer(companyA);
    customerB = await insertCustomer(companyB);
    propertyA = await insertProperty(companyA, agentA);
    propertyB = await insertProperty(companyB, agentB);
  });

  after(async () => {
    await db.destroy();
  });

  async function insertUser(tenantId: string): Promise<string> {
    seq += 1;
    const user = await insertRow(db, 'users', {
      tenant_id: tenantId,
      email: `user${seq}@example.com`,
      password_hash: HASH,
      full_name: 'Môi giới',
    });
    return String(user['id']);
  }

  async function insertCustomer(tenantId: string): Promise<string> {
    const customer = await insertRow(db, 'customers', {
      tenant_id: tenantId,
      full_name: 'Khách',
      phone: '+84912345678',
    });
    return String(customer['id']);
  }

  async function insertProperty(tenantId: string, agentId: string): Promise<string> {
    seq += 1;
    const property = await insertRow(db, 'properties', {
      tenant_id: tenantId,
      code: `BDS-${seq}`,
      title: 'Nhà phố',
      property_type: 'HOUSE',
      price: 1,
      area: 50,
      province_id: province,
      ward_id: ward,
      agent_id: agentId,
    });
    return String(property['id']);
  }

  function insertAppointment(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow(db, 'appointments', {
      tenant_id: companyA,
      customer_id: customerA,
      property_id: propertyA,
      agent_id: agentA,
      scheduled_at: '2026-10-10T02:00:00Z',
      ...values,
    });
  }

  it('có đủ cột đúng kiểu', async () => {
    assert.deepEqual(await describeTable(db, 'appointments'), [
      ['id', 'uuid', 'NO'],
      ['tenant_id', 'uuid', 'NO'],
      ['customer_id', 'uuid', 'NO'],
      ['property_id', 'uuid', 'NO'],
      ['agent_id', 'uuid', 'NO'],
      ['scheduled_at', 'timestamp with time zone', 'NO'],
      ['duration_minutes', 'smallint', 'YES'],
      ['location', 'character varying', 'YES'],
      ['notes', 'text', 'YES'],
      ['status', 'character varying', 'NO'],
      ['outcome', 'character varying', 'YES'],
      ['reminder_sent_at', 'timestamp with time zone', 'YES'],
      ['created_by', 'uuid', 'YES'],
      ['updated_by', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
      ['deleted_at', 'timestamp with time zone', 'YES'],
    ]);
  });

  it('tạo lịch hẹn mặc định SCHEDULED; nhận đủ trạng thái và kết quả theo thiết kế', async () => {
    const appointment = await insertAppointment({
      duration_minutes: 45,
      location: 'Gặp tại cổng dự án',
      created_by: agentA,
    });
    assert.equal(appointment['status'], 'SCHEDULED');
    assert.equal(appointment['outcome'], null);
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      await insertAppointment({ status });
    }
    for (const outcome of ['INTERESTED', 'NOT_INTERESTED', 'NEED_FOLLOW_UP', 'NEGOTIATING']) {
      await insertAppointment({ status: 'COMPLETED', outcome });
    }
  });

  it('chặn trạng thái/kết quả lạ, thời lượng ≤ 0 và thiếu thời gian hẹn', async () => {
    await assert.rejects(insertAppointment({ status: 'DONE' }), /ck_appointments_status/);
    await assert.rejects(insertAppointment({ outcome: 'BOUGHT' }), /ck_appointments_outcome/);
    await assert.rejects(
      insertAppointment({ duration_minutes: 0 }),
      /ck_appointments_duration_minutes/,
    );
    await assert.rejects(insertAppointment({ scheduled_at: null }), /scheduled_at/);
  });

  it('khách, BĐS, môi giới, người tạo phải cùng công ty với lịch hẹn', async () => {
    await assert.rejects(
      insertAppointment({ customer_id: customerB }),
      /fk_appointments_customer_id/,
    );
    await assert.rejects(
      insertAppointment({ property_id: propertyB }),
      /fk_appointments_property_id/,
    );
    await assert.rejects(insertAppointment({ agent_id: agentB }), /fk_appointments_agent_id/);
    await assert.rejects(insertAppointment({ created_by: agentB }), /fk_appointments_created_by/);
    await assert.rejects(insertAppointment({ updated_by: agentB }), /fk_appointments_updated_by/);
  });

  it('không xoá cứng được khách, BĐS hoặc môi giới còn lịch hẹn', async () => {
    // Môi giới riêng chỉ gắn với lịch hẹn, để lỗi đến từ appointments chứ không phải properties.
    const agentOnly = await insertUser(companyA);
    await insertAppointment({ agent_id: agentOnly });
    await assert.rejects(
      db.query('DELETE FROM customers WHERE id = $1', [customerA]),
      /fk_appointments_customer_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM properties WHERE id = $1', [propertyA]),
      /fk_appointments_property_id/,
    );
    await assert.rejects(
      db.query('DELETE FROM users WHERE id = $1', [agentOnly]),
      /fk_appointments_agent_id/,
    );
  });

  it('updated_at tự cập nhật', async () => {
    const appointment = await insertAppointment({
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    });
    await db.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [
      appointment['id'],
    ]);
    const rows: { updated_at: Date }[] = await db.query(
      'SELECT updated_at FROM appointments WHERE id = $1',
      [appointment['id']],
    );
    assert.ok((rows[0]?.updated_at.getFullYear() ?? 0) > 2020);
  });

  it('revert rồi chạy lại toàn bộ migration sạch', async () => {
    await revertAll(db);
    const tables: unknown[] = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'appointments'`,
    );
    assert.equal(tables.length, 0);
    const applied = await db.runMigrations();
    assert.equal(applied.length, db.migrations.length);
  });
});
