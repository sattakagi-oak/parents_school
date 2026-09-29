// LINE Messaging API の最小クライアント。
// 送信系は reply（ユーザーの操作への返信）のみ。push / broadcast / multicast は意図的に実装しない。
// 送信関数は必ず sendPermission() を内部で再確認する（呼び出し側のチェック漏れ対策）。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv, sendPermission } from './config.js';

const API = 'https://api.line.me/v2/bot';

export function verifySignature(rawBody, signature) {
  if (!signature || typeof signature !== 'string') return false;
  const secret = requireEnv('LINE_CHANNEL_SECRET');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${requireEnv('LINE_CHANNEL_ACCESS_TOKEN')}`,
    'content-type': 'application/json',
    ...extra,
  };
}

class LineApiError extends Error {
  constructor(status) {
    super(`LINE API HTTP ${status}`);
    this.status = status;
  }
}

/** @returns {{sent: true} | {sent: false, reason: string}} */
export async function replyMessage(lineUserId, replyToken, messages) {
  const perm = await sendPermission(lineUserId);
  if (!perm.ok) return { sent: false, reason: perm.reason };
  const res = await fetch(`${API}/message/reply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) throw new LineApiError(res.status);
  return { sent: true };
}

/** プロフィール取得（送信ではない）。displayName だけ返す。失敗しても null。 */
export async function getDisplayName(lineUserId) {
  try {
    const res = await fetch(`${API}/profile/${encodeURIComponent(lineUserId)}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const p = await res.json();
    return typeof p.displayName === 'string' ? p.displayName.slice(0, 100) : null;
  } catch {
    return null;
  }
}
