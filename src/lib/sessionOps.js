import { supabase } from './supabase'
import { calcLockedBlock, calcSessionPlayFee, calcFoodFee } from './fees'

// ─────────────────────────────────────────────────────────────
// 伝票・台・時間ブロックに対する定型DB操作の共通モジュール
// 画面側はここを呼ぶだけにし、更新ロジックの重複実装を避ける
// ─────────────────────────────────────────────────────────────

// 新規伝票を作成し、台を使用中にする
export async function createSlip(tableId) {
  const { data, error } = await supabase.from('sessions').insert({
    table_id: tableId,
    customer_type: 'general',
    pricing_type: 'hourly_multi',
    started_at: new Date().toISOString(),
    is_paid: false,
  }).select().single()
  if (error) return { data: null, error }
  await supabase.from('tables').update({ status: 'in_use' }).eq('id', tableId)
  return { data, error: null }
}

// 未会計伝票が残っていなければ台を空きに戻す。残伝票の有無を返す
export async function releaseTableIfNoUnpaid(tableId, excludeSessionId, { clearNote = false } = {}) {
  const { data: remaining } = await supabase
    .from('sessions').select('id')
    .eq('table_id', tableId).eq('is_paid', false).neq('id', excludeSessionId)
  const hasRemaining = !!remaining && remaining.length > 0
  if (!hasRemaining) {
    await supabase.from('tables')
      .update(clearNote ? { status: 'empty', note: null } : { status: 'empty' })
      .eq('id', tableId)
  }
  return hasRemaining
}

// 伝票を別の台へ移動し、移動元に未会計伝票がなければ空きに戻す
export async function moveSlipToTable(sessionId, oldTableId, newTableId) {
  await supabase.from('sessions').update({ table_id: newTableId }).eq('id', sessionId)
  await supabase.from('tables').update({ status: 'in_use' }).eq('id', newTableId)
  await releaseTableIfNoUnpaid(oldTableId, sessionId)
}

// 進行中の時間ブロックを終了し、locked_fee・is_freetime を確定する
export async function endActiveBlocks(sessionId, pricingType, rate, endedAt = new Date().toISOString()) {
  const { data: actives } = await supabase
    .from('time_blocks').select('id, started_at')
    .eq('session_id', sessionId).is('ended_at', null)
  await Promise.all((actives || []).map(b => {
    const { locked_fee, is_freetime } = calcLockedBlock(b.started_at, endedAt, pricingType, rate)
    return supabase.from('time_blocks').update({ ended_at: endedAt, locked_fee, is_freetime }).eq('id', b.id)
  }))
  return actives || []
}

// セッションの全ブロック・注文から料金を再計算して sessions へ保存する
export async function persistSessionTotals(sessionId, pricingType, rate, extra = {}) {
  const [{ data: blocks }, { data: orders }] = await Promise.all([
    supabase.from('time_blocks').select('*').eq('session_id', sessionId),
    supabase.from('order_items').select('unit_price, quantity, cancelled_at').eq('session_id', sessionId),
  ])
  const totalPlayFee = calcSessionPlayFee(blocks, pricingType, rate)
  const foodFee = calcFoodFee(orders)
  await supabase.from('sessions').update({
    total_play_fee: totalPlayFee,
    total_food_fee: foodFee,
    grand_total: totalPlayFee + foodFee,
    ...extra,
  }).eq('id', sessionId)
  return { totalPlayFee, foodFee }
}

// time_blocks 一覧からセッションごとのプレー状態マップを組み立てる
// activeBlocks: ended_at IS NULL のブロック / allBlocks: started_at 昇順の全ブロック
export function buildPlayStateMaps(activeBlocks, allBlocks) {
  const playingStart = {}
  ;(activeBlocks || []).forEach(b => { playingStart[b.session_id] = b.started_at })
  const firstStart = {}
  ;(allBlocks || []).forEach(b => { if (!firstStart[b.session_id]) firstStart[b.session_id] = b.started_at })
  return { playingStart, firstStart }
}
