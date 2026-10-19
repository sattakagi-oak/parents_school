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

/**
 * チェックリスト（プレゼント）。画像は静的ファイル（公開URL + path）。DBには sheet の識別値のみ保存。
 * path: 原寸（LINE上限10MB）/ previewPath: トーク画面のプレビュー（LINE上限1MB。原寸が1MBを超えるため縮小JPEGを別に用意）
 * 元画像: 子育て相談/images/プレゼント②.png → present-1（未就学〜小学校低学年まで）
 *         子育て相談/images/プレゼント①.png → present-2（小学校中学年以上）
 */
/** 画像を差し替えたら更新する（URLを変えて、LINE側に残った古い画像のキャッシュを使わせないため） */
export const SHEET_IMAGE_VERSION = '20260930';

export const SHEETS = {
  present_1: {
    label: 'プレゼント②（未就学〜小学校低学年まで）',
    path: '/images/parent-check/present-1.png',
    previewPath: '/images/parent-check/present-1-preview.jpg',
  },
  present_2: {
    label: 'プレゼント①（小学校中学年以上）',
    path: '/images/parent-check/present-2.png',
    previewPath: '/images/parent-check/present-2-preview.jpg',
  },
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
  /** ボタンの下に出す案内（誰が申し込んだかを公式LINE上で把握するため） */
  afterPayNote: 'お支払いが完了したら、このLINEで「申し込みました」とお送りください😊',
};

/**
 * 相手からこの文言（の書き出し）が送られたら「個別分析に申込済み」として記録する（自動返信はしない）。
 * 空白・句読点・！などは無視して比較。
 */
export const ANALYSIS_APPLIED_TEXTS = [
  '申し込みました', '申込みました', '申込ました', '申し込みしました', '申込しました',
  '申し込み完了', '申込完了', '申し込み終わりました', '支払いました', 'お支払いしました', 'お支払い完了',
];

export function isAnalysisAppliedText(text) {
  const t = String(text || '').replace(/[\s　！!。．.、,♪〜～ー]/g, '');
  return ANALYSIS_APPLIED_TEXTS.some((k) => t.startsWith(k));
}

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
export function greetingMessages(extra = []) {
  return [{ type: 'text', text: GREETING }, stageMessage(), ...extra];
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
    messages.push({
      type: 'image',
      originalContentUrl: `${baseUrl}${SHEETS[sheet].path}?v=${SHEET_IMAGE_VERSION}`,
      previewImageUrl: `${baseUrl}${SHEETS[sheet].previewPath}?v=${SHEET_IMAGE_VERSION}`,
    });
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
          { type: 'text', text: ANALYSIS.afterPayNote, size: 'sm', wrap: true, color: '#c8402e', weight: 'bold', margin: 'md' },
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

// ============================================================
// 無料講座（Zoom）の申込・リマインド
// 告知は LINE Official Account Manager から人が配信し、そのボタンで相手から
// 「無料講座に申し込む」と送られてきたら、以下の自動返信が始まる。
// Zoom の URL・ID・パスコードはコードに書かず、環境変数（WEBINAR_ZOOM_*）から読む。
// ============================================================

export const WEBINAR = {
  key: 'jisoryoku_jiatama_202610',
  title: 'お子さんの「自走力」と「地頭」をきたえる',
  subtitle: 'わが子3人東大進学の塾長があかす、家庭での関わり方',
  /** start/end は日本時間。label はボタン・メッセージに出す表記 */
  sessions: [
    { id: '1020_am', label: '10/20（火）10:00〜11:00', start: '2026-10-20T10:00:00+09:00', end: '2026-10-20T11:00:00+09:00' },
    { id: '1020_pm', label: '10/20（火）21:00〜22:00', start: '2026-10-20T21:00:00+09:00', end: '2026-10-20T22:00:00+09:00' },
    { id: '1021_am', label: '10/21（水）10:00〜11:00', start: '2026-10-21T10:00:00+09:00', end: '2026-10-21T11:00:00+09:00' },
    { id: '1021_pm', label: '10/21（水）21:00〜22:00', start: '2026-10-21T21:00:00+09:00', end: '2026-10-21T22:00:00+09:00' },
  ],
  /** このテキストが相手から送られたら申込開始（告知メッセージのボタンに設定する文言は1行目） */
  startKeywords: ['無料講座に申し込む', '無料講座に申込む', '申込', '申し込む', '申し込み'],
};

/**
 * 期間中に新しく友だち追加した人（ブロック解除は除く）にだけ、挨拶と一緒に送る無料講座の告知。
 * 既存の友だちには公式アカウント管理画面から一斉配信済みのため、新規の人だけが対象。
 */
export const WEBINAR_NEW_FRIEND_WINDOW = { from: '2026-10-19T14:01:00+09:00', until: '2026-10-21T21:00:00+09:00' };

function jstDate(d) {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** sessions は受付中の回。now の日付で「明日開催/本日開催」を切り替える */
export function webinarNewFriendMessages(sessions, now) {
  const first = sessions[0].start.slice(0, 10);
  const last = WEBINAR.sessions[WEBINAR.sessions.length - 1].start.slice(0, 10);
  const today = jstDate(now);
  const head = today < first ? '【明日開催・まだ間に合います】'
    : today === last ? '【本日最終日・まだ間に合います】'
      : '【本日開催・まだ間に合います】';
  const text = `${head}
「勉強しなさい」が逆効果になる子がいます。

子どもには4つの個性タイプがあり、響く言葉はまったく違います。

東大に進んだ3人の子育てで私が「絶対にやらなかったこと」を、LINE登録者限定の無料講座でお話しします。

${sessions.map((s) => `📅 ${s.label}`).join('\n')}
（各60分・Zoom）

👉このトークに「申し込む」と送るだけ
当日の申し込みもOKです🙆‍♀️`;
  return [{ type: 'text', text }];
}

const WEBINAR_HEADER = `【無料講座】
${WEBINAR.title}
〜${WEBINAR.subtitle}〜`;

export const WEBINAR_CLOSED = 'ありがとうございます😊\nこちらの無料講座の受付は終了しました。またのご案内をお待ちください。';

export function webinarSession(id) {
  return WEBINAR.sessions.find((s) => s.id === id) || null;
}

/** Zoom 参加情報のテキスト。URL 未設定なら null */
export function zoomText(zoom) {
  if (!zoom?.url) return null;
  return [
    '▼参加用Zoom',
    zoom.url,
    zoom.meetingId ? `ミーティングID: ${zoom.meetingId}` : null,
    zoom.passcode ? `パスコード: ${zoom.passcode}` : null,
  ].filter(Boolean).join('\n');
}

/** 日時選択ボタン（Flex）。sessions は受付中の回だけを渡す */
export function webinarSessionMessage(sessions, { changing = false } = {}) {
  const title = changing ? '変更後のご希望日時を選んでください👇' : 'ご希望の日時を選んでください👇';
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
          { type: 'text', text: WEBINAR.title, weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: title, size: 'sm', color: '#666666', wrap: true },
          ...sessions.map((s) => ({
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            cornerRadius: '8px',
            borderWidth: '1px',
            borderColor: '#D5CFC4',
            backgroundColor: '#FAF7F2',
            action: {
              type: 'postback',
              label: s.label.slice(0, 20),
              data: `action=webinar_session&value=${s.id}`,
              displayText: `【無料講座 希望日時】${s.label}`,
            },
            contents: [{ type: 'text', text: s.label, size: 'md', weight: 'bold', color: '#333333' }],
          })),
        ],
      },
    },
  };
}

/** 申込の入口: ご案内＋日時ボタン */
export function webinarStartMessages(sessions) {
  return [
    {
      type: 'text',
      text: `${WEBINAR_HEADER}\n\nお申し込みありがとうございます😊\n\n顔出しなし・ミュートでのご参加もOKです。\nもちろん、ご質問やご感想をいただけるととても嬉しいです。`,
    },
    webinarSessionMessage(sessions),
  ];
}

/**
 * 申込完了（日程変更後も同じ）。
 * zoom を渡した場合（前日リマインドの時刻を過ぎてからの申込）は Zoom 情報も入れる。
 */
export function webinarCompleteMessages(session, { changed = false, zoom = null, morningStillComing = true } = {}) {
  const head = changed ? '日程を変更しました😊' : 'お申し込みが完了しました😊';
  const zoomBlock = zoomText(zoom);
  const tail = zoomBlock
    ? `${zoomBlock}\n\nお時間になりましたら、上のリンクからご参加ください。${morningStillComing ? '\n当日の朝にもあらためてお送りします。' : ''}`
    : '開催が近づきましたら、前日の20時ごろと当日の朝に、このLINEで参加用のZoomリンクをお送りします。';
  return [
    {
      type: 'text',
      text: `${head}\n\n${WEBINAR_HEADER}\n\n【日時】${session.label}\n【参加方法】Zoom（オンライン）\n\n顔出しなし・ミュートでのご参加もOKです。\nご質問やご感想もお気軽にどうぞ😊\n\n${tail}`,
    },
    {
      type: 'flex',
      altText: '日程を変更する',
      contents: {
        type: 'bubble',
        size: 'kilo',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ご都合が変わった場合は、こちらから日程を変更できます。', size: 'sm', wrap: true, color: '#555555' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              action: { type: 'postback', label: '日程を変更する', data: 'action=webinar_change', displayText: '日程を変更する' },
            },
          ],
        },
      },
    },
  ];
}

/** リマインド。kind: day_before（前日20時台）/ morning（当日朝）/ hour_before（1時間前） */
export function webinarReminderMessages(kind, session, zoom) {
  const lead = {
    day_before: `明日は無料講座の日です😊\n\n${WEBINAR_HEADER}\n\n【日時】${session.label}`,
    morning: `本日、無料講座を開催します😊\n\n${WEBINAR_HEADER}\n\n【日時】本日 ${session.label.replace(/^.*）/, '')}`,
    hour_before: `まもなく（1時間後）無料講座が始まります😊\n\n【日時】${session.label}`,
  }[kind];
  const after = {
    day_before: '顔出しなし・ミュートでもOKです。お気軽にご参加ください。\n当日の朝にもあらためてお送りします。',
    morning: '顔出しなし・ミュートでもOKです。お時間になりましたら、上のリンクからご参加ください。',
    hour_before: 'お時間になりましたら、上のリンクからご参加ください。',
  }[kind];
  return [{ type: 'text', text: `${lead}\n\n${zoomText(zoom)}\n\n${after}` }];
}
