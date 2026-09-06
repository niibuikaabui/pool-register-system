import { isFreetime } from './constants'
import { roundUp50 } from './utils'

// ─────────────────────────────────────────────────────────────
// 料金計算の共通モジュール（純関数のみ・DBアクセスなし）
// プレー料金のルール:
//   - 時間制: 分未満切り捨て → price_per_minute × 分 → 50円単位切り上げ
//   - フリータイム: freetime_price の定額
//   - 完了ブロックは locked_fee（終了時に確定した金額）を最優先で使う
//   - 1伝票の中で種別（時間制⇔フリータイム）を跨いで遊ぶケースがあるため、
//     ブロックごとに「終了時点でフリータイムだったか」を is_freetime 列に保存し、
//     完了ブロックは常にその確定額（locked_fee）をそのまま合算する。
//     「現在の種別」でセッション全体の計算方式を切り替えることはしない。
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

// ブロック終了時にDBへ確定する { locked_fee, is_freetime }。
// フリータイムは freetime_price をそのまま確定額として保存する（NULLにしない）。
// これにより、終了後に種別が変わっても「このブロックが確定した時点の実態」を復元できる。
export function calcLockedBlock(startedAt, endedAt, pricingType, rate) {
  if (isFreetime(pricingType)) {
    return { locked_fee: rate?.freetime_price ?? null, is_freetime: true }
  }
  if (!rate) return { locked_fee: null, is_freetime: false }
  return { locked_fee: calcHourlyFee(startedAt, endedAt, rate), is_freetime: false }
}

// セッションのプレー料金合計: 完了ブロックは確定額（locked_fee）をそのまま合算し、
// アクティブブロックのみ現在の種別でリアルタイム概算する
export function calcSessionPlayFee(blocks, pricingType, rate, now = new Date()) {
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
