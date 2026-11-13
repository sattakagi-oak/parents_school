// みほ先生用の「押すだけで開ける」記入フォームURL。
// その人（parent_line_users.id）専用・期限つきの署名を付ける。管理パスワード（ADMIN_API_TOKEN）を署名の鍵に使う。
// 転送されても、その1人のレポートの記入・送信しかできない（一覧や他の人は見られない）。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretEnv, publicBaseUrl } from './config.js';

const DAYS = 30;

function sign(userId, exp) {
  const key = secretEnv('ADMIN_API_TOKEN');
  if (key.length < 32) return null;
  return createHmac('sha256', key).update(`report-form:${userId}:${exp}`).digest('hex');
}

/** @returns {string|null} 記入フォームのURL（鍵が未設定なら null） */
export function reportFormUrl(userId, { now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + DAYS * 86400;
  const k = sign(userId, exp);
  const base = publicBaseUrl();
  if (!k || !base) return null;
  return `${base}/admin/report/?user=${encodeURIComponent(userId)}&exp=${exp}&k=${k}`;
}

/** 署名を確かめる。正しく期限内なら true */
export function verifyFormKey(userId, exp, k, { now = Date.now() } = {}) {
  if (!userId || !/^\d{9,11}$/.test(String(exp || '')) || !/^[0-9a-f]{64}$/.test(k || '')) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = sign(userId, exp);
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(k));
}
