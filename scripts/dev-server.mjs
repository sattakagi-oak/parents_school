// 手元で動かす確認用サーバー（npm run dev:local）。静的ファイルと api/ の関数をそのまま動かす。
// .env.local の接続先（開発用データベース）を使う。LINEへの送信はしない（管理画面と表示だけ）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3100);
process.env.PUBLIC_BASE_URL = `http://localhost:${PORT}`;
process.env.LINE_SEND_MODE = 'disabled';
const ROUTES = { '/api/admin/report': 'api/admin/report.js', '/api/report': 'api/report.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const mod = ROUTES[url.pathname];
    if (mod) {
      const handler = (await import(pathToFileURL(join(ROOT, mod)).href))[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let p = join(ROOT, decodeURIComponent(url.pathname));
    if (!p.startsWith(ROOT) || p.includes(`${ROOT}/.`) || p.includes('.env')) { res.writeHead(404).end(); return; }
    if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.code === 'ENOENT' ? 'not found' : 'error');
    if (err.code !== 'ENOENT') console.error(err.message);
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/admin/report/`));
