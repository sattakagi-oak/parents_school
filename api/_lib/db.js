import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

// query(sql, params) → { rows } を持つオブジェクト（pg.Pool / テスト時は PGlite）
// 接続先は標準PostgreSQL（Neon）。DATABASE_URL は Neon の pooled 接続文字列（-pooler 付きホスト）。
let db = null;

export function getDb() {
  if (db) return db;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set');
  db = createPool(url);
  // Vercel Fluid compute で関数が停止する前にアイドル接続を閉じる（Vercel外では何もしない）
  attachDatabasePool(db);
  return db;
}

export function createPool(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Neon は公的CAの証明書なので検証ありTLS。pg は sslmode=require を verify-full として扱い警告を出すため明示する
  const connectionString = url.replace(/([?&])sslmode=require\b/, '$1sslmode=verify-full');
  return new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 5_000, ssl: local ? false : true });
}

/** テスト用 */
export function setDb(instance) {
  db = instance;
}
