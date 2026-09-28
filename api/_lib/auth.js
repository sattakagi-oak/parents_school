import { timingSafeEqual } from 'node:crypto';
import { secretEnv } from './config.js';

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Authorization: Bearer <token> を環境変数の値と照合する。
 * 環境変数が未設定・短すぎる場合は常に拒否（=認証なしで通る状態を作らない）。
 */
export function checkBearer(request, envName) {
  const expected = secretEnv(envName);
  if (expected.length < 32) return false;
  const header = request.headers.get('authorization') || '';
  const m = header.match(/^Bearer (.+)$/);
  return Boolean(m) && safeEqual(m[1], expected);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
