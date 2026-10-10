import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAiStatus } from '../../../../lib/ai.ts';
import { currentUser } from '../../../../lib/auth/auth-api.ts';
import { hasPermission } from '../../../../lib/auth/permissions.ts';
import { accessToken } from '../../../../lib/auth/server-session.ts';
import { DEAL_STAGE_LABELS, formatMoney, getDeal } from '../../../../lib/deals.ts';
import { getUser } from '../../../../lib/users.ts';
import { DeleteButton } from '../../delete-button.tsx';
import { aiAssistAction, changeStageAction, deleteDealAction } from '../actions.ts';
import { AiAssistant } from '../ai-assistant.tsx';
import { StageForm } from '../stage-form.tsx';

export const dynamic = 'force-dynamic';

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Đã tạo giao dịch.',
  updated: 'Đã lưu thay đổi.',
  stage: 'Đã chuyển bước.',
};

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const day = (iso: string | null): string => (iso ? dateFormat.format(new Date(iso)) : '—');

/**
 * Chi tiết giao dịch (TASK-110) và các thao tác; AI bật thì có trợ lý bán hàng (TASK-142). Nút chỉ hiện khi có `deal.manage`; backend vẫn kiểm phạm
 * vi theo từng giao dịch và báo lỗi cạnh nút.
 */
export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const token = await accessToken();
  const [me, deal, ai] = await Promise.all([
    currentUser(token),
    getDeal(token, id),
    getAiStatus(token),
  ]);
  if (!deal.ok && (deal.status === 404 || deal.status === 400)) {
    notFound();
  }
  if (!deal.ok) {
    return (
      <main className="page">
        <p>
          <Link href="/deals">← Giao dịch</Link>
        </p>
        <div className="card">
          <p className="form-error" role="alert">
            {deal.status === 403 ? 'Bạn chưa có quyền xem giao dịch.' : deal.message}
          </p>
        </div>
      </main>
    );
  }
  const can = (code: string) => me.ok && hasPermission(me.data, code);
  const data = deal.data;
  const agent = can('user.view') ? await getUser(token, data.agentId) : null;

  return (
    <main className="page">
      <p>
        <Link href="/deals">← Giao dịch</Link>
      </p>
      <div className="page-heading">
        <div>
          <h1>
            {data.customer.fullName} · {data.property.code}
          </h1>
          <p className="muted">
            <span className={`badge badge-deal-${data.stage.toLowerCase()}`}>
              {DEAL_STAGE_LABELS[data.stage] ?? data.stage}
            </span>
            {data.closedAt && <> · đóng ngày {day(data.closedAt)}</>}
          </p>
        </div>
        {can('deal.manage') && (
          <Link href={`/deals/${data.id}/edit`} className="button">
            Sửa
          </Link>
        )}
      </div>
      {typeof saved === 'string' && SAVED_MESSAGES[saved] && (
        <p className="form-success" role="status">
          {SAVED_MESSAGES[saved]}
        </p>
      )}

      <section className="card">
        <h2>Thông tin</h2>
        <dl className="details">
          <dt>Khách</dt>
          <dd>
            {can('customer.view') ? (
              <Link href={`/customers/${data.customer.id}`}>{data.customer.fullName}</Link>
            ) : (
              data.customer.fullName
            )}
          </dd>
          <dt>BĐS</dt>
          <dd>
            {can('property.view') ? (
              <Link href={`/properties/${data.property.id}`}>
                {data.property.code} · {data.property.title}
              </Link>
            ) : (
              `${data.property.code} · ${data.property.title}`
            )}
          </dd>
          <dt>Giá chốt</dt>
          <dd>{formatMoney(data.dealPrice)}</dd>
          <dt>Tiền cọc</dt>
          <dd>{formatMoney(data.depositAmount)}</dd>
          <dt>Ngày cọc</dt>
          <dd>{day(data.depositAt)}</dd>
          <dt>Môi giới</dt>
          <dd>{agent?.ok ? agent.data.fullName : '—'}</dd>
          <dt>Ngày tạo</dt>
          <dd>{day(data.createdAt)}</dd>
        </dl>
        {data.notes && <p className="prewrap">{data.notes}</p>}
      </section>

      {ai.ok && ai.data.enabled && (
        <section className="card">
          <h2>Trợ lý bán hàng AI</h2>
          <p className="muted">
            AI đọc giao dịch, BĐS, nhu cầu và hoạt động gần nhất của khách rồi gợi ý cách đưa giao
            dịch sang bước tiếp theo. Mỗi lần hỏi tính một lượt AI.
          </p>
          <AiAssistant action={aiAssistAction.bind(null, data.id)} remaining={ai.data.remaining} />
        </section>
      )}

      {can('deal.manage') && (
        <section className="card">
          <h2>Bước giao dịch</h2>
          <p className="muted">
            Chuyển sang "Thành công" cần có giá chốt; giá này được tính vào doanh thu trên trang
            tổng quan.
          </p>
          <StageForm
            action={changeStageAction.bind(null, data.id, data.updatedAt)}
            stage={data.stage}
          />
        </section>
      )}

      {can('deal.manage') && (
        <section className="card">
          <h2>Xoá giao dịch</h2>
          <p className="muted">
            Giao dịch bị ẩn khỏi mọi danh sách và không còn tính vào báo cáo. Giao dịch không thành
            thì nên chọn "Thất bại" thay vì xoá.
          </p>
          <DeleteButton
            action={deleteDealAction.bind(null, data.id)}
            label="Xoá giao dịch"
            confirmText="Xoá giao dịch này?"
          />
        </section>
      )}
    </main>
  );
}
