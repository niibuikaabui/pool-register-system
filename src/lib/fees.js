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

// アクティブブロックの概算料金をタイムスタンプから計算（プレー中の現在時刻ベース見積もり専用）
export function calcBlockFee(block, pricingType, rate, now = new Date()) {
  if (!rate || isFreetime(pricingType)) return 0
  return calcHourlyFee(block.started_at, block.ended_at || now, rate)
}

// 完了ブロックの料金: locked_fee優先。NULL（フリータイム・旧データ）は0円として扱う。
// ※ 終了後に区分・種別が変更されると「終了時点で本当にフリータイムだったか」は判別できないため、
//   タイムスタンプからの再計算は行わない（誤って現在の種別で時間制課金してしまうのを防ぐ）。
export function calcCompletedBlockFee(block) {
  return block.locked_fee ?? 0
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
    ? calcCompletedBlockFee(b)
    : calcBlockFee(b, pricingType, rate, now)), 0)
}

// 注文合計（キャンセル分を除外）
export function calcFoodFee(orderItems) {
  return (orderItems || [])
    .filter(o => !o.cancelled_at)
    .reduce((sum, o) => sum + o.unit_price * o.quantity, 0)
}
