// 個別診断レポートの組み立て。子どもを分析するのではなく「親がどう関わるか」を伝える。
// みほ先生の記入は5項目だけ（お悩み・タイプと強み1行・関わりの見立て・3つの関わり方・ひとこと）。
//   full:   本人に送る完全版
// 入力はすべてエスケープする（相手の言葉を引用するため）。

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl = (s) => esc(s).replace(/\n/g, '<br>');

/** お子さんのタイプ。届きやすい関わり方を定型文で添える（みほ先生は選ぶだけ） */
export const TYPES = [
  { key: 'jiyu', name: '自由型', desc: '自分で決める余地があると動きやすいタイプ。', tip: '「どうする？」と決める場面を渡すと、自分から動きやすくなります。' },
  { key: 'kodawari', name: 'こだわり型', desc: '「なぜやるのか」に納得できると、粘り強く取り組むタイプ。', tip: '先に理由を話し、本人が納得してから任せると続きます。' },
  { key: 'kyokan', name: '共感型', desc: '「一緒に」が安心につながるタイプ。', tip: '最初は隣で一緒に始め、少しずつ離れていくと動き出せます。' },
  { key: 'mokuhyo', name: '目標型', desc: 'ゴールが見えると集中しやすいタイプ。', tip: '「ここまでできたら完了」と終わりを見せると集中できます。' },
];
export const typeByKey = (k) => TYPES.find((t) => t.key === k) || null;

/** 親の関わりの傾向。説明は定型文（みほ先生は選ぶだけ） */
export const TENDENCIES = [
  { key: '先回り', desc: '困る前に、親が手や答えを出してしまう' },
  { key: '管理しすぎ', desc: '時間や順番を、親が決めてしまう' },
  { key: '口出し', desc: 'やり方や態度に、つい声をかけてしまう' },
  { key: '比較', desc: 'きょうだいや周りの子と比べてしまう' },
  { key: '結果へのこだわり', desc: '点数や結果に、反応が集中してしまう' },
];
const tendencyDesc = (k) => TENDENCIES.find((t) => t.key === k)?.desc || '';

/** 3つの関わり方の文例（入力画面で選んで直す） */
export const ACTION_PRESETS = [
  { title: '始める時間を、子どもに決めてもらう', ng: '宿題やったの？', ok: '今日は何時から始める？' },
  { title: '答えより先に「どこまでわかった？」と聞く', ng: 'ここはこうやるんでしょ', ok: 'どこまでわかった？' },
  { title: '明日の準備は「準備表」に任せる', ng: '忘れ物ない？', ok: '準備表、どこまでチェックできた？' },
  { title: '最初の1問だけ一緒にやって、離れる', ng: '早く一人でやりなさい', ok: '最初の1問だけ一緒にやろうか' },
  { title: '終わりを見える形にする', ng: 'いつまでやってるの', ok: '今日はここまでで完了にしよう' },
  { title: '結果より、取り組んだことを言葉にする', ng: 'なんでこの点数なの', ok: 'ここ、自分で考えて解いたんだね' },
  { title: '比べずに、その子の昨日と比べる', ng: 'お兄ちゃんはできたのに', ok: '昨日より早く始められたね' },
  { title: '言いたくなったら、10秒待つ', ng: '（すぐに注意する）', ok: '（10秒待って、本人が動くのを見る）' },
];

const list = (a) => (Array.isArray(a) ? a : []).filter((x) => x && Object.values(x).some((v) => String(v || '').trim()));

/**
 * @param {object} d 入力 { family_name, child_name, grade_label, date, report_no, worry, type, strength, tendency, check_count, view, actions:[{title,ng,ok}], message }
 * @param {{sample?: boolean, base?: string}} opts
 */
export function renderReport(d, { sample = false, base = '' } = {}) {
  const t = typeByKey(d.type);
  const n = Number(d.check_count);
  const hasCount = d.check_count !== '' && d.check_count != null && Number.isFinite(n);
  const actions = list(d.actions).slice(0, 3);
  const body = `${sample ? '<div class="sample">サンプル（架空の例です）</div>' : ''}
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
</header>

<section><h2 class="sec-title mincho"><span class="n">1</span>今回のお悩み</h2>
<div class="worry">「${nl(d.worry)}」<small>（事前アンケートと面談でお聞きした内容より）</small></div></section>

<section><h2 class="sec-title mincho"><span class="n">2</span>お子さんのタイプ</h2>
${t ? `<div class="type-one"><b class="mincho">${esc(t.name)}</b><p>${esc(t.desc)}</p>${d.strength ? `<p class="strength"><span>強み</span>${esc(d.strength)}</p>` : ''}</div>
<div class="type-desc"><b>このタイプに届きやすい関わり方：</b>${esc(t.tip)}</div>` : ''}</section>

<section><h2 class="sec-title mincho"><span class="n">3</span>いまの関わり方の見立て</h2>
<div class="check">
  ${hasCount ? `<div class="score"><b>${n}<small>/10</small></b><span>チェックリスト</span><div class="bar"><i style="width:${n * 10}%"></i></div></div>` : ''}
  <div class="tend">${d.tendency ? `多かったのは <b>「${esc(d.tendency)}」</b><ul><li>${esc(tendencyDesc(d.tendency))}</li></ul>` : ''}</div>
</div>
${d.view ? `<div class="cause" style="margin-top:12px">${nl(d.view)}</div>` : ''}</section>

<section><h2 class="sec-title mincho"><span class="n">4</span>今日からできる3つの関わり方</h2>
${actions.map((a, i) => `<div class="act"><span class="num">${i + 1}</span><h3>${esc(a.title)}</h3>
<div class="say">${a.ng ? `<div class="ng">${esc(a.ng)}</div>` : ''}${a.ok ? `<div class="ok">${esc(a.ok)}</div>` : ''}</div></div>`).join('')}
</section>

<section><h2 class="sec-title mincho"><span class="n">5</span>みほ先生から</h2>
<div class="letter"><img src="${base}/images/representative.jpg" alt="みほ先生"><p>${nl(d.message)}<span class="sign">高木 美保</span></p></div></section>

<footer class="foot"><b>2週間後に「試してみてどうでしたか？」とLINEでお聞きします。</b><br>困ったときは、いつでもこのLINEにどうぞ。<div class="brand">親の学習塾｜スクールオーク</div></footer>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>個別診断レポート｜親の学習塾</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Klee+One:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}/report/report.css"></head>
<body><div class="sheet">${body}</div></body></html>`;
}

/** 見本（架空の例） */
export const SAMPLE_REPORT = {
  family_name: 'サンプル 花子', child_name: 'ゆうくん', grade_label: '小学3年生', date: '2026年11月20日', report_no: 12,
  worry: '宿題を始めるまでに1時間かかります。声をかけると怒って、余計に始めなくなります。',
  type: 'jiyu', strength: '好きなことには、2時間でも集中できる', tendency: '管理しすぎ', check_count: 7,
  view: '「始める時間」を毎日お母さんが決めていることで、ゆうくんは「やらされている」と感じ、始める前から気持ちが離れています。声かけを減らし、決める場面をゆうくんに渡すことが近道です。',
  actions: [
    { title: '始める時間を、ゆうくんに決めてもらう', ng: '宿題やったの？', ok: '今日は何時から始める？' },
    { title: '決めた時間までは、声をかけずに待つ', ng: 'まだやらないの？', ok: '（時計を見て、決めた時間まで待つ）' },
    { title: '始められたら、結果より「始めたこと」を言葉にする', ng: 'やっと始めたの', ok: '自分で決めた時間に始めたね' },
  ],
  message: 'ゆうくんは、自分で決めたことには本当に粘り強い子です。まずはお母さんが「待つ」ことから。うまくいかない日があっても大丈夫ですよ。',
};
