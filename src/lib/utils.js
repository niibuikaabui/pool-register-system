/**
 * 経過時間を "X時間Y分" / "Y分" でフォーマット
 * @param {string|Date} startedAt
 * @param {string|Date|null} endedAt  null なら現在時刻
 */
export function fmtElapsed(startedAt, endedAt = null) {
  const diff = Math.floor((new Date(endedAt || Date.now()) - new Date(startedAt)) / 60000)
  if (diff < 0) return '0分'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

/**
 * ISO文字列を "HH:MM" でフォーマット
 */
export function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}
