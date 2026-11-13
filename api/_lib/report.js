// 個別診断レポートの組み立て。入力（data）から、スマホで読むHTMLを作る。
//   full:   本人に送る完全版
//   teaser: LINEで見せる見本。途中で切り、続きは鍵付きの見出しと「個別診断を受けてみて」の案内にする
// 入力はすべてエスケープする（みほ先生の入力でも、相手の言葉を引用するため）。

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl = (s) => esc(s).replace(/\n/g, '<br>');

export const TYPES = [
  { key: 'jiyu', label: '自由', name: '自由型', desc: '自分で決める余地があると、ぐんと動きやすくなるタイプです。' },
  { key: 'kodawari', label: 'こだわり', name: 'こだわり型', desc: '「なぜやるのか」に納得できると、粘り強く取り組めるタイプです。' },
  { key: 'kyokan', label: '共感', name: '共感型', desc: '「一緒に」が安心につながり、気持ちが乗ると力を発揮するタイプです。' },
  { key: 'mokuhyo', label: '目標', name: '目標型', desc: 'ゴールが見えると集中しやすく、達成感で伸びるタイプです。' },
];

/** 点数（1〜5）から、いちばん強いタイプと次に強いタイプ */
export function rankTypes(scores = {}) {
  return TYPES.map((t) => ({ ...t, score: Number(scores[t.key]) || 0 })).sort((a, b) => b.score - a.score);
}

/** 4タイプのレーダー図（上:自由 右:こだわり 下:共感 左:目標） */
function radar(scores = {}) {
  const c = 75, u = 12;
  const v = (k) => Math.max(0, Math.min(5, Number(scores[k]) || 0)) * u;
  const pts = [[c, c - v('jiyu')], [c + v('kodawari'), c], [c, c + v('kyokan')], [c - v('mokuhyo'), c]].map((p) => p.join(',')).join(' ');
  return `<svg viewBox="0 0 150 150" width="150" height="150" aria-label="4つのタイプのバランス">
<g fill="none" stroke="#e3e8ef"><polygon points="75,15 135,75 75,135 15,75"/><polygon points="75,39 111,75 75,111 39,75"/><line x1="75" y1="15" x2="75" y2="135"/><line x1="15" y1="75" x2="135" y2="75"/></g>
<polygon points="${pts}" fill="rgba(223,189,103,.35)" stroke="#b48a25" stroke-width="2"/>
<g font-size="11" font-weight="700" fill="#56657a" text-anchor="middle"><text x="75" y="10">自由</text><text x="143" y="79" text-anchor="end">こだわり</text><text x="75" y="148">共感</text><text x="7" y="79" text-anchor="start">目標</text></g></svg>`;
}

const list = (a) => (Array.isArray(a) ? a : []).filter((x) => x && (typeof x === 'string' ? x.trim() : Object.values(x).some((v) => String(v || '').trim())));

function header(d, { sample }) {
  return `${sample ? '<div class="sample">サンプル（架空の例です）</div>' : ''}
<header class="head">
  <div class="kicker">PERSONAL DIAGNOSIS REPORT</div>
  <h1 class="mincho">わが子の強み・伸ばし方<br>個別診断レポート</h1>
  <div class="meta">
    <span>お名前</span><b>${esc(d.family_name)} さま</b>
    <span>お子さん</span><b>${esc(d.child_name)}${d.grade_label ? `（${esc(d.grade_label)}）` : ''}</b>
    <span>診断日</span><b>${esc(d.date)}</b>
    <span>担当</span><b>高木 美保（みほ先生）</b>
  </div>
  ${d.report_no ? `<div class="no">No. ${esc(String(d.report_no).padStart(4, '0'))}</div>` : ''}
</header>`;
}

function worry(d) {
  return `<section><h2 class="sec-title mincho"><span class="n">1</span>今回のお悩み</h2>
<div class="worry">「${nl(d.worry)}」<small>（事前アンケートと面談でお聞きした内容より）</small></div></section>`;
}

function typeBlock(d) {
  const [first, second] = rankTypes(d.types);
  return `<span class="label">お子さんのタイプ</span>
<div class="type-wrap">${radar(d.types)}
  <div class="type-main">いちばん強いタイプ<b class="mincho">${esc(first.name)}</b>
  ${second.score ? `<div class="subtype">次に強いのは <b style="display:inline;font-size:14px;color:var(--navy)">${esc(second.name)}</b></div>` : ''}</div>
</div>
<div class="type-desc">${nl(d.type_desc || first.desc)}</div>`;
}

function strengthsBlock(d) {
  return `<div class="block"><span class="label">今伸びている力・強み</span><ul class="strengths">
${list(d.strengths).map((s) => `<li><b>${esc(s.title)}</b><span>${esc(s.detail)}</span></li>`).join('')}</ul></div>`;
}

function checkBlock(d) {
  const c = d.check || {};
  const n = Number(c.count);
  return `<div class="block"><span class="label">親の関わりの傾向（チェックリストより）</span>
<div class="check"><div class="score"><b>${Number.isFinite(n) ? n : '-'}<small>/10</small></b><span>当てはまった数</span><div class="bar"><i style="width:${Number.isFinite(n) ? n * 10 : 0}%"></i></div></div>
<div class="tend">${c.tendency ? `多かったのは <b>「${esc(c.tendency)}」</b>` : ''}<ul>${list(c.items).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div></div></div>`;
}

function rest(d) {
  const actions = list(d.actions).map((a, i) => `<div class="act"><span class="num">${i + 1}</span><h3>${esc(a.title)}</h3>
<div class="say">${a.ng ? `<div class="ng">${esc(a.ng)}</div>` : ''}${a.ok ? `<div class="ok">${esc(a.ok)}</div>` : ''}</div>
${a.why ? `<p class="why"><b>なぜ：</b>${nl(a.why)}</p>` : ''}</div>`).join('');
  const road = (d.road || []);
  const roadLabels = ['今〜3か月', '3〜6か月', '6〜12か月'];
  return `<div class="block"><span class="label">お悩みの原因の見立て</span><div class="cause">${nl(d.cause)}</div></div></section>
<section><h2 class="sec-title mincho"><span class="n">3</span>今日からできる3つのこと</h2>${actions}</section>
<section><h2 class="sec-title mincho"><span class="n">4</span>まだ急がなくていいこと</h2>
<ul class="notyet">${list(d.notyet).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
${d.notyet_note ? `<p class="why" style="margin-top:12px">${nl(d.notyet_note)}</p>` : ''}</section>
<section><h2 class="sec-title mincho"><span class="n">5</span>これからの6〜12か月</h2><div class="road">
${roadLabels.map((l, i) => (road[i] ? `<div class="st"><b>${l}</b><span>${esc(road[i])}</span></div>` : '')).join('')}</div></section>
<section><h2 class="sec-title mincho"><span class="n">6</span>みほ先生から</h2>
<div class="letter"><img src="{{base}}/images/representative.jpg" alt="みほ先生"><p>${nl(d.message)}<span class="sign">高木 美保</span></p></div></section>
<footer class="foot"><b>2週間後に「試してみてどうでしたか？」とLINEでお聞きします。</b><br>困ったときは、いつでもこのLINEにどうぞ。<div class="brand">親の学習塾｜スクールオーク</div></footer>`;
}

function teaserRest() {
  return `</section><div class="teaser-fade"></div>
<div class="locked"><ul>
<li>親の関わりの傾向（チェックリストより）</li>
<li>お悩みの原因の見立て</li>
<li>今日からできる3つのこと（声かけ例つき）</li>
<li>まだ急がなくていいこと</li>
<li>これからの6〜12か月</li>
<li>みほ先生から</li>
</ul></div>
<div class="cta-box"><div class="s">この続きは、個別診断を受けた方だけに</div>
<h2 class="mincho">わが子専用の<br>「今日からできる3つのこと」が届きます</h2>
<p>Zoomで30分、みほ先生がお話を聞いて<br>お子さんに合わせて診断します。</p>
<div class="send">このLINEに<b>個別診断</b>と送るだけ</div>
<div class="price">30分 1,000円（延長あり）</div></div>
<div style="height:28px"></div>`;
}

/**
 * @param {object} d レポートの入力
 * @param {{mode?: 'full'|'teaser', sample?: boolean, base?: string}} opts base: 画像などの起点URL（末尾スラッシュなし）
 */
export function renderReport(d, { mode = 'full', sample = false, base = '' } = {}) {
  const body = mode === 'teaser'
    ? `${header(d, { sample })}${worry(d)}<section><h2 class="sec-title mincho"><span class="n">2</span>診断結果</h2>${typeBlock(d)}${strengthsBlock(d)}${teaserRest()}`
    : `${header(d, { sample })}${worry(d)}<section><h2 class="sec-title mincho"><span class="n">2</span>診断結果</h2>${typeBlock(d)}${strengthsBlock(d)}${checkBlock(d)}${rest(d)}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>個別診断レポート｜親の学習塾</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Klee+One:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/report/report.css"></head>
<body><div class="sheet">${body}</div></body></html>`.replaceAll('{{base}}', base);
}

/** 見本（架空の例） */
export const SAMPLE_REPORT = {
  family_name: 'サンプル 花子', child_name: 'ゆうくん', grade_label: '小学3年生', date: '2026年11月20日', report_no: 12,
  worry: '宿題を始めるまでに1時間かかります。声をかけると怒って、余計に始めなくなります。',
  types: { jiyu: 5, kodawari: 3, kyokan: 2, mokuhyo: 2 },
  type_desc: '自分で決める余地があると、ぐんと動きやすくなるタイプです。「なぜやるのか」に納得できると、粘り強く取り組めます。',
  strengths: [
    { title: '好きなことへの集中力', detail: 'レゴの作品づくりに、2時間黙々と取り組める' },
    { title: '納得したら最後までやり抜く力', detail: '理由がわかった漢字の書き取りは、自分から続けている' },
    { title: '自分の考えを言葉にする力', detail: '「なんでそうなるの？」と、筋道を立てて聞いてくる' },
  ],
  check: { count: 7, tendency: '先回り', items: ['No.1 宿題の時間・順番を親が決める', 'No.3 明日の準備を親が毎回チェック', 'No.7 わからない問題の答えをすぐ教える'] },
  cause: '自由型のゆうくんにとって、「始める時間」を親に決められることが、やる気を下げる一番の原因になっています。声をかけるほど「やらされている」と感じ、始める前から気持ちが離れてしまう状態です。',
  actions: [
    { title: '始める時間を、ゆうくんに決めてもらう', ng: '宿題やったの？', ok: '今日は何時から始める？', why: '自由型の子は、自分で決めたことは守ろうとします。決めた時間までは、声をかけずに待ちましょう。' },
    { title: 'わからない問題は、答えより先に「どこまでわかった？」', ng: 'ここはこうやるんでしょ', ok: 'どこまでわかった？', why: 'こだわり型の傾向があるので、自分で納得できると次の問題も自分で進めます。' },
    { title: '明日の準備は「準備表」に任せる', ng: '忘れ物ない？', ok: '準備表、どこまでチェックできた？', why: '親がチェックする役を、ゆうくんと一緒に作った表に渡します。声かけが減り、自分で確認する習慣がつきます。' },
  ],
  notyet: ['毎日の勉強時間を増やすこと', '苦手な計算を、今すぐ克服させること'],
  notyet_note: 'まずは「自分で始める」経験を積むことが先です。量や苦手克服は、そのあとで十分間に合います。',
  road: ['始める時間を自分で決める習慣をつける', '週に1回、自分で計画を立てて振り返る', 'わからないことを、自分で調べて解決する力を伸ばす'],
  message: 'ゆうくんは、自分で決めたことには本当に粘り強い子です。まずは「待つ」ことから。うまくいかない日があっても大丈夫ですよ。',
};
