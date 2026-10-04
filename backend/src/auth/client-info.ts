import { isIP } from 'node:net';

/** Thông tin thiết bị lưu cùng phiên đăng nhập, để sau này user xem/thu hồi phiên. */
export interface ClientInfo {
  deviceInfo: string | null;
  ipAddress: string | null;
}

export interface ClientRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

const DEVICE_INFO_MAX_LENGTH = 255;

/** Lấy User-Agent (cắt còn 255 ký tự) và IP của request; IP không hợp lệ thì bỏ qua. */
export function clientInfoFrom(req: ClientRequest): ClientInfo {
  const userAgent = req.headers['user-agent'];
  const deviceInfo =
    typeof userAgent === 'string' && userAgent.trim() !== ''
      ? userAgent.trim().slice(0, DEVICE_INFO_MAX_LENGTH)
      : null;
  const ip = req.ip ?? req.socket?.remoteAddress;
  return { deviceInfo, ipAddress: ip && isIP(ip) ? ip : null };
}
