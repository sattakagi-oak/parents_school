// ============================================================
// LINE自動返信の文面・選択肢はすべてこのファイルで管理します。
// 文面を変えるときはこのファイルだけ編集すればOKです。
// 注意: 選択肢の value（内部値）はDBに保存される値なので、変更しないでください。
//
// 自動で送るのは「友だち追加後の質問 → Q1→Q2→Q3 → 完了メッセージ＋診断CTA」まで。
// それ以降は美穂先生が LINE Official Account Manager から個別に手動返信します。
//
// トーン: 「悩み相談・問題解決」ではなく「わが子をもっと伸ばしたい・可能性を広げたい」。
//         中学受験は選択肢の一つとして扱い、中学受験だけに限定しない。
// ============================================================

/**
 * 3問アンケート。配列の順番が出題順。
 * - key: DBカラム名（意味は下記。Migrationリスク回避のためカラム名は流用）
 *     grade       … 学年
 *     exam_intent … 進路・教育方針（education_path_intent）。Q1の学年で選択肢を出し分け（variants）
 *     interest    … 子どもについて伸ばしたいこと（growth_interest）
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
    key: 'exam_intent', // = 進路・教育方針
    tag: '進路',
    variants: [
      {
        grades: ['preschool'],
        text: 'これからのお子さんの学びについて、一番近いものを教えてください。',
        options: [
          { value: 'expand_future_options', label: '将来の選択肢をできるだけ広げたい' },
          { value: 'junior_exam_considering', label: '中学受験も視野に入れている' },
          { value: 'build_learning_foundation', label: 'まずは学ぶことを楽しめる土台をつくりたい' },
          { value: 'not_decided_yet', label: 'まだ具体的な進路は考えていない' },
        ],
      },
      {
        grades: ['grade_1', 'grade_2'],
        text: 'これからの進路について、今のお考えに一番近いものを教えてください。',
        options: [
          { value: 'junior_exam_planned', label: '中学受験を考えている' },
          { value: 'junior_exam_considering', label: '中学受験も含めて幅広く検討している' },
          { value: 'expand_future_options', label: 'まだ決めていないが、将来の選択肢を広げたい' },
          { value: 'public_school_main', label: '公立中心で考えている' },
          { value: 'not_decided_yet', label: 'まだ特に決めていない' },
        ],
      },
      {
        grades: ['grade_3'],
        text: 'これからの進路について、今のお考えに一番近いものを教えてください。',
        options: [
          { value: 'junior_exam_planned', label: '中学受験をする予定' },
          { value: 'junior_exam_considering', label: '中学受験を前向きに検討している' },
          { value: 'junior_exam_undecided', label: '中学受験をするかまだ迷っている' },
          { value: 'public_school_main', label: '公立中への進学を中心に考えている' },
          { value: 'not_decided_yet', label: 'まだ決めていない' },
        ],
      },
      {
        grades: ['grade_4_plus'],
        text: '現在の進路について、一番近いものを教えてください。',
        options: [
          { value: 'junior_exam_in_progress', label: '中学受験に向けて準備している' },
          { value: 'junior_exam_considering', label: '中学受験を検討している' },
          { value: 'high_school_exam', label: '高校受験を見据えている' },
          { value: 'not_decided_yet', label: 'まだ進路は決めていない' },
          { value: 'other', label: 'その他の進路を考えている' },
        ],
      },
    ],
  },
  {
    key: 'interest', // = これから伸ばしたいこと
    tag: '伸ばしたいこと',
    text: 'これから、お子さんについて一番伸ばしていきたいことはどれですか？',
    subText: '今困っていることではなく、「これからこうなってほしい」というお気持ちに近いもので大丈夫です。',
    options: [
      { value: 'independent_thinking', label: '自分から考えて学ぶ力を伸ばしたい' },
      { value: 'learning_habits', label: '勉強を楽しめる習慣をつくりたい' },
      { value: 'develop_strengths', label: '得意なこと・好きなことをもっと伸ばしたい' },
      { value: 'expand_future_options', label: '将来の選択肢を広げられる力をつけたい' },
      { value: 'parenting_fit', label: '子どものタイプに合った関わり方を知りたい' },
      { value: 'what_to_prioritize', label: '今の年齢で何を優先すればいいか知りたい' },
    ],
  },
];

/**
 * ユーザーの状態に応じた質問（text / options）を返す。Q2は学年で出し分け。
 * 学年が未回答でQ2を解決できない場合は null。
 */
export function resolveQuestion(key, user) {
  const q = QUESTIONS.find((x) => x.key === key);
  if (!q) return null;
  if (!q.variants) return q;
  const v = q.variants.find((x) => x.grades.includes(user?.grade));
  return v ? { ...q, ...v } : null;
}

/** 全学年を通じた選択肢の内部値（DB検証・セグメント抽出用） */
export function allOptionValues(key) {
  const q = QUESTIONS.find((x) => x.key === key);
  const options = q.variants ? q.variants.flatMap((v) => v.options) : q.options;
  return new Set(options.map((o) => o.value));
}

/** 内部値 → 表示ラベル（Q2は学年に応じたラベル） */
export function optionLabel(key, value, user) {
  const q = resolveQuestion(key, user) || QUESTIONS.find((x) => x.key === key);
  const options = q.options || q.variants.flatMap((v) => v.options);
  return options.find((o) => o.value === value)?.label || value || '';
}

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
  'ご登録ありがとうございます。\n\nお子さんのことを少し教えてください。\nボタンを選ぶだけの3つの質問です（約10秒）。';

/** 3問完了直後の自動返信（Q3への返信として送る） */
export const SEGMENT_COMPLETE = `ありがとうございます。

お子さんの年齢や、これからどんな力を伸ばしていきたいかによって、
今大切にしたいことは一人ひとり違います。

いただいた内容は、美穂先生が直接確認します。

「うちの子の場合、今どんなことを大切にするといい？」
と具体的に知りたい方には、個別診断もご用意しています。

もしお子さんについて具体的に気になっていることがあれば、
このままLINEで一言送っていただいても大丈夫です。`;

/** 3問完了後に回答し直したとき */
export const SEGMENT_UPDATED = '回答を更新しました。ありがとうございます。';

/**
 * 1,000円個別診断CTA。遷移先は環境変数 PARENT_DIAGNOSIS_URL。
 * buttonLabel: 遷移先が申込ページに直結する場合は「1,000円個別診断を申し込む」に変更。
 */
export const DIAGNOSIS = {
  name: 'わが子の伸ばし方 個別診断',
  priceLabel: '60分 1,000円',
  lead: '60分で、',
  points: [
    '今の年齢で大切にしたいこと',
    'お子さんの強みや得意の伸ばし方',
    '今はまだ急がなくていいこと',
    '将来の選択肢を広げるための準備',
    'お子さんに合った親の関わり方',
    '今後6〜12か月の方向性',
  ],
  tail: 'を一緒に整理します。',
  buttonLabel: '個別診断の内容を見る',
};

// ------------------------------------------------------------
// LINEメッセージオブジェクトの組み立て（通常は編集不要）
// ------------------------------------------------------------

/** トーク画面に残る回答表示。例: 【学年】小1 */
export function answerDisplayText(question, option) {
  return `【${question.tag}】${option.label}`;
}

/**
 * 質問をFlexメッセージで出す。選択肢は折り返し表示できるボックス（長い選択肢も全文表示）。
 * タップ → postback（DB保存はこの data を正とする）＋ displayText（トーク画面に回答が残る）
 * @param {object} user Q2の出し分けに使う（grade）
 */
export function questionMessage(questionKey, { user, withIntro = false } = {}) {
  const q = resolveQuestion(questionKey, user);
  if (!q) throw new Error(`cannot resolve question: ${questionKey}`);
  const idx = QUESTIONS.findIndex((x) => x.key === questionKey);
  const msg = {
    type: 'flex',
    altText: `Q${idx + 1}. ${q.text}`,
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
