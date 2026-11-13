// 個別診断レポートの管理（みほ先生の入力画面から呼ぶ）。認証: Authorization: Bearer <ADMIN_API_TOKEN>
//   GET  ?action=candidates        入力候補の一覧（個別診断に申込済み・チェック回答済みの人）。LINE userId は返さない
//   GET  ?action=prefill&user=<id>  その人の自動入力（表示名・学年・チェック数・事前アンケート・下書き）
//   POST {user, report_id?, data}   下書き保存。プレビューURL（token付き）を返す
//   POST {action:'send', user, report_id}  保存済みの下書きを本人のLINEに送る（1回だけ。送信後は編集不可）
// 認証は管理パスワード、または通知で届く「その人専用の署名付きURL」（その1人の記入・送信だけできる）。

import { checkBearer, json } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { stageLabel } from '../_lib/messages.js';
import { publicBaseUrl } from '../_lib/config.js';
import { verifyFormKey } from '../_lib/report-link.js';
import { pushMessage } from '../_lib/line.js';
import { recordEvent } from '../_lib/users.js';
import { log, errorSummary } from '../_lib/log.js';

const UUID = /^[0-9a-f-]{36}$/i;

/** 入力画面の面談日時（"2026-11-20T10:00"、日本時間）→ Date。なければ null */
function interviewAt(data) {
  const m = String(data?.interview_at || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function userById(id) {
  if (!UUID.test(id || '')) return null;
  const { rows } = await getDb().query('select * from parent_line_users where id = $1', [id]);
  return rows[0] || null;
}

const previewUrl = (token) => `${publicBaseUrl() || ''}/api/report?t=${token}`;

/** 'full'（管理パスワード）／'user'（その人専用URL）／null */
function access(request, userId) {
  if (checkBearer(request, 'ADMIN_API_TOKEN')) return 'full';
  const h = request.headers;
  const keyUser = h.get('x-report-user');
  if (keyUser && keyUser === userId && verifyFormKey(keyUser, h.get('x-report-exp'), h.get('x-report-key'))) return 'user';
  return null;
}

/** 本人に送るメッセージ（カードを押すとレポートが開く） */
export function reportMessages(url, data) {
  const name = data?.family_name ? `${data.family_name}さん` : '';
  return [
    { type: 'text', text: `${name}、先日は個別診断をありがとうございました😊\nお約束の診断レポートをお送りします。` },
    {
      type: 'flex', altText: '個別診断レポートが届きました',
      contents: { type: 'bubble',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: '個別診断レポート', weight: 'bold', size: 'lg', color: '#0b254a' },
          { type: 'text', text: 'わが子の強み・伸ばし方', size: 'sm', color: '#b48a25', weight: 'bold' },
          { type: 'text', text: 'お子さんのタイプと、今日からできる3つの関わり方をまとめました。', size: 'sm', wrap: true, margin: 'md', color: '#56657a' },
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#0b254a', action: { type: 'uri', label: 'レポートを見る', uri: url } },
        ] } },
    },
  ];
}

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const level = access(request, p.get('user'));
  if (!level) return json({ error: 'unauthorized' }, 401);
  const db = getDb();

  if (p.get('action') === 'candidates') {
    if (level !== 'full') return json({ error: 'unauthorized' }, 401);
    const { rows } = await db.query(
      `select u.id, u.display_name, u.education_stage, u.parenting_check_count,
              u.diagnosis_applied_at, u.parenting_check_answered_at,
              (select status from parent_diagnosis_reports r where r.line_user_id = u.line_user_id order by created_at desc limit 1) as report_status
         from parent_line_users u
        where u.blocked_at is null and (u.diagnosis_applied_at is not null or u.parenting_check_answered_at is not null)
        order by u.diagnosis_applied_at desc nulls last, u.parenting_check_answered_at desc
        limit 300`);
    return json({ users: rows.map((r) => ({ ...r, stage_label: r.education_stage ? stageLabel(r.education_stage) : null })) });
  }

  if (p.get('action') === 'prefill') {
    const u = await userById(p.get('user'));
    if (!u) return json({ error: 'not_found' }, 404);
    const { rows } = await db.query(
      'select id, report_no, token, survey, data, status from parent_diagnosis_reports where line_user_id = $1 order by created_at desc limit 1',
      [u.line_user_id]);
    const r = rows[0];
    const survey = r?.survey || {};
    const auto = {
      family_name: u.display_name || '',
      grade_label: u.education_stage ? stageLabel(u.education_stage) : '',
      child_name: survey.child_name || '',
      worry: survey.worry || '',
      check_count: u.parenting_check_count ?? '',
    };
    return json({
      auto, survey,
      report: r ? { id: r.id, report_no: r.report_no, status: r.status, data: r.data, preview_url: previewUrl(r.token) } : null,
    });
  }
  return json({ error: 'bad_request' }, 400);
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!access(request, body.user)) return json({ error: 'unauthorized' }, 401);
  const u = await userById(body.user);
  if (!u) return json({ error: 'not_found' }, 404);
  if (body.action === 'send') return sendReport(u, body.report_id);
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  if (JSON.stringify(data).length > 20000) return json({ error: 'too_large' }, 413);
  const db = getDb();
  let row;
  if (UUID.test(body.report_id || '')) {
    ({ rows: [row] } = await db.query(
      `update parent_diagnosis_reports set data = $3, interview_at = $4,
              reminder_count = case when interview_at is distinct from $4 then 0 else reminder_count end, updated_at = now()
        where id = $1 and line_user_id = $2 and status = 'draft' returning id, report_no, token, status`,
      [body.report_id, u.line_user_id, data, interviewAt(data)]));
    if (!row) return json({ error: 'not_editable' }, 409);
  } else {
    ({ rows: [row] } = await db.query(
      'insert into parent_diagnosis_reports (line_user_id, data, interview_at) values ($1, $2, $3) returning id, report_no, token, status',
      [u.line_user_id, data, interviewAt(data)]));
  }
  return json({ id: row.id, report_no: row.report_no, status: row.status, preview_url: previewUrl(row.token) });
}

async function sendReport(u, reportId) {
  if (!UUID.test(reportId || '')) return json({ error: 'bad_request' }, 400);
  const db = getDb();
  const { rows: [r] } = await db.query(
    'select id, token, data, status from parent_diagnosis_reports where id = $1 and line_user_id = $2', [reportId, u.line_user_id]);
  if (!r) return json({ error: 'not_found' }, 404);
  if (r.status === 'sent') return json({ error: 'already_sent' }, 409);
  const d = r.data || {};
  if (!d.worry || !d.type || !(d.actions || []).some((a) => a?.title)) return json({ error: 'incomplete' }, 422);
  if (u.blocked_at) return json({ error: 'blocked' }, 409);
  // 二重送信を防ぐため、先に送信済みにしてから送る（失敗したら下書きに戻す）
  const { rowCount } = await db.query(
    "update parent_diagnosis_reports set status = 'sent', sent_at = now(), updated_at = now() where id = $1 and status = 'draft'", [r.id]);
  if (!rowCount) return json({ error: 'already_sent' }, 409);
  try {
    const res = await pushMessage(u.line_user_id, reportMessages(previewUrl(r.token), d), r.id);
    if (!res.sent) throw Object.assign(new Error(res.reason), { reason: res.reason });
  } catch (err) {
    await db.query("update parent_diagnosis_reports set status = 'draft', sent_at = null where id = $1", [r.id]);
    log.error('レポート送信失敗', { error: errorSummary(err) });
    return json({ error: err.reason || 'send_failed' }, 502);
  }
  await recordEvent(u.line_user_id, 'diagnosis_report_sent', { report_id: r.id });
  return json({ status: 'sent', report_url: previewUrl(r.token) });
}
