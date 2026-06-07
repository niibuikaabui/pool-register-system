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

/**
 * フリータイムの残り分数を返す（負 = 超過）
 * @param {string} firstStartedAt  最初のtime_blockのstarted_at
 * @param {number} freetimeMins    フリータイム分数（デフォルト120）
 */
export function freeTimeRemaining(firstStartedAt, freetimeMins = 120) {
  const elapsed = (Date.now() - new Date(firstStartedAt)) / 60000
  return Math.round(freetimeMins - elapsed)
}

/**
 * 残り時間に応じたスタイル情報を返す
 */
export function freeTimeBadge(remaining) {
  if (remaining > 60)  return { label: `残り ${remaining}分`,       cls: 'bg-green-100 text-green-700' }
  if (remaining > 30)  return { label: `残り ${remaining}分`,       cls: 'bg-yellow-100 text-yellow-700' }
  if (remaining > 0)   return { label: `残り ${remaining}分 ⚠`,    cls: 'bg-red-100 text-red-600 font-bold' }
  return               { label: `超過 ${Math.abs(remaining)}分`,    cls: 'bg-red-200 text-red-700 font-bold' }
}
