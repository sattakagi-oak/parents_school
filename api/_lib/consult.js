// 個別相談の案内。個数回答のお礼では文章で「個別相談もあります」と伝えるだけにし、
// 相手から希望の言葉が返ってきたらカード（申込ボタン）を自動で返す。
//   explicit:   「個別相談」「相談したい」など。いつでも反応する（何度でも）
//   contextual: 「お願いします」「希望します」など。普段の会話でも使う言葉なので、
//               案内を送ってから CONTEXT_DAYS 日以内で、その後カードをまだ送っていない人にだけ反応する
// 判定は短いメッセージだけ。長文は個別の相談内容とみなし、美穂先生への通知に任せる。

import { getDb } from './db.js';
import { upsertUser, recordEvent } from './users.js';
import { replyUntracked } from './delivery.js';
import { analysisCard, CONSULT_REPLY } from './messages.js';
import { ctaUrlFor } from './checklist.js';
import { notifyAdmins, quote } from './notify.js';

export const CONSULT_OFFER_EVENT = 'consult_offer';
const CARD_EVENT = 'consult_card_sent';
const CONTEXT_DAYS = 14;
const MAX_LENGTH = 40;

const NEGATIVE = /いりません|いらない|不要|結構|けっこう|大丈夫|やめ|しません|しない|遠慮|キャンセル|また今度|今はいい|今回は/;
const EXPLICIT = /個別相談|個別分析|個別診断|個別面談|こべつそうだん|相談|そうだん|面談/;
const CONTEXTUAL_EXACT = new Set([
  'お願いします', 'お願いいたします', 'おねがいします', 'お願い', 'お願いしたいです', 'お願いしたいのですが',
  'ぜひお願いします', 'ぜひ', 'はいお願いします', 'はい',
  '申込', '申し込む', '申し込み', '申込み', '申し込みます', '申込みます',
]);
const CONTEXTUAL = /希望|詳しく|くわしく|詳細|受けたい|受けてみたい|話したい|話してみたい|申し込みたい|申込みたい|申し込みしたい|興味があ|興味あ|知りたい/;

/** 記号・絵文字・空白を除いて比較する（全角英数は半角に） */
function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}]/gu, '');
}

/** @returns {'explicit'|'contextual'|null} */
export function classifyConsultText(text) {
  const t = normalize(text);
  if (!t || t.length > MAX_LENGTH || NEGATIVE.test(t)) return null;
  if (EXPLICIT.test(t)) return 'explicit';
  if (CONTEXTUAL_EXACT.has(t) || CONTEXTUAL.test(t)) return 'contextual';
  return null;
}

/** 案内を送ってから期間内で、その後カードをまだ送っていないか */
async function offerIsOpen(lineUserId) {
  const { rows } = await getDb().query(
    `select 1 from parent_line_events o
      where o.line_user_id = $1 and o.event_type = $2
        and o.created_at > now() - make_interval(days => $4)
        and not exists (select 1 from parent_line_events c
                         where c.line_user_id = o.line_user_id and c.event_type = $3 and c.created_at >= o.created_at)
      limit 1`,
    [lineUserId, CONSULT_OFFER_EVENT, CARD_EVENT, CONTEXT_DAYS],
  );
  return rows.length > 0;
}

/** 個別相談の希望ならカードを返す。対象外は null（通常のメッセージとして扱う） */
export async function handleConsultText(lineUserId, replyToken, text) {
  const kind = classifyConsultText(text);
  if (!kind) return null;
  if (kind === 'contextual' && !(await offerIsOpen(lineUserId))) return null;
  // システム導入前からの友だちはDBにまだいないことがある
  const ctaUrl = ctaUrlFor(await upsertUser(lineUserId));
  if (!ctaUrl) return null; // 申込済み・申込URL未設定
  await replyUntracked(lineUserId, replyToken, [{ type: 'text', text: CONSULT_REPLY }, analysisCard(ctaUrl)], 'consult:card');
  await recordEvent(lineUserId, CARD_EVENT, { kind });
  await notifyAdmins(lineUserId, 'consult', `個別相談の案内カードを自動で送りました：\n${quote(text)}`);
  return `consult_card:${kind}`;
}
