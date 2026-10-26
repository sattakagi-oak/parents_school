// GET /api/analysis/apply?src=… — HP の「直接お支払い」リンク。個別分析の決済ページ（PARENT_DIAGNOSIS_URL）へ 302。
// URL は環境変数にだけ置き、公開リポジトリには書かない。どの入口から押されたか（src）だけをログに残す。

import { diagnosisUrl } from '../_lib/config.js';
import { log } from '../_lib/log.js';

export function GET(request) {
  const url = diagnosisUrl();
  if (!/^https:\/\//.test(url)) return new Response('not configured', { status: 503 });
  const src = new URL(request.url).searchParams.get('src');
  log.info('analysis direct apply', { src: /^[a-z0-9_-]{1,32}$/.test(src || '') ? src : 'unknown' });
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}
