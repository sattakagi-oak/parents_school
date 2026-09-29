// 「親の習慣」チェックリスト導線。すべて reply（ユーザーの操作への返信）で、push は使わない。
//
//   follow / テスト開始 → 挨拶＋年代ボタン
//   年代タップ（postback action=stage）→ 年代・シートを保存 → シート画像＋案内＋0〜10個ボタン
//   旧入力「①/②/1/2」（シート未取得の人のみ）→ シートだけ保存 → 同じくシート画像＋案内＋0〜10個ボタン
//   個数タップ（postback action=check_count）→ 個数・回答日時・pending を保存
//       初回: お礼＋個別分析カード（旧入力の人には任意で年代ボタンも）
//       選び直し: 「更新しました」のみ
//   以降の自動送信なし（美穂先生が手動コメント）
//
// DB保存は postback data（正規化された値）を正とし、displayText は表示用のみでパースしない。

import {
  STAGES, CHECK_COUNT_MAX, CHECK_UPDATED, STAGE_SUPPLEMENT_THANKS,
  stageByValue, greetingMessages, sheetMessages, checkCompleteMessages, stageMessage,
} from './messages.js';
import { getUser, setStageAndSheet, setStageOnly, setLegacySheet, setCheckCount, recordEvent } from './users.js';
import { replyOnce, replyUntracked } from './delivery.js';
import { diagnosisUrl, publicBaseUrl } from './config.js';

export const COMPLETION_CAMPAIGN = 'check:complete';

export function parsePostback(data) {
  if (typeof data !== 'string' || data.length > 300) return null;
  const p = new URLSearchParams(data);
  return { action: p.get('action'), value: p.get('value'), supplement: p.get('supplement') === '1' };
}

/** CTAリンク（クリック計測用リダイレクト）。申込URL・公開URLが未設定、または申込済みなら null。 */
export function ctaUrlFor(user) {
  const base = publicBaseUrl();
  if (!base || !/^https:\/\//.test(diagnosisUrl()) || user.diagnosis_applied_at) return null;
  return `${base}/api/line/cta?t=${user.cta_token}`;
}

export async function sendGreeting(lineUserId, replyToken) {
  return replyUntracked(lineUserId, replyToken, greetingMessages(), 'greeting');
}

function replySheet(lineUserId, replyToken, sheet) {
  return replyUntracked(lineUserId, replyToken, sheetMessages(sheet, { baseUrl: publicBaseUrl() }), `sheet:${sheet}`);
}

/** 年代ボタン */
export async function handleStage(lineUserId, replyToken, value, { supplement = false } = {}) {
  const stage = stageByValue(value);
  if (!stage) return 'invalid_stage';

  if (supplement) {
    const user = await setStageOnly(lineUserId, stage.value);
    if (!user) return 'invalid_stage';
    await recordEvent(lineUserId, 'stage_supplement', { stage: stage.value });
    await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: STAGE_SUPPLEMENT_THANKS }], 'stage:supplement');
    return 'stage_supplement';
  }

  await setStageAndSheet(lineUserId, stage.value, stage.sheet);
  await recordEvent(lineUserId, 'sheet_sent', { stage: stage.value, sheet: stage.sheet, source: 'stage_button' });
  await replySheet(lineUserId, replyToken, stage.sheet);
  return `sheet:${stage.sheet}`;
}

/** 旧入力「①/②/1/2」。シート未取得の人だけ処理（取得済みなら null を返し、何もしない） */
export async function handleLegacySheet(lineUserId, replyToken, sheet) {
  const user = await setLegacySheet(lineUserId, sheet);
  if (!user) return null;
  await recordEvent(lineUserId, 'sheet_sent', { sheet, source: 'legacy_text' });
  await replySheet(lineUserId, replyToken, sheet);
  return `legacy_sheet:${sheet}`;
}

/** 個数ボタン */
export async function handleCheckCount(lineUserId, replyToken, value) {
  if (!/^\d{1,2}$/.test(value || '') || Number(value) > CHECK_COUNT_MAX) return 'invalid_count';
  const count = Number(value);

  const user = await setCheckCount(lineUserId, count);
  if (!user) {
    // シート未取得（古いボタン等）→ 年代ボタンから
    await replyUntracked(lineUserId, replyToken, [stageMessage()], 'stage:reask');
    return 'no_sheet:asked_stage';
  }
  await recordEvent(lineUserId, 'check_count', { count });

  const status = await replyOnce(
    lineUserId, replyToken,
    checkCompleteMessages({ ctaUrl: ctaUrlFor(user), askStage: !user.education_stage }),
    COMPLETION_CAMPAIGN);
  if (status === 'already_sent') {
    await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: CHECK_UPDATED }], 'check:updated');
    return 'count_updated';
  }
  return `completed:${status}`;
}

export { STAGES };
