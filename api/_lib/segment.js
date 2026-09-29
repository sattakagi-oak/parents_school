// 3問アンケートの状態遷移。
// - DB保存は postback data（正規化された内部値）を正とする。displayText は表示用のみでパースしない。
// - 次に出す質問 = 未回答のうち最初の質問。
// - 3問そろった初回 → segmentation_completed_at / manual_followup_status=pending を記録し、
//   Q3への返信として「完了メッセージ＋診断CTA」を1回だけ送る。自動送信はここで終わり。
// - 完了後の再回答 → 値を最新で上書き。途中の質問なら次の質問を順に出し、最後なら「更新しました」。

import { QUESTIONS, SEGMENT_UPDATED, questionMessage, completionMessages } from './messages.js';
import { setAnswer, completeSegmentation, recordEvent } from './users.js';
import { replyOnce, replyUntracked } from './delivery.js';
import { diagnosisUrl, publicBaseUrl } from './config.js';

export const COMPLETION_CAMPAIGN = 'segment:complete';

export function parsePostback(data) {
  if (typeof data !== 'string' || data.length > 300) return null;
  const p = new URLSearchParams(data);
  return { action: p.get('action'), question: p.get('question'), value: p.get('value') };
}

export function isValidAnswer(question, value) {
  const q = QUESTIONS.find((x) => x.key === question);
  return Boolean(q && q.options.some((o) => o.value === value));
}

export function firstUnanswered(user) {
  return QUESTIONS.find((q) => !user?.[q.key])?.key || null;
}

/** CTAリンク（クリック記録用のリダイレクト）。申込URL・公開URLが未設定、または申込済みなら null。 */
export function ctaUrlFor(user) {
  const base = publicBaseUrl();
  if (!base || !/^https:\/\//.test(diagnosisUrl()) || user.diagnosis_applied_at) return null;
  return `${base}/api/line/cta?t=${user.cta_token}`;
}

export async function askFirstQuestion(lineUserId, replyToken, { withIntro = true } = {}) {
  return replyUntracked(lineUserId, replyToken, questionMessage(QUESTIONS[0].key, { withIntro }), 'segment:q1');
}

/** @returns {Promise<string>} 処理結果（テスト・ログ用） */
export async function handleSegmentAnswer(lineUserId, replyToken, question, value) {
  if (!isValidAnswer(question, value)) return 'invalid_answer';

  const user = await setAnswer(lineUserId, question, value);
  await recordEvent(lineUserId, 'segment_answer', { question, value });

  const next = firstUnanswered(user);
  if (next) {
    await replyUntracked(lineUserId, replyToken, questionMessage(next), `segment:${next}`);
    return `asked:${next}`;
  }

  const completed = await completeSegmentation(lineUserId);
  if (completed) {
    await recordEvent(lineUserId, 'segment_completed');
    const status = await replyOnce(
      lineUserId, replyToken, completionMessages({ ctaUrl: ctaUrlFor(completed) }), COMPLETION_CAMPAIGN);
    return `completed:${status}`;
  }

  // 既に完了済みユーザーの再回答（完了メッセージ・CTAは再送しない）
  const idx = QUESTIONS.findIndex((q) => q.key === question);
  const following = QUESTIONS[idx + 1];
  if (following) {
    await replyUntracked(lineUserId, replyToken, questionMessage(following.key), `segment:${following.key}`);
    return `reanswer_asked:${following.key}`;
  }
  await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: SEGMENT_UPDATED }], 'segment:updated');
  return 'updated';
}
