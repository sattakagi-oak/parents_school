// ============================================================
// LINE配信の文面・選択肢はすべてこのファイルで管理します。
// 文面を変えるときはこのファイルだけ編集すればOKです。
// 注意: 選択肢の value（内部値）はDBに保存される値なので、変更しないでください。
//       ラベル（label）は20文字以内（LINEクイックリプライの制限）。
// ============================================================

/** 3問セグメント。配列の順番が出題順。 */
export const QUESTIONS = [
  {
    key: 'grade', // DBカラム名
    text: 'お子さんの学年を教えてください。',
    options: [
      { value: 'preschool', label: '年長以下' },
      { value: 'grade_1', label: '小1' },
      { value: 'grade_2', label: '小2' },
      { value: 'grade_3', label: '小3' },
      { value: 'grade_4_plus', label: '小4以上' },
    ],
  },
  {
    key: 'exam_intent',
    text: '中学受験について、今のお考えに一番近いものを教えてください。',
    options: [
      { value: 'planned', label: '受験する予定' },
      { value: 'considering_high', label: 'かなり前向きに検討中' },
      { value: 'considering', label: 'まだ迷っている' },
      { value: 'not_planned', label: '今のところ予定なし' },
    ],
  },
  {
    key: 'interest',
    text: '今、一番知りたいことはどれですか？',
    options: [
      { value: 'what_to_do_now', label: '今の年齢で何をやるべきか' },
      { value: 'study_habits', label: '学習習慣のつけ方' },
      { value: 'parenting_communication', label: '親の声かけ・関わり方' },
      { value: 'juku_timing', label: '入塾時期・塾選び' },
      { value: 'exam_decision', label: '中学受験するかどうかの判断' },
    ],
  },
];

/** このテキストをユーザーが送ると3問を最初から開始（既存友だち向け導線用） */
export const START_KEYWORDS = ['3問に回答する', '診断スタート'];

/** テスト用アカウント登録（運営者のみ）。「テスト登録 <合言葉>」「テスト解除」 */
export const TEST_REGISTER_PREFIX = 'テスト登録';
export const TEST_UNREGISTER_TEXT = 'テスト解除';
export const TEST_REGISTERED =
  'テスト用アカウントとして登録しました。\n\n「3問に回答する」と送ると、3問セグメントのテストを始められます。\n解除するときは「テスト解除」と送ってください。';
export const TEST_UNREGISTERED = 'テスト用アカウントの登録を解除しました。';

export const SEGMENT_INTRO =
  'ご登録ありがとうございます。\n\nお子さんに合った情報をお届けするため、かんたんな3つの質問にお答えください（ボタンを選ぶだけ・約10秒）。';

export const SEGMENT_COMPLETE = `ありがとうございます。

これから数日間、
「中学受験が本格化する前に、親として知っておきたいこと」
を少しずつお届けします。

先取り学習をたくさんすればいい、という話ではありません。

今の年齢だからこそ大切なこと、
逆にまだやらなくていいこと、
子どもが伸びやすくなる親の関わり方などをお伝えしていきます。`;

export const SEGMENT_UPDATED = '回答を更新しました。ありがとうございます。';

/** 1,000円診断CTA */
export const DIAGNOSIS = {
  name: 'わが家の中学受験準備診断',
  priceLabel: '60分 1,000円',
  buttonLabel: '診断の詳細・お申し込み',
};

// ------------------------------------------------------------
// 7日間の教育配信。day: 3問回答日を0日目として何日目に送るか。
// cta: true のステップは診断CTA（申込済みユーザーには送らない）。
// ------------------------------------------------------------
export const EDUCATION_STEPS = [
  {
    day: 0,
    key: 'edu:day0',
    text: `【1日目】中学受験は、小4から突然始まるものではありません

「中学受験は小4から塾に通って始めるもの」
そう思われている方は多いのですが、実際には、

・机に向かう習慣
・わからない問題に向き合う姿勢
・「考えるのが楽しい」という感覚

といった土台は、低学年のうちに少しずつ育っています。

小4からの3年間で伸びる子の多くは、この土台がすでにできている子です。

今の時期は「先取り」ではなく「土台づくり」の時期。
明日は、この時期に一番避けたいことをお伝えします。`,
  },
  {
    day: 1,
    key: 'edu:day1',
    text: `【2日目】低学年で避けたいのは、勉強を「やらされるもの」にすること

低学年のうちは、親が言えば机に向かってくれます。
でもその結果、

「勉強＝親に言われてやるもの」

という感覚が根づいてしまうと、学年が上がって量が増えたときに一気に苦しくなります。

大切なのは、何をやらせるかより「どう関わるか」。

・終わったら結果より取り組んだ姿勢を認める
・すぐに答えを教えず「どう考えた？」と聞く
・毎日同じ時間に短く取り組む

こうした関わり方の積み重ねが、自分から机に向かう子につながっていきます。`,
  },
  {
    day: 2,
    key: 'edu:day2',
    text: `【3日目】今やること、まだやらなくていいこと

低学年の保護者の方からよく「今から何を先取りすればいいですか？」と聞かれます。

答えは「先取り競争をする必要はありません」。

今やりたいこと：
・毎日の短い学習習慣
・計算や音読など基礎の反復
・読書や会話で言葉を増やすこと
・図形やパズルで考える経験

まだやらなくていいこと：
・受験用の難しい問題集
・長時間の机上学習
・学年を大きく超える先取り

年齢に応じた優先順位があります。今の時期にしかできないことを大切にしてください。`,
  },
  {
    day: 3,
    key: 'edu:day3',
    text: `【4日目】「子ども3人が東大」だけではありません

改めて、少し自己紹介をさせてください。

・自身の子ども3人を東京大学へ
・学習塾の経営・指導に約30年
・数百組の親子を見てきました
・教育関連の著書あり、現在も学習塾を運営

「3人とも東大」と聞くと特別な家庭の話に聞こえるかもしれません。
ですが、お伝えしているのは我が家の成功談ではなく、30年間、数百組の親子と向き合う中で見えてきた「伸びる家庭に共通すること」です。

どのご家庭でも取り入れられる形でお伝えしていきます。`,
  },
  {
    day: 4,
    key: 'edu:day4',
    text: `【5日目】小4・小5になってから多いご相談

塾に通い始めてから、こんなご相談をよくいただきます。

・自分から勉強しない
・宿題のたびに親子げんかになる
・塾の勉強が回らない
・何を優先すべきかわからない

どれも珍しいことではなく、多くのご家庭が通る道です。

ただ、振り返ると低学年のうちの「関わり方」や「習慣」で、負担をずいぶん軽くできたケースが少なくありません。

今の時期の小さな積み重ねが、数年後の親子の余裕につながります。`,
  },
  {
    day: 5,
    key: 'edu:day5',
    text: `【6日目】わが家は今のままで大丈夫？ セルフチェック

当てはまるものがいくつあるか、数えてみてください。

□ 親が言わないと勉強しない
□ 正解・不正解を親がすぐ教えている
□ 学習習慣が日によってバラバラ
□ 中学受験に向けて今何をすべきかわからない
□ 入塾までに何を準備するべきかわからない

2つ以上当てはまっても心配はいりません。
「今気づけた」ことが一番大切です。

明日は、こうしたことを「わが家の場合」で整理できる方法をご案内します。`,
  },
  {
    day: 6,
    key: 'edu:day6_cta',
    cta: true,
    text: `【7日目】「わが家の場合」を整理しませんか

ここまでお読みいただきありがとうございました。
一般論はわかっても、「うちの子の場合はどうなのか」は、ご家庭ごとに違います。

そこで、「わが家の中学受験準備診断」をご用意しました。

60分で、
・今やるべきこと
・まだやらなくていいこと
・入塾までに整えたいこと
・お子さんに合った親の関わり方
・今後6〜12か月の方向性
を整理します。

お悩み相談ではなく、「わが家の場合」の方針がわかる60分です。`,
  },
];

// ------------------------------------------------------------
// LINEメッセージオブジェクトの組み立て（通常は編集不要）
// ------------------------------------------------------------

export function questionMessage(questionKey, { withIntro = false } = {}) {
  const q = QUESTIONS.find((x) => x.key === questionKey);
  const idx = QUESTIONS.indexOf(q);
  const msg = {
    type: 'text',
    text: `Q${idx + 1}. ${q.text}`,
    quickReply: {
      items: q.options.map((o) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: o.label,
          displayText: o.label,
          data: `action=segment&question=${q.key}&value=${o.value}`,
        },
      })),
    },
  };
  return withIntro ? [{ type: 'text', text: SEGMENT_INTRO }, msg] : [msg];
}

export function educationMessages(step, { ctaUrl } = {}) {
  if (!step.cta) return [{ type: 'text', text: step.text }];
  return [
    { type: 'text', text: step.text },
    {
      type: 'flex',
      altText: `${DIAGNOSIS.name}（${DIAGNOSIS.priceLabel}）`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: DIAGNOSIS.name, weight: 'bold', size: 'lg', wrap: true },
            { type: 'text', text: DIAGNOSIS.priceLabel, size: 'md', color: '#555555' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'button', style: 'primary', action: { type: 'uri', label: DIAGNOSIS.buttonLabel, uri: ctaUrl } },
          ],
        },
      },
    },
  ];
}
