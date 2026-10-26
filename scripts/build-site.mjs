// HP のページを組み立てる: npm run build:site
//
// site-src/pages/*.html と site-src/column/*.html（中身だけ）に、共通のヘッダー・フッター・SEO タグを付けて
// <path>/index.html に書き出す。sitemap.xml も作る。生成物はそのままコミットする（Vercel 側にビルド工程はない）。
//
// 各ファイルの1行目は設定の JSON コメント:
//   <!--{"path":"about/","title":"…","description":"…","nav":"about","src":"about"}-->
//   path: 公開パス（トップは ""）／ nav: ヘッダーで現在地にする項目／ src: LINEボタンの入口名（site.js の LINE_URLS）
//   コラムは追加で "date":"2026-11-01","category":"…"。"draft":true なら noindex・一覧/サイトマップに出さない
// 本文中の {{root}} はサイトの起点への相対パス（/oya/ 配下でも動くよう、リンクはすべて相対にする）。

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 公開URL（スクールオークのサイトの配下）。canonical・OGP・サイトマップに使う */
export const SITE_URL = 'https://www.school-oak-m.jp/oya/';
export const LINE_URL = 'https://lin.ee/Ph97ydn';
const SITE_NAME = '親の学習塾｜スクールオーク';
// CSS/JS を更新したら URL が変わるように（ブラウザに古いファイルを使わせない）
const ver = (f) => createHash('sha1').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 8);
const CSS_V = ver('assets/site.css');
const JS_V = ver('assets/site.js');

const NAV = [
  ['', 'top', 'トップ'],
  ['about/', 'about', 'みほ先生について'],
  ['analysis/', 'analysis', '個別分析'],
  ['column/', 'column', 'コラム'],
  ['events/', 'events', 'イベント'],
];

function readPage(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^<!--(\{.*?\})-->\n?/s);
  if (!m) throw new Error(`設定コメントがありません: ${file}`);
  return { meta: JSON.parse(m[1]), body: raw.slice(m[0].length) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rootOf = (path) => (path ? '../'.repeat(path.split('/').filter(Boolean).length) : './');

function lineButton(root, src, label = '「親の習慣」チェックリストを受け取る', cls = '') {
  return `<a class="btn btn-line ${cls}" data-line="${src}" href="${LINE_URL}">${label}</a>`;
}

function layout({ meta, body }, extra = {}) {
  const root = rootOf(meta.path);
  const url = SITE_URL + meta.path;
  const title = meta.path ? `${meta.title}｜${SITE_NAME}` : meta.title;
  const robots = meta.draft || meta.noindex ? '<meta name="robots" content="noindex">' : '';
  const nav = NAV.map(([p, key, label]) =>
    `<a href="${root}${p}"${meta.nav === key ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const jsonld = extra.jsonld ? `<script type="application/ld+json">${JSON.stringify(extra.jsonld)}</script>` : '';
  const html = body.replaceAll('{{root}}', root).replaceAll('{{line_url}}', LINE_URL)
    .replace(/\{\{line_button(?::([^}|]*))?(?:\|([^}]*))?\}\}/g, (_, src, label) => lineButton(root, src || meta.src, label || undefined))
    .replace('{{column_list}}', extra.columnList || '')
    .replace('{{column_latest}}', extra.columnLatest || '');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description)}">
${robots}<link rel="canonical" href="${url}">
<meta property="og:type" content="${meta.date ? 'article' : 'website'}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}images/ogp-thumbnail.png">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}images/PS_logo.png">
<link rel="stylesheet" href="${root}assets/site.css?v=${CSS_V}">
${jsonld}
</head>
<body>
${meta.draft ? '<div class="draft-banner">下書き（検索には出ません）</div>\n' : ''}<header class="site-header"><div class="wrap">
<a class="brand" href="${root}"><img src="${root}images/logo.png" alt="スクールオーク" width="118" height="26"><span>親の学習塾</span></a>
<nav class="gnav">${nav}</nav>
<a class="btn btn-line btn-sm header-cta" data-line="${meta.src}" href="${LINE_URL}">LINEで受け取る</a>
</div></header>
<main>
${html.trim()}
</main>
<footer class="site-footer"><div class="wrap">
<div class="cols">
<div><b style="color:#fff">親の学習塾</b><br>スクールオーク ｜ 金沢市片町 ｜ 塾長 高木美保</div>
<nav>${nav}<a href="${root}line/">LINE登録</a></nav>
</div>
<small>© School Oak. All rights reserved.</small>
</div></footer>
<div class="sticky-cta"><a class="btn btn-line" data-line="${meta.src}" href="${LINE_URL}">チェックリストを無料で受け取る</a></div>
<script src="${root}assets/site.js?v=${JS_V}"></script>
</body>
</html>
`;
}

function write(path, html) {
  const dir = join(ROOT, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}

const ORG = { '@type': 'EducationalOrganization', name: '親の学習塾（スクールオーク）', url: SITE_URL };
const AUTHOR = { '@type': 'Person', name: '高木美保', jobTitle: 'スクールオーク塾長', url: `${SITE_URL}about/` };

// コラム
const columns = readdirSync(join(ROOT, 'site-src/column')).filter((f) => f.endsWith('.html'))
  .map((f) => readPage(join(ROOT, 'site-src/column', f)))
  .sort((a, b) => (b.meta.date || '').localeCompare(a.meta.date || ''));
const published = columns.filter((c) => !c.meta.draft);
const item = (c, root) =>
  `<a href="${root}${c.meta.path}"><span class="meta">${c.meta.date}${c.meta.category ? `｜${c.meta.category}` : ''}</span><b>${esc(c.meta.title)}</b></a>`;
const listOr = (items, root) => (items.length
  ? `<div class="list-links">${items.map((c) => item(c, root)).join('')}</div>`
  : '<p class="empty">コラムは準備中です。新しい記事はLINEでもお知らせします。</p>');

for (const c of columns) {
  write(c.meta.path, layout(c, {
    jsonld: {
      '@context': 'https://schema.org', '@type': 'Article', headline: c.meta.title, description: c.meta.description,
      datePublished: c.meta.date, author: AUTHOR, publisher: ORG, mainEntityOfPage: SITE_URL + c.meta.path,
    },
  }));
}

// 固定ページ
for (const f of readdirSync(join(ROOT, 'site-src/pages')).filter((x) => x.endsWith('.html'))) {
  const page = readPage(join(ROOT, 'site-src/pages', f));
  const root = rootOf(page.meta.path);
  write(page.meta.path, layout(page, {
    columnList: listOr(published, root),
    columnLatest: listOr(published.slice(0, 3), root),
    jsonld: page.meta.path === '' ? { '@context': 'https://schema.org', ...ORG, founder: AUTHOR } : null,
  }));
}

// サイトマップ（下書き・noindex を除く）
const pages = readdirSync(join(ROOT, 'site-src/pages')).filter((x) => x.endsWith('.html'))
  .map((f) => readPage(join(ROOT, 'site-src/pages', f)).meta).filter((m) => !m.noindex);
const urls = [...pages, ...published.map((c) => c.meta)]
  .map((m) => `  <url><loc>${SITE_URL}${m.path}</loc>${m.date ? `<lastmod>${m.date}</lastmod>` : ''}</url>`);
writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

console.log(`pages: ${pages.length}, columns: ${columns.length}（公開 ${published.length}）`);
