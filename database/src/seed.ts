// Dữ liệu demo cho môi trường dev (TASK-027): 1 công ty, 1 admin, 1 manager, 3 agent, 20 BĐS, 10 khách.
// Ma trận quyền mặc định theo phase0/04-RBAC.md mục 4. Không chạy ở production.
import { hash } from '@node-rs/argon2';
import type { EntityManager } from 'typeorm';
import type { DataSource } from 'typeorm';

export const DEMO_COMPANY_SLUG = 'demo';
export const DEMO_PASSWORD_ENV = 'SEED_DEMO_PASSWORD';

type Scope = 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY';
type RoleCode = 'COMPANY_ADMIN' | 'DIRECTOR' | 'MANAGER' | 'TEAM_LEADER' | 'AGENT' | 'COLLABORATOR';

const ROLES: readonly (readonly [RoleCode, string])[] = [
  ['COMPANY_ADMIN', 'Quản trị công ty'],
  ['DIRECTOR', 'Giám đốc'],
  ['MANAGER', 'Trưởng phòng'],
  ['TEAM_LEADER', 'Trưởng nhóm'],
  ['AGENT', 'Môi giới'],
  ['COLLABORATOR', 'Cộng tác viên'],
];

const O = 'OWN';
const T = 'TEAM';
const D = 'DEPARTMENT';
const C = 'COMPANY';
const NO = null;

/** Thứ tự cột: COMPANY_ADMIN, DIRECTOR, MANAGER, TEAM_LEADER, AGENT, COLLABORATOR. */
export const DEFAULT_ROLE_MATRIX: Readonly<Record<string, readonly (Scope | null)[]>> = {
  'property.view': [C, C, C, C, C, C],
  'property.create': [C, C, C, C, C, C],
  'property.edit': [C, C, D, T, O, O],
  'property.delete': [C, C, D, NO, NO, NO],
  'property.approve': [C, C, D, T, NO, NO],
  'property.view_owner_contact': [C, C, D, T, O, O],
  'property.verify': [C, C, D, T, O, NO],
  'property.view_documents': [C, C, D, T, O, O],
  'property.assign': [C, C, D, T, NO, NO],
  'customer.view': [C, C, D, T, O, O],
  'customer.create': [C, C, C, C, C, C],
  'customer.edit': [C, C, D, T, O, O],
  'customer.assign': [C, C, D, T, NO, NO],
  'customer.delete': [C, C, D, NO, NO, NO],
  'user.view': [C, C, D, T, NO, NO],
  'user.manage': [C, NO, NO, NO, NO, NO],
  'team.view': [C, C, D, T, T, NO],
  'team.manage': [C, C, D, NO, NO, NO],
  'report.view': [C, C, D, T, O, NO],
  'admin.manage': [C, NO, NO, NO, NO, NO],
  'audit.view': [C, C, NO, NO, NO, NO],
  'appointment.view': [C, C, D, T, O, O],
  'appointment.manage': [C, C, D, T, O, O],
  'deal.view': [C, C, D, T, O, NO],
  'deal.manage': [C, C, D, T, O, NO],
  'commission.view': [C, C, D, T, O, O],
  'commission.manage': [C, C, NO, NO, NO, NO],
};

/** Phường demo ở Nha Trang. Mã có tiền tố DM- để không trùng danh mục hành chính chính thức. */
const WARDS: readonly (readonly [string, string, number, number])[] = [
  ['DM-NTBAC', 'Bắc Nha Trang', 12.2903, 109.1966],
  ['DM-NT', 'Nha Trang', 12.2451, 109.1943],
  ['DM-NTNAM', 'Nam Nha Trang', 12.2085, 109.2049],
  ['DM-NTTAY', 'Tây Nha Trang', 12.2546, 109.1528],
];

const USERS = [
  { key: 'admin', fullName: 'Admin Demo', role: 'COMPANY_ADMIN' },
  { key: 'manager', fullName: 'Trần Quản Lý', role: 'MANAGER' },
  { key: 'agent1', fullName: 'Nguyễn Văn An', role: 'AGENT' },
  { key: 'agent2', fullName: 'Lê Thị Bình', role: 'AGENT' },
  { key: 'agent3', fullName: 'Phạm Minh Châu', role: 'AGENT' },
] as const;

type UserKey = (typeof USERS)[number]['key'];

/** Email đăng nhập demo của từng tài khoản. */
export function demoEmail(key: UserKey): string {
  return `${key}@demo.realestate-os.test`;
}

const PROPERTY_TYPES = ['HOUSE', 'APARTMENT', 'LAND_PLOT', 'VILLA', 'SHOPHOUSE'] as const;
const PROPERTY_NAMES: Record<(typeof PROPERTY_TYPES)[number], string> = {
  HOUSE: 'Nhà phố',
  APARTMENT: 'Căn hộ',
  LAND_PLOT: 'Đất nền',
  VILLA: 'Biệt thự',
  SHOPHOUSE: 'Shophouse',
};
const DIRECTIONS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as const;
const LEGAL = ['PRIVATE_BOOK', 'PRIVATE_BOOK', 'SHARED_BOOK', 'PENDING_BOOK'] as const;
const STATUSES = ['AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'PENDING', 'SOLD'] as const;
const CUSTOMER_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING'] as const;
const CUSTOMER_SOURCES = ['REFERRAL', 'FACEBOOK', 'ZALO', 'WALK_IN', 'WEBSITE'] as const;
const CUSTOMER_NAMES = [
  'Hoàng Gia Bảo',
  'Võ Thu Hà',
  'Đặng Quốc Huy',
  'Bùi Ngọc Lan',
  'Phan Thanh Long',
  'Đỗ Mai Phương',
  'Huỳnh Đức Tài',
  'Ngô Bảo Trâm',
  'Dương Khánh Vy',
  'Lý Hoàng Yến',
];

export interface SeedResult {
  created: boolean;
  companyId: string;
}

async function insert(
  manager: EntityManager,
  table: string,
  values: Record<string, unknown>,
): Promise<string> {
  const columns = Object.keys(values);
  const params = columns.map((_column, index) => `$${index + 1}`).join(', ');
  const rows: { id: string }[] = await manager.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${params}) RETURNING id`,
    Object.values(values),
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Không chèn được vào ${table}`);
  }
  return row.id;
}

/** Tỉnh Khánh Hòa và các phường demo; dùng lại nếu đã có. */
async function seedLocations(
  manager: EntityManager,
): Promise<{ province: string; wards: string[] }> {
  const provinces: { id: string }[] = await manager.query(
    `INSERT INTO provinces (code, name) VALUES ('56', 'Khánh Hòa')
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
  );
  const province = provinces[0]?.id;
  if (!province) {
    throw new Error('Không tạo được tỉnh demo');
  }
  const wards: string[] = [];
  for (const [code, name] of WARDS) {
    const rows: { id: string }[] = await manager.query(
      `INSERT INTO wards (province_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [province, code, name],
    );
    const ward = rows[0]?.id;
    if (!ward) {
      throw new Error(`Không tạo được phường ${name}`);
    }
    wards.push(ward);
  }
  return { province, wards };
}

/**
 * Nạp dữ liệu demo trong một transaction. Nếu công ty demo đã có thì không làm gì (chạy lại an toàn).
 * Mật khẩu của mọi tài khoản demo lấy từ tham số, không ghi cứng trong code.
 */
export async function seedDemo(dataSource: DataSource, password: string): Promise<SeedResult> {
  if (password.length < 8) {
    throw new Error(`${DEMO_PASSWORD_ENV} phải có ít nhất 8 ký tự`);
  }
  // algorithm 2 = Argon2id (enum const của thư viện không import được khi bật verbatimModuleSyntax).
  // Chuẩn hoá NFKC giống backend (backend/src/auth/password.ts) để mật khẩu có dấu vẫn đăng nhập được.
  const passwordHash = await hash(password.normalize('NFKC'), { algorithm: 2 });

  return dataSource.transaction(async (manager) => {
    const existing: { id: string }[] = await manager.query(
      'SELECT id FROM companies WHERE slug = $1',
      [DEMO_COMPANY_SLUG],
    );
    if (existing[0]) {
      return { created: false, companyId: existing[0].id };
    }

    const tenant = await insert(manager, 'companies', {
      name: 'Công ty BĐS Demo',
      slug: DEMO_COMPANY_SLUG,
    });

    const roleIds = new Map<RoleCode, string>();
    for (const [code, name] of ROLES) {
      roleIds.set(
        code,
        await insert(manager, 'roles', { tenant_id: tenant, code, name, is_system: true }),
      );
    }
    const permissions: { id: string; code: string }[] = await manager.query(
      'SELECT id, code FROM permissions',
    );
    const permissionIds = new Map(permissions.map((p) => [p.code, p.id]));
    for (const [code, scopes] of Object.entries(DEFAULT_ROLE_MATRIX)) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) {
        throw new Error(`Thiếu permission ${code}`);
      }
      for (const [index, [roleCode]] of ROLES.entries()) {
        const scope = scopes[index];
        if (scope) {
          await manager.query(
            'INSERT INTO role_permissions (role_id, permission_id, scope) VALUES ($1, $2, $3)',
            [roleIds.get(roleCode), permissionId, scope],
          );
        }
      }
    }

    const userIds = new Map<UserKey, string>();
    for (const [index, user] of USERS.entries()) {
      const id = await insert(manager, 'users', {
        tenant_id: tenant,
        email: demoEmail(user.key),
        phone: `+8490000000${index + 1}`,
        password_hash: passwordHash,
        full_name: user.fullName,
      });
      userIds.set(user.key, id);
      await manager.query(
        'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)',
        [id, roleIds.get(user.role), tenant],
      );
    }
    const userId = (key: UserKey): string => {
      const id = userIds.get(key);
      if (!id) {
        throw new Error(`Thiếu user ${key}`);
      }
      return id;
    };
    const agents = [userId('agent1'), userId('agent2'), userId('agent3')];

    const department = await insert(manager, 'departments', {
      tenant_id: tenant,
      name: 'Phòng Kinh doanh',
      manager_id: userId('manager'),
    });
    await manager.query('UPDATE users SET department_id = $1 WHERE tenant_id = $2', [
      department,
      tenant,
    ]);
    const team = await insert(manager, 'teams', {
      tenant_id: tenant,
      department_id: department,
      name: 'Team Nha Trang',
      leader_id: userId('manager'),
    });
    for (const agent of agents) {
      await manager.query(
        'INSERT INTO team_members (tenant_id, team_id, user_id) VALUES ($1, $2, $3)',
        [tenant, team, agent],
      );
    }

    const { province, wards } = await seedLocations(manager);

    const owners: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      owners.push(
        await insert(manager, 'owners', {
          tenant_id: tenant,
          full_name: `Chủ nhà ${i + 1}`,
          phone: `+8491100000${i}`,
          created_by: agents[i % agents.length],
        }),
      );
    }

    for (let i = 0; i < 20; i += 1) {
      const type = PROPERTY_TYPES[i % PROPERTY_TYPES.length] ?? 'HOUSE';
      const wardIndex = i % WARDS.length;
      const ward = WARDS[wardIndex];
      if (!ward) {
        throw new Error('Thiếu phường demo');
      }
      const [, wardName, lat, lng] = ward;
      const area = 50 + ((i * 17) % 150);
      const agent = agents[i % agents.length];
      await insert(manager, 'properties', {
        tenant_id: tenant,
        code: `DEMO-${String(i + 1).padStart(3, '0')}`,
        title: `${PROPERTY_NAMES[type]} ${area} m² phường ${wardName}`,
        description: `${PROPERTY_NAMES[type]} demo, gần trung tâm, đường ô tô.`,
        property_type: type,
        price: (1_500 + i * 350) * 1_000_000,
        area,
        bedrooms: type === 'LAND_PLOT' ? null : 1 + (i % 4),
        bathrooms: type === 'LAND_PLOT' ? null : 1 + (i % 3),
        floors: type === 'LAND_PLOT' || type === 'APARTMENT' ? null : 1 + (i % 3),
        direction: DIRECTIONS[i % DIRECTIONS.length],
        road_width: 4 + (i % 5) * 2,
        road_access: i % 3 === 0 ? 'MOTORBIKE' : 'CAR',
        legal_status: LEGAL[i % LEGAL.length],
        province_id: province,
        ward_id: wards[wardIndex],
        street_address: `${10 + i} đường Demo ${wardIndex + 1}`,
        latitude: (lat + ((i % 5) - 2) * 0.003).toFixed(6),
        longitude: (lng + ((i % 3) - 1) * 0.003).toFixed(6),
        status: STATUSES[i % STATUSES.length],
        agent_id: agent,
        owner_id: owners[i % owners.length],
        source: 'OWNER_DIRECT',
        commission_type: 'PERCENT',
        commission_value: 1.5,
        created_by: agent,
      });
    }

    for (const [i, fullName] of CUSTOMER_NAMES.entries()) {
      const agent = agents[i % agents.length];
      const customer = await insert(manager, 'customers', {
        tenant_id: tenant,
        full_name: fullName,
        phone: `+8492200000${i}`,
        purpose: i % 3 === 0 ? 'INVESTMENT' : 'LIVING',
        purchase_timeline: 'WITHIN_3_MONTHS',
        source: CUSTOMER_SOURCES[i % CUSTOMER_SOURCES.length],
        agent_id: agent,
        status: CUSTOMER_STATUSES[i % CUSTOMER_STATUSES.length],
        created_by: agent,
      });
      await insert(manager, 'customer_preferences', {
        tenant_id: tenant,
        customer_id: customer,
        property_types: [PROPERTY_TYPES[i % PROPERTY_TYPES.length]],
        budget_min: (2_000 + i * 300) * 1_000_000,
        budget_max: (4_000 + i * 500) * 1_000_000,
        area_min: 50,
        bedrooms_min: 2,
        province_ids: [province],
        ward_ids: [wards[i % wards.length]],
      });
    }

    return { created: true, companyId: tenant };
  });
}
