import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { setDb } from '../api/_lib/db.js';

// テスト専用のダミー値（本物のSecret/Tokenは使わない）
export const SECRET = 'test-channel-secret';
export const CRON_SECRET = 'c'.repeat(40);
export const ADMIN_TOKEN = 'a'.repeat(40);
export const OWNER = 'U' + '0'.repeat(32);
export const OTHER = 'U' + '1'.repeat(32);

export function baseEnv(overrides = {}) {
  for (const k of Object.keys(process.env)) {
    if (/^(LINE_|DATABASE_URL|CRON_SECRET|ADMIN_API_TOKEN|PARENT_DIAGNOSIS_URL|PUBLIC_BASE_URL)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, {
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: 'dummy-token',
    LINE_SEND_ENABLED: 'false',
    LINE_SEND_MODE: 'disabled',
    CRON_SECRET,
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    PUBLIC_BASE_URL: 'https://example.test',
    PARENT_DIAGNOSIS_URL: 'https://forms.example.test/diagnosis',
    ...overrides,
  });
}

export async function freshDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../db/migrations/001_parent_line.sql', import.meta.url), 'utf8'));
  setDb(db);
  return db;
}

/** LINE APIへの fetch を横取りして記録する。status を関数で差し替え可能。 */
export function stubLine({ status = () => 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const call = { url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (u.includes('/profile/')) return new Response(JSON.stringify({ displayName: 'テスト保護者', pictureUrl: 'x' }), { status: 200 });
    const s = status(call);
    return new Response(s === 200 ? '{}' : '{"message":"err"}', { status: s });
  };
  calls.sends = () => calls.filter((c) => c.url.includes('/message/'));
  return calls;
}

export function signedRequest(body, { secret = SECRET, signature } = {}) {
  const raw = JSON.stringify(body);
  const sig = signature ?? createHmac('sha256', secret).update(raw).digest('base64');
  return new Request('https://example.test/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': sig },
    body: raw,
  });
}

export function ev(type, userId, extra = {}) {
  return {
    type,
    mode: 'active',
    timestamp: Date.now(),
    webhookEventId: randomBytes(8).toString('hex'),
    replyToken: randomBytes(8).toString('hex'),
    source: { type: 'user', userId },
    ...extra,
  };
}

export const postback = (userId, data) => ev('postback', userId, { postback: { data } });
export const answer = (userId, question, value) => postback(userId, `action=segment&question=${question}&value=${value}`);

export async function user(db, lineUserId) {
  const { rows } = await db.query('select * from parent_line_users where line_user_id = $1', [lineUserId]);
  return rows[0];
}

export async function logs(db, lineUserId) {
  const { rows } = await db.query('select * from parent_line_message_logs where line_user_id = $1 order by created_at', [lineUserId]);
  return rows;
}
