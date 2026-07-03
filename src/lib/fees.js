import { isFreetime } from './constants'
import { roundUp50 } from './utils'

// ─────────────────────────────────────────────────────────────
// 料金計算の共通モジュール（純関数のみ・DBアクセスなし）
// プレー料金のルール:
//   - 時間制: 分未満切り捨て → price_per_minute × 分 → 50円単位切り上げ
//   - フリータイム: freetime_price の定額
//   - 完了ブロックは locked_fee（終了時に確定した金額）を最優先で使う
// ─────────────────────────────────────────────────────────────

// 区分×種別に対応する料金マスタ行を返す
export function findRate(pricing, customerType, pricingType) {
  return pricing.find(p => p.customer_type === customerType && p.pricing_type === pricingType)
}

// 時間制の料金をタイムスタンプから計算
export function calcHourlyFee(startedAt, endedAt, rate) {
  const mins = Math.floor((new Date(endedAt) - new Date(startedAt)) / 60000)
  if (mins <= 0) return 0
  return roundUp50((rate?.price_per_minute || 0) * mins)
}

// ブロック1件の料金をタイムスタンプから計算（アクティブブロックの概算・locked_fee未設定時のフォールバック用）
export function calcBlockFee(block, pricingType, rate, now = new Date()) {
  if (!rate || isFreetime(pricingType)) return 0
  return calcHourlyFee(block.started_at, block.ended_at || now, rate)
}

// 完了ブロックの料金: locked_fee優先、NULL（フリータイム・旧データ・レート未ロード時）は再計算
export function calcCompletedBlockFee(block, pricingType, rate, now) {
  return block.locked_fee != null ? block.locked_fee : calcBlockFee(block, pricingType, rate, now)
}

// ブロック終了時にDBへ確定する locked_fee（フリータイム・レート未確定時はNULL）
export function calcLockedFee(startedAt, endedAt, pricingType, rate) {
  if (isFreetime(pricingType) || !rate) return null
  return calcHourlyFee(startedAt, endedAt, rate)
}

// セッションのプレー料金合計（フリータイムは定額、時間制は完了＋アクティブブロックの合算）
export function calcSessionPlayFee(blocks, pricingType, rate, now = new Date()) {
  if (!rate) return 0
  if (isFreetime(pricingType)) return rate.freetime_price || 0
  return (blocks || []).reduce((sum, b) => sum + (b.ended_at
    ? calcCompletedBlockFee(b, pricingType, rate, now)
    : calcBlockFee(b, pricingType, rate, now)), 0)
}

// 注文合計（キャンセル分を除外）
export function calcFoodFee(orderItems) {
  return (orderItems || [])
    .filter(o => !o.cancelled_at)
    .reduce((sum, o) => sum + o.unit_price * o.quantity, 0)
}
