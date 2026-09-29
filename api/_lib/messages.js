// ============================================================
// LINE自動返信の文面・選択肢はすべてこのファイルで管理します。
// 文面を変えるときはこのファイルだけ編集すればOKです。
// 注意: 選択肢の value（内部値）はDBに保存される値なので、変更しないでください。
//
// 自動で送るのは「友だち追加後の質問 → Q1→Q2→Q3 → 完了メッセージ＋診断CTA」まで。
// それ以降は美穂先生が LINE Official Account Manager から個別に手動返信します。
// ============================================================

/**
 * 3問アンケート。配列の順番が出題順。
 * - key: DBカラム名（Q3は「現在の悩み、またはこれから知りたいこと」。カラム名は interest を流用）
 * - tag: 回答時にトーク画面へ残る表示「【tag】選択肢」（美穂先生がトーク履歴で回答を確認するため）
 */
export const QUESTIONS = [
  {
    key: 'grade',
    tag: '学年',
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
    tag: '中学受験',
    text: '中学受験について、今のお考えに一番近いものを教えてください。',
    options: [
      { value: 'planned', label: '受験する予定' },
      { value: 'considering_high', label: 'かなり前向きに検討中' },
      { value: 'considering', label: 'まだ迷っている' },
      { value: 'not_planned', label: '今のところ予定なし' },
    ],
  },
  {
    key: 'interest', // = 現在の悩み、またはこれから知りたいこと
    tag: '気になること',
    text: '今、一番近いものはどれですか？',
    subText: '今困っていることでも、これから知りたいことでも大丈夫です。',
    options: [
      { value: 'what_to_prioritize', label: '今の年齢で何を優先すればいいか知りたい' },
      { value: 'study_habits', label: '学習習慣をどう作ればいいか気になる' },
      { value: 'parenting_communication', label: '親の声かけ・関わり方に迷うことがある' },
      { value: 'child_strengths', label: '子どもの得意・不得意に合う伸ばし方を知りたい' },
      { value: 'juku_timing', label: '入塾時期や塾選びが気になる' },
      { value: 'future_preparation', label: '今は特に困っていないが、今後の準備を知りたい' },
    ],
  },
];

/** このテキストをユーザーが送ると3問を最初から開始（既存友だち向け導線用） */
export const START_KEYWORDS = ['3問に回答する', '診断スタート'];

/** テスト用アカウント登録（運営者のみ）。「テスト登録 <合言葉>」「テスト解除」 */
export const TEST_REGISTER_PREFIX = 'テスト登録';
export const TEST_UNREGISTER_TEXT = 'テスト解除';
export const TEST_REGISTERED =
  'テスト用アカウントとして登録しました。\n\n「3問に回答する」と送ると、3問アンケートのテストを始められます。\n解除するときは「テスト解除」と送ってください。';
export const TEST_UNREGISTERED = 'テスト用アカウントの登録を解除しました。';
export const TEST_RESET_TEXT = 'テストリセット';
export const TEST_RESET_DONE =
  'テスト用に回答をリセットしました。\n「3問に回答する」と送ると、最初からテストできます。';

export const SEGMENT_INTRO =
  'ご登録ありがとうございます。\n\nお子さんの今の状況を教えてください。\nボタンを選ぶだけの3つの質問です（約10秒）。';

/** 3問完了直後の自動返信（Q3への返信として送る） */
export const SEGMENT_COMPLETE = `ありがとうございます。

お子さんの年齢や中学受験へのお考えによって、
今やるべきことはかなり変わります。

いただいた内容は、美穂先生が直接確認します。

「一般論ではなく、わが家の場合は今何をすればいい？」
を具体的に整理したい方には、
60分の個別診断もご用意しています。

もし具体的に気になっていることがあれば、
このままLINEで一言送っていただいても大丈夫です。`;

/** 3問完了後に回答し直したとき */
export const SEGMENT_UPDATED = '回答を更新しました。ありがとうございます。';

/**
 * 1,000円診断CTA。遷移先は環境変数 PARENT_DIAGNOSIS_URL。
 * buttonLabel: 遷移先が申込ページに直結する場合は「1,000円診断を申し込む」に変更。
 */
export const DIAGNOSIS = {
  name: 'わが家の中学受験準備診断',
  priceLabel: '60分 1,000円',
  lead: '60分で、',
  points: [
    '今やるべきこと',
    'まだやらなくていいこと',
    '入塾までに整えたいこと',
    'お子さんに合った親の関わり方',
    '今後6〜12か月の方向性',
  ],
  tail: 'を整理します。',
  buttonLabel: '診断の内容を見る',
};

// ------------------------------------------------------------
// LINEメッセージオブジェクトの組み立て（通常は編集不要）
// ------------------------------------------------------------

/** トーク画面に残る回答表示。例: 【学年】小1 */
export function answerDisplayText(question, option) {
  return `【${question.tag}】${option.label}`;
}

/**
 * 質問をFlexメッセージで出す。選択肢は折り返し表示できるボックス（Q3は選択肢が長いため）。
 * タップ → postback（DB保存はこの data を正とする）＋ displayText（トーク画面に回答が残る）
 */
export function questionMessage(questionKey, { withIntro = false } = {}) {
  const q = QUESTIONS.find((x) => x.key === questionKey);
  const idx = QUESTIONS.indexOf(q);
  const title = `Q${idx + 1}. ${q.text}`;
  const msg = {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `Q${idx + 1} / ${QUESTIONS.length}`, size: 'xs', color: '#888888' },
          { type: 'text', text: q.text, weight: 'bold', size: 'md', wrap: true },
          ...(q.subText ? [{ type: 'text', text: q.subText, size: 'sm', color: '#666666', wrap: true }] : []),
          ...q.options.map((o) => ({
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            cornerRadius: '8px',
            borderWidth: '1px',
            borderColor: '#D5CFC4',
            backgroundColor: '#FAF7F2',
            action: {
              type: 'postback',
              label: o.label.slice(0, 20),
              data: `action=segment&question=${q.key}&value=${o.value}`,
              displayText: answerDisplayText(q, o),
            },
            contents: [{ type: 'text', text: o.label, size: 'sm', wrap: true, color: '#333333' }],
          })),
        ],
      },
    },
  };
  return withIntro ? [{ type: 'text', text: SEGMENT_INTRO }, msg] : [msg];
}

/** 3問完了メッセージ＋診断CTA。ctaUrl が無い場合（申込URL未設定など）はテキストのみ。 */
export function completionMessages({ ctaUrl } = {}) {
  const messages = [{ type: 'text', text: SEGMENT_COMPLETE }];
  if (!ctaUrl) return messages;
  messages.push({
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
          { type: 'text', text: DIAGNOSIS.priceLabel, size: 'sm', color: '#666666' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: DIAGNOSIS.lead, size: 'sm', margin: 'md' },
          ...DIAGNOSIS.points.map((p) => ({ type: 'text', text: `・${p}`, size: 'sm', wrap: true })),
          { type: 'text', text: DIAGNOSIS.tail, size: 'sm' },
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
  });
  return messages;
}
