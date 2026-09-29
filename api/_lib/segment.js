// 3問アンケートの状態遷移。
// - DB保存は postback data（正規化された内部値）を正とする。displayText は表示用のみでパースしない。
// - Q2（進路・教育方針）は Q1 の学年で選択肢を出し分ける。回答値はその学年の選択肢に含まれるものだけ受け付ける。
// - 次に出す質問 = 未回答のうち最初の質問。
// - 3問そろった初回 → segmentation_completed_at / manual_followup_status=pending を記録し、
//   Q3への返信として「完了メッセージ＋診断CTA」を1回だけ送る。自動送信はここで終わり。
// - 完了後の再回答 → 値を最新で上書き。途中の質問なら次の質問を順に出し、最後なら「更新しました」。

import { QUESTIONS, SEGMENT_UPDATED, questionMessage, completionMessages, resolveQuestion } from './messages.js';
import { getUser, setAnswer, completeSegmentation, recordEvent } from './users.js';
import { replyOnce, replyUntracked } from './delivery.js';
import { diagnosisUrl, publicBaseUrl } from './config.js';

export const COMPLETION_CAMPAIGN = 'segment:complete';

export function parsePostback(data) {
  if (typeof data !== 'string' || data.length > 300) return null;
  const p = new URLSearchParams(data);
  return { action: p.get('action'), question: p.get('question'), value: p.get('value') };
}

/** user の状態（学年）で解決した質問の選択肢に value が含まれるか */
export function isValidAnswer(question, value, user) {
  const q = resolveQuestion(question, user);
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

function askQuestion(lineUserId, replyToken, key, user) {
  return replyUntracked(lineUserId, replyToken, questionMessage(key, { user }), `segment:${key}`);
}

/** @returns {Promise<string>} 処理結果（テスト・ログ用） */
export async function handleSegmentAnswer(lineUserId, replyToken, question, value) {
  if (!QUESTIONS.some((q) => q.key === question)) return 'invalid_answer';
  const current = await getUser(lineUserId);

  if (!isValidAnswer(question, value, current)) {
    // 学年未回答のままQ2が押された / 別の学年用の古いQ2ボタン → 今の状態で聞くべき質問を出し直す
    if (question === 'exam_intent') {
      const redo = current?.grade ? 'exam_intent' : 'grade';
      await askQuestion(lineUserId, replyToken, redo, current);
      return `invalid_answer:asked:${redo}`;
    }
    return 'invalid_answer';
  }

  let user = await setAnswer(lineUserId, question, value);
  await recordEvent(lineUserId, 'segment_answer', { question, value });

  // 学年を変えて、既存のQ2回答が新しい学年の選択肢に無い → Q2を聞き直す
  if (question === 'grade' && user.exam_intent && !isValidAnswer('exam_intent', user.exam_intent, user)) {
    user = await setAnswer(lineUserId, 'exam_intent', null);
  }

  const next = firstUnanswered(user);
  if (next) {
    await askQuestion(lineUserId, replyToken, next, user);
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
    await askQuestion(lineUserId, replyToken, following.key, user);
    return `reanswer_asked:${following.key}`;
  }
  await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: SEGMENT_UPDATED }], 'segment:updated');
  return 'updated';
}
