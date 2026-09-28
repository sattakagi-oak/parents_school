// 3問セグメントの状態遷移。
// 次に出す質問 = 未回答のうち最初の質問。
// 3問そろった初回 → 完了メッセージ + 教育Day0 を返信し、教育シナリオ開始。
// 完了後の再回答 → 値を最新で上書き。途中の質問なら次の質問を順に出し、最後なら「更新しました」。

import { QUESTIONS, SEGMENT_COMPLETE, SEGMENT_UPDATED, EDUCATION_STEPS, questionMessage, educationMessages } from './messages.js';
import { setAnswer, completeSegmentation, advanceEducationStep, recordEvent } from './users.js';
import { sendTracked, replyUntracked } from './delivery.js';

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
    const day0 = EDUCATION_STEPS[0];
    const status = await sendTracked({
      lineUserId,
      campaignKey: day0.key,
      messageType: 'reply',
      replyToken,
      messages: [{ type: 'text', text: SEGMENT_COMPLETE }, ...educationMessages(day0)],
    });
    if (status === 'sent') await advanceEducationStep(completed.id, 0, 1);
    return `completed:${status}`;
  }

  // 既に完了済みユーザーの再回答
  const idx = QUESTIONS.findIndex((q) => q.key === question);
  const following = QUESTIONS[idx + 1];
  if (following) {
    await replyUntracked(lineUserId, replyToken, questionMessage(following.key), `segment:${following.key}`);
    return `reanswer_asked:${following.key}`;
  }
  await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: SEGMENT_UPDATED }], 'segment:updated');
  return 'updated';
}
