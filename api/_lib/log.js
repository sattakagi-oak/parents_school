// 安全なログ出力。LINE userId・トークン・メッセージ本文・Webhook body は渡さないこと。
// 渡された fields のうち、許可したキーだけを出力する。

const ALLOWED = new Set([
  'event', 'reason', 'campaignKey', 'messageType', 'status', 'count', 'step', 'mode',
  'httpStatus', 'error', 'question', 'result', 'durationMs',
]);

function pick(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (ALLOWED.has(k)) out[k] = v;
  }
  return out;
}

export const log = {
  info(msg, fields) { console.log(JSON.stringify({ level: 'info', msg, ...pick(fields) })); },
  warn(msg, fields) { console.warn(JSON.stringify({ level: 'warn', msg, ...pick(fields) })); },
  error(msg, fields) { console.error(JSON.stringify({ level: 'error', msg, ...pick(fields) })); },
};

/** エラーからログに出してよい短い文字列だけを取り出す */
export function errorSummary(err) {
  const s = String(err?.message || err || 'unknown');
  return s.replace(/U[0-9a-f]{32}/g, 'U***').slice(0, 200);
}
