// DBマイグレーション: npm run db:migrate
// db/migrations/*.sql をファイル名順に、未適用のものだけ1ファイル1トランザクションで適用し schema_migrations に記録する。
// 開発・Preview・Production それぞれのDB（Neonブランチ）に対して同じコマンドで再現できる。
// 接続先: DATABASE_URL_UNPOOLED（Neon直結。DDL向け）→ なければ DATABASE_URL
//   例) npm run db:migrate                          … .env.local の接続先
//       DATABASE_URL=... node scripts/migrate.mjs   … 明示指定
import { readdir, readFile } from 'node:fs/promises';
import { createPool } from '../api/_lib/db.js';

const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error('DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set');
  process.exit(1);
}
const host = new URL(url).hostname; // ログには接続先ホストだけ出す（認証情報は出さない）
const pool = createPool(url);
const client = await pool.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  await client.query('select pg_advisory_lock(815001)'); // 同時実行防止
  const { rows } = await client.query('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const dir = new URL('../db/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    await client.query('begin');
    try {
      await client.query(await readFile(new URL(file, dir), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
    console.log(`applied ${file}`);
    count++;
  }
  console.log(`${host}: ${count} applied, ${files.length - count} already up to date`);
} finally {
  await client.query('select pg_advisory_unlock(815001)').catch(() => {});
  client.release();
  await pool.end();
}
