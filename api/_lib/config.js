// 環境変数の読み取りと送信モード判定。
// ここ以外で LINE_SEND_MODE / LINE_SEND_ENABLED を直接読まないこと。

import { timingSafeEqual } from 'node:crypto';
import { isRegisteredTestUser } from './users.js';

const USER_ID_RE = /^U[0-9a-f]{32}$/;

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

export function requireEnv(name) {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * 実効送信モード。
 * - disabled   : 誰にも送らない（既定値。未設定・不正値もここに倒す）
 * - test       : LINE_TEST_USER_IDS に含まれるユーザーにだけ送る
 * - production : 全員に送る。LINE_SEND_MODE=production かつ LINE_SEND_ENABLED=true の両方が必要
 */
export function sendMode() {
  const mode = env('LINE_SEND_MODE').toLowerCase();
  if (mode === 'test') return 'test';
  if (mode === 'production' && env('LINE_SEND_ENABLED').toLowerCase() === 'true') return 'production';
  return 'disabled';
}

export function testUserIds() {
  return new Set(
    env('LINE_TEST_USER_IDS').split(/[\s,]+/).filter((id) => USER_ID_RE.test(id)),
  );
}

/** テスト送信対象か: LINE_TEST_USER_IDS またはLINEから登録済み（parent_line_test_users） */
export async function isTestUser(lineUserId) {
  if (!isValidLineUserId(lineUserId)) return false;
  return testUserIds().has(lineUserId) || isRegisteredTestUser(lineUserId);
}

/** 送信直前に必ず呼ぶ。{ ok: true } 以外なら絶対に送らない。 */
export async function sendPermission(lineUserId) {
  const mode = sendMode();
  if (mode === 'disabled') return { ok: false, reason: 'skipped_disabled' };
  if (mode === 'test' && !(await isTestUser(lineUserId))) return { ok: false, reason: 'skipped_not_test_user' };
  return { ok: true };
}

/**
 * LINEからのテスト登録用の合言葉。16文字未満・未設定なら登録機能は無効。
 * メッセージ本文と定数時間比較する。
 */
export function matchesTestRegisterCode(given) {
  const expected = env('LINE_TEST_REGISTER_CODE');
  if (expected.length < 16 || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidLineUserId(id) {
  return typeof id === 'string' && USER_ID_RE.test(id);
}

export function diagnosisUrl() {
  return env('PARENT_DIAGNOSIS_URL');
}

/**
 * 画像URL・CTAリンクの組み立てに使う公開URL（例: https://example.vercel.app）。
 * Vercel 上では手動設定ミスを避けるため、Vercel が自動設定するURLを優先する:
 *   Preview    → そのブランチ自身のURL（VERCEL_BRANCH_URL）
 *   Production → 本番ドメイン（VERCEL_PROJECT_PRODUCTION_URL）
 * Vercel 以外（ローカル等）では PUBLIC_BASE_URL。スキーム省略時は https を補う。
 */
export function publicBaseUrl() {
  const vercelEnv = env('VERCEL_ENV');
  let url = '';
  if (vercelEnv === 'preview' && env('VERCEL_BRANCH_URL')) url = env('VERCEL_BRANCH_URL');
  else if (vercelEnv === 'production' && env('VERCEL_PROJECT_PRODUCTION_URL')) url = env('VERCEL_PROJECT_PRODUCTION_URL');
  else url = env('PUBLIC_BASE_URL');
  if (!url) return '';
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export function secretEnv(name) {
  return env(name);
}
