// ============================================================
// LINE自動返信の文面・ボタンはすべてこのファイルで管理します。
// 文面を変えるときはこのファイルだけ編集すればOKです。
// 注意: 内部値（value / sheet）はDBに保存される値なので、変更しないでください。
//
// 自動で送るのは次の返信（reply）だけです:
//   友だち追加 → 挨拶＋年代ボタン → [年代タップ] シート画像＋案内＋0〜10個ボタン
//   → [個数タップ] お礼＋「わが子の強み・伸ばし方 個別分析」カード
// それ以降は美穂先生が LINE Official Account Manager から個別に手動コメントします。
// ステップ配信・自動追客・AIによる個別コメントはありません。
// ============================================================

/** チェックリスト（プレゼント）。画像は静的ファイル（PUBLIC_BASE_URL + path）。DBには sheet の識別値のみ保存。 */
export const SHEETS = {
  present_1: { label: 'プレゼント1（未就学〜小学校低学年まで）', path: '/images/parent-check/present-1.png' },
  present_2: { label: 'プレゼント2（小学校中学年以降）', path: '/images/parent-check/present-2.png' },
};

/** 年代区分（education_stage）。sheet: その年代に送るチェックリスト */
export const STAGES = [
  { value: 'preschool', label: '幼稚園・保育園', sheet: 'present_1' },
  { value: 'elementary_lower', label: '小学校低学年', sub: '小1〜2', sheet: 'present_1' },
  { value: 'elementary_middle', label: '小学校中学年', sub: '小3〜4', sheet: 'present_2' },
  { value: 'elementary_upper', label: '小学校高学年', sub: '小5〜6', sheet: 'present_2' },
  { value: 'junior_high_plus', label: '中学生以上', sheet: 'present_2' },
];

export const CHECK_COUNT_MAX = 10;

/**
 * 旧導線（既存の挨拶メッセージで「①/②を送ってください」と案内済み）との互換。
 * 厳密な年代は分からないので、シートだけ決める。
 */
export const LEGACY_SHEET_INPUTS = {
  present_1: ['①', '1', '１'],
  present_2: ['②', '2', '２'],
};

/** テスト用ユーザーだけが使う開発用コマンド（production では無効） */
export const TEST_START_TEXT = 'テスト開始';
export const TEST_RESET_TEXT = 'テストリセット';
export const TEST_RESET_DONE =
  'テスト用に回答をリセットしました。\n「テスト開始」と送ると、友だち追加直後の挨拶から確認できます。';

/** テスト用アカウント登録（運営者のみ）。「テスト登録 <合言葉>」「テスト解除」 */
export const TEST_REGISTER_PREFIX = 'テスト登録';
export const TEST_UNREGISTER_TEXT = 'テスト解除';
export const TEST_REGISTERED =
  'テスト用アカウントとして登録しました。\n\n「テスト開始」と送ると、友だち追加直後の挨拶から新しい導線を確認できます。\n解除するときは「テスト解除」と送ってください。';
export const TEST_UNREGISTERED = 'テスト用アカウントの登録を解除しました。';

/** 友だち追加直後の挨拶（follow への reply） */
export const GREETING = `はじめまして、みほ先生です♪
友だち追加、ありがとうございます😊

さっそくですが、
プレゼントをお受け取りください🎁

＼わが子をみずから伸びる子にする／
「親の習慣」チェックリスト

10個の項目をチェックするだけで、

・今できていること
・これから意識すると、さらに伸ばせること
・親として大切にしたい関わり方

を振り返ることができます。

お子さんの年代に合わせたチェックリストをお送りします。

まずは、下からお子さんの学年を選んでください👇

いただいた回答は、
みほ先生が直接確認します😊`;

export const STAGE_TITLE = 'お子さんの学年を選んでください';

/** 年代タップ後、シート画像の次に送る案内（0〜10個ボタン付き） */
export const SHEET_GUIDE = `ありがとうございます😊

こちらのチェックリストを見ながら、
10項目をチェックしてみてください。

終わったら、
当てはまった個数を下から選んでください👇`;

/** 個数タップ後のお礼（初回） */
export const CHECK_THANKS = `ご回答ありがとうございます😊

いただいた内容は、
みほ先生が直接確認して、
個別にコメントをお返しします。`;

/** 個数を選び直したとき */
export const CHECK_UPDATED = 'チェック数を更新しました。ありがとうございます😊';

/** 旧入力（①/②）から入った人に、任意で年代を聞く */
export const STAGE_SUPPLEMENT_TITLE = 'よろしければ、お子さんの学年も教えてください（任意）';
export const STAGE_SUPPLEMENT_THANKS = 'ありがとうございます😊 学年を登録しました。';

/**
 * 1,000円商品カード。遷移先は環境変数 PARENT_DIAGNOSIS_URL（クリック計測URL経由）。
 * 「個別相談」「お悩み相談」を主名称にしない。受けた後に何が分かるかを示す。
 */
export const ANALYSIS = {
  name: 'わが子の強み・伸ばし方 個別分析',
  priceLabel: '30分 1,000円（延長あり）',
  lead: '今のお子さんについてお話を伺いながら、',
  points: [
    '今どんな力が伸びているか',
    'お子さんの強み・得意',
    '次に何を伸ばすとよいか',
    '今やること／まだ急がなくていいこと',
    'お子さんに合った親の関わり方',
    '今後6〜12か月の方向性',
  ],
  tail: 'を一緒に整理します。',
  buttonLabel: '強みと伸ばし方を整理する',
};

// ------------------------------------------------------------
// ラベル・判定（通常は編集不要）
// ------------------------------------------------------------

export function stageByValue(value) {
  return STAGES.find((s) => s.value === value) || null;
}

export function stageLabel(value) {
  const s = stageByValue(value);
  return s ? (s.sub ? `${s.label}（${s.sub}）` : s.label) : value || '';
}

/** 旧入力テキスト → sheet（該当しなければ null） */
export function legacySheetFor(text) {
  for (const [sheet, inputs] of Object.entries(LEGACY_SHEET_INPUTS)) {
    if (inputs.includes(text)) return sheet;
  }
  return null;
}

// ------------------------------------------------------------
// LINEメッセージオブジェクトの組み立て（通常は編集不要）
// ------------------------------------------------------------

/**
 * 年代ボタン（Flex）。各ボタン = postback（DB保存はこの data を正とする）＋
 * displayText（トーク画面に「【学年】小学校低学年」と残り、美穂先生が履歴で確認できる）。
 * supplement: 旧入力の人に任意で年代だけ聞く場合（シートは再送しない）
 */
export function stageMessage({ supplement = false } = {}) {
  const title = supplement ? STAGE_SUPPLEMENT_TITLE : STAGE_TITLE;
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true },
          ...STAGES.map((s) => ({
            type: 'box',
            layout: 'horizontal',
            paddingAll: '12px',
            cornerRadius: '8px',
            borderWidth: '1px',
            borderColor: '#D5CFC4',
            backgroundColor: '#FAF7F2',
            action: {
              type: 'postback',
              label: s.label,
              data: `action=stage&value=${s.value}${supplement ? '&supplement=1' : ''}`,
              displayText: `【学年】${s.label}`,
            },
            contents: [
              { type: 'text', text: s.label, size: 'md', weight: 'bold', color: '#333333', flex: 0 },
              ...(s.sub ? [{ type: 'text', text: `（${s.sub}）`, size: 'sm', color: '#777777', gravity: 'center' }] : []),
            ],
          })),
        ],
      },
    },
  };
}

/** 挨拶＋年代ボタン */
export function greetingMessages() {
  return [{ type: 'text', text: GREETING }, stageMessage()];
}

/** 0〜10個のクイックリプライ */
export function checkCountQuickReply() {
  return {
    items: Array.from({ length: CHECK_COUNT_MAX + 1 }, (_, n) => ({
      type: 'action',
      action: {
        type: 'postback',
        label: `${n}個`,
        data: `action=check_count&value=${n}`,
        displayText: `【チェック数】${n}個`,
      },
    })),
  };
}

/** チェックリスト画像＋案内＋0〜10個ボタン。baseUrl が無ければ画像は付けない。 */
export function sheetMessages(sheet, { baseUrl } = {}) {
  const messages = [];
  if (baseUrl) {
    const url = `${baseUrl}${SHEETS[sheet].path}`;
    messages.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
  }
  messages.push({ type: 'text', text: SHEET_GUIDE, quickReply: checkCountQuickReply() });
  return messages;
}

/** 「わが子の強み・伸ばし方 個別分析」カード */
export function analysisCard(ctaUrl) {
  return {
    type: 'flex',
    altText: `${ANALYSIS.name}（${ANALYSIS.priceLabel}）`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: ANALYSIS.name, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: ANALYSIS.priceLabel, size: 'sm', color: '#666666' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: ANALYSIS.lead, size: 'sm', margin: 'md', wrap: true },
          ...ANALYSIS.points.map((p) => ({ type: 'text', text: `・${p}`, size: 'sm', wrap: true })),
          { type: 'text', text: ANALYSIS.tail, size: 'sm' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: ANALYSIS.buttonLabel, uri: ctaUrl } },
        ],
      },
    },
  };
}

/**
 * 個数回答（初回）への返信: お礼＋個別分析カード（＋旧入力の人には任意で年代ボタン）。
 * ctaUrl が無い（申込URL未設定・申込済み）場合はカードなし。
 */
export function checkCompleteMessages({ ctaUrl, askStage = false } = {}) {
  const messages = [{ type: 'text', text: CHECK_THANKS }];
  if (ctaUrl) messages.push(analysisCard(ctaUrl));
  if (askStage) messages.push(stageMessage({ supplement: true }));
  return messages;
}
