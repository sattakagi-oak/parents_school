// 7日間教育配信（1日1回のCronから呼ぶ）。
// - 1回の実行で1ユーザーにつき最大1ステップだけ送る（遅れていても一気に送らない）
// - ステップNは「3問回答日（日本時間）からN日目以降」に送信
// - CTAステップは診断申込済みなら送らずにスキップ
// - 送れなかった場合（送信モードで止まった等）はステップを進めない → 後日モード切替後に送られる

import { getDb } from './db.js';
import { EDUCATION_STEPS, educationMessages } from './messages.js';
import { diagnosisUrl, publicBaseUrl, sendMode } from './config.js';
import { sendTracked } from './delivery.js';
import { advanceEducationStep } from './users.js';

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;
const BATCH_LIMIT = 500;

export function jstDayIndex(date) {
  return Math.floor((new Date(date).getTime() + JST_OFFSET_MS) / DAY_MS);
}

export function ctaUrlFor(user) {
  const base = publicBaseUrl();
  return base ? `${base}/api/line/cta?t=${user.cta_token}` : null;
}

export async function findEducationCandidates() {
  const { rows } = await getDb().query(
    `select * from parent_line_users
      where segmentation_completed_at is not null
        and education_started_at is not null
        and blocked_at is null
        and education_step < $1
      order by education_started_at
      limit $2`,
    [EDUCATION_STEPS.length, BATCH_LIMIT],
  );
  return rows;
}

export async function runEducation({ now = new Date(), dryRun = false } = {}) {
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const candidates = await findEducationCandidates();
  const today = jstDayIndex(now);

  for (const user of candidates) {
    const stepIndex = user.education_step;
    const step = EDUCATION_STEPS[stepIndex];
    const elapsedDays = today - jstDayIndex(user.education_started_at);
    if (elapsedDays < step.day) { bump('not_due'); continue; }

    if (step.cta && user.diagnosis_applied_at) {
      if (!dryRun) await advanceEducationStep(user.id, stepIndex, stepIndex + 1);
      bump('skipped_already_applied');
      continue;
    }

    let messages;
    if (step.cta) {
      const url = ctaUrlFor(user);
      if (!url || !diagnosisUrl()) { bump('held_missing_cta_config'); continue; }
      messages = educationMessages(step, { ctaUrl: url });
    } else {
      messages = educationMessages(step);
    }

    const status = await sendTracked({
      lineUserId: user.line_user_id,
      campaignKey: step.key,
      messageType: 'push',
      messages,
      scheduledFor: now,
      dryRun,
    });
    bump(status);
    // already_sent: 送信済みなのにステップが進んでいない場合の修復
    if ((status === 'sent' || status === 'already_sent') && !dryRun) {
      await advanceEducationStep(user.id, stepIndex, stepIndex + 1);
    }
  }

  return { mode: dryRun ? 'dry_run' : sendMode(), candidates: candidates.length, results: counts };
}
