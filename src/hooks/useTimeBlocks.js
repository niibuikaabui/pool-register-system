import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toLocalDatetimeInput } from '../lib/utils'
import {
  calcBlockFee as calcBlockFeeBase,
  calcCompletedBlockFee,
  calcHourlyFee,
  calcLockedBlock,
  calcSessionPlayFee,
} from '../lib/fees'

export function useTimeBlocks(sessionId, pricingType, rate) {
  const [timeBlocks, setTimeBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [editStartDate, setEditStartDate] = useState('')
  const [editStartTime, setEditStartTime] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editEndTime, setEditEndTime] = useState('')

  // 1分ごとに再描画（アクティブブロックの概算料金更新用）
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    loadTimeBlocks()
    const channel = supabase
      .channel(`checkout-timeblocks-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_blocks', filter: `session_id=eq.${sessionId}` }, loadTimeBlocks)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [sessionId])

  async function loadTimeBlocks() {
    const { data } = await supabase
      .from('time_blocks')
      .select('*')
      .eq('session_id', sessionId)
      .order('started_at')
    setTimeBlocks(data || [])
    setLoading(false)
  }

  // eslint-disable-next-line no-unused-vars
  const _tick = tick

  const activeBlock = timeBlocks.find(b => !b.ended_at)
  const completedBlocks = timeBlocks.filter(b => b.ended_at)

  // ─── 料金計算（実体は lib/fees.js。現在の pricingType・rate を束縛したラッパー） ───

  function calcBlockFee(block) {
    return calcBlockFeeBase(block, pricingType, rate)
  }

  function calcCompletedFee(block) {
    return calcCompletedBlockFee(block)
  }

  const playFee = calcSessionPlayFee(timeBlocks, pricingType, rate)

  const blockHistory = [
    ...completedBlocks.map(b => ({
      type: 'block',
      sortTime: new Date(b.started_at),
      id: b.id,
      startTime: b.started_at,
      endTime: b.ended_at,
      // 終了時点でフリータイムだったブロックはバッジ表示（現在の種別には依存しない）
      isLockedFreetime: !!b.is_freetime,
      fee: calcCompletedFee(b),
      isActive: false,
    })),
    ...(activeBlock ? [{
      type: 'block',
      sortTime: new Date(activeBlock.started_at),
      id: activeBlock.id,
      startTime: activeBlock.started_at,
      endTime: null,
      fee: calcBlockFee(activeBlock),
      isActive: true,
    }] : []),
  ]

  // 完了ブロックのみの合計を sessions.total_play_fee に保存（rate 未ロード時は更新しない）
  async function persistCompletedPlayFee(blocks) {
    if (!rate) return
    const totalPlayFee = calcSessionPlayFee(blocks.filter(b => b.ended_at), pricingType, rate)
    await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
  }

  // ─── 時間ブロック操作 ───

  async function startTimeBlock() {
    const { data } = await supabase.from('time_blocks').insert({
      session_id: sessionId,
      started_at: new Date().toISOString(),
    }).select().single()
    if (data) setTimeBlocks(prev => [...prev, data])
  }

  async function endTimeBlock(blockId) {
    const endedAt = new Date().toISOString()
    const block = timeBlocks.find(b => b.id === blockId)

    // フリータイムは freetime_price を確定額として保存、時間制は計算値
    const { locked_fee, is_freetime } = block
      ? calcLockedBlock(block.started_at, endedAt, pricingType, rate)
      : { locked_fee: null, is_freetime: false }

    const { data } = await supabase.from('time_blocks').update({
      ended_at: endedAt,
      locked_fee,
      is_freetime,
    }).eq('id', blockId).select().single()

    if (data) {
      const updatedBlocks = timeBlocks.map(b => b.id === blockId ? data : b)
      setTimeBlocks(updatedBlocks)
      await persistCompletedPlayFee(updatedBlocks)
    }
  }

  // ─── 時間ブロック編集 ───

  function openEditBlock(block) {
    const [sd, st] = toLocalDatetimeInput(block.started_at).split('T')
    setEditStartDate(sd)
    setEditStartTime(st)
    if (block.ended_at) {
      const [ed, et] = toLocalDatetimeInput(block.ended_at).split('T')
      setEditEndDate(ed)
      setEditEndTime(et)
    } else {
      setEditEndDate('')
      setEditEndTime('')
    }
    setEditingBlockId(block.id)
  }

  async function saveEditBlock(passedBlock) {
    // OrderHistory から渡される block は表示用に id/started_at/ended_at のみを持つ整形済みオブジェクトで
    // locked_fee を含まない（undefined になる）ため、timeBlocks から元データを引き直す
    const block = timeBlocks.find(b => b.id === passedBlock.id) || passedBlock
    const newStart = new Date(`${editStartDate}T${editStartTime}`).toISOString()
    const newEnd = (editEndDate && editEndTime) ? new Date(`${editEndDate}T${editEndTime}`).toISOString() : null

    if (newEnd && newEnd <= newStart) {
      alert('終了時刻は開始時刻より後にしてください')
      return
    }

    const origStart = new Date(block.started_at)
    const origEnd = block.ended_at ? new Date(block.ended_at) : null
    const startDiff = Math.abs(new Date(newStart) - origStart) / 3600000
    const endDiff = newEnd && origEnd ? Math.abs(new Date(newEnd) - origEnd) / 3600000 : 0
    if (startDiff > 6 || endDiff > 6) {
      const ok = window.confirm(
        `6時間以上の修正があります。入力内容を確認してください。\n\n` +
        `開始: ${editStartDate} ${editStartTime}\n` +
        (newEnd ? `終了: ${editEndDate} ${editEndTime}\n` : '') +
        `\nこの内容で保存しますか？`
      )
      if (!ok) return
    }

    const update = { started_at: newStart }
    if (block.ended_at) {
      update.ended_at = newEnd || block.ended_at
      // フリータイムブロック（is_freetime=true）は確定額のまま変えない。時間制ブロックのみ再計算
      if (!block.is_freetime && rate) {
        update.locked_fee = calcHourlyFee(newStart, update.ended_at, rate)
      }
    }

    await supabase.from('time_blocks').update(update).eq('id', block.id)
    const updatedBlocks = timeBlocks.map(b => b.id === block.id ? { ...b, ...update } : b)
    setTimeBlocks(updatedBlocks)
    setEditingBlockId(null)

    if (block.ended_at) {
      await persistCompletedPlayFee(updatedBlocks)
    }
  }

  return {
    loading,
    activeBlock,
    completedBlocks,
    playFee,
    blockHistory,
    editingBlockId,
    editStartDate, setEditStartDate,
    editStartTime, setEditStartTime,
    editEndDate, setEditEndDate,
    editEndTime, setEditEndTime,
    startTimeBlock,
    endTimeBlock,
    openEditBlock,
    saveEditBlock,
    cancelEdit: () => setEditingBlockId(null),
  }
}
