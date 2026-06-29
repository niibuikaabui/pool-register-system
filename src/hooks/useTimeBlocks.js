import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isFreetime } from '../lib/constants'
import { roundUp50, toLocalDatetimeInput } from '../lib/utils'

/**
 * 時間ブロックの CRUD・料金計算・編集フォーム状態を管理する。
 *
 * @param {string} sessionId
 * @param {string} pricingType  現在選択中の種別
 * @param {object|undefined} rate  現在の customerType × pricingType に対応する pricing_master 行
 * @param {object|null} session    sessions 行
 * @param {array}  pricing         pricing_master 全行
 */
export function useTimeBlocks(sessionId, pricingType, rate, session, pricing) {
  const [timeBlocks, setTimeBlocks] = useState([])
  const [tick, setTick] = useState(0)
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [editStartDate, setEditStartDate] = useState('')
  const [editStartTime, setEditStartTime] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editEndTime, setEditEndTime] = useState('')

  // 1分ごとに再描画（経過時間・概算料金の更新用）
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // time_blocks のロードとリアルタイム購読
  useEffect(() => {
    if (!sessionId) return
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
  }

  // eslint-disable-next-line no-unused-vars
  const _tick = tick

  const activeBlock = timeBlocks.find(b => !b.ended_at)
  const completedBlocks = timeBlocks.filter(b => b.ended_at)

  // ─── 料金計算 ───

  function calcBlockFee(block) {
    if (!rate || isFreetime(pricingType)) return 0
    const ended = block.ended_at ? new Date(block.ended_at) : new Date()
    const mins = Math.floor((ended - new Date(block.started_at)) / 60000)
    if (mins <= 0) return 0
    return roundUp50((rate.price_per_minute || 0) * mins)
  }

  // sessions.total_play_fee 保存用の合計計算。
  function calcTotalPlayFeeFromBlocks(blocks) {
    return blocks
      .filter(b => b.ended_at)
      .reduce((sum, b) => sum + (b.locked_fee ?? 0), 0)
  }

  function calcPlayFee() {
    if (!rate) return 0
    if (isFreetime(pricingType)) return rate.freetime_price || 0
    // 完了ブロックはDB保存済みのlocked_feeを使用（種別変更・リロード後も正確に反映）
    const completedFee = completedBlocks.reduce((sum, b) => sum + (b.locked_fee ?? 0), 0)
    return completedFee + (activeBlock ? calcBlockFee(activeBlock) : 0)
  }

  const playFee = calcPlayFee()

  // ブロック部分の履歴（注文との合成は呼び出し元で行う）
  const blockHistory = [
    ...completedBlocks.map(b => {
      // locked_fee === null かつ ended_at あり → フリータイムブロック
      const isLockedFreetime = b.locked_fee === null
      const fee = b.locked_fee ?? 0
      return {
        type: 'block',
        sortTime: new Date(b.started_at),
        id: b.id,
        startTime: b.started_at,
        endTime: b.ended_at,
        fee,
        isLockedFreetime,
        isActive: false,
      }
    }),
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

    // locked_fee: フリータイムは NULL、時間制は計算値
    let lockedFee = null
    if (!isFreetime(pricingType) && rate && block) {
      const mins = Math.floor((new Date(endedAt) - new Date(block.started_at)) / 60000)
      lockedFee = mins > 0 ? roundUp50((rate.price_per_minute || 0) * mins) : 0
    }

    const { data } = await supabase.from('time_blocks').update({
      ended_at: endedAt,
      locked_fee: lockedFee,
    }).eq('id', blockId).select().single()

    if (data) {
      const updatedBlocks = timeBlocks.map(b => b.id === blockId ? data : b)
      setTimeBlocks(updatedBlocks)

      if (rate) {
        const totalPlayFee = isFreetime(pricingType)
          ? (rate.freetime_price || 0)
          : calcTotalPlayFeeFromBlocks(updatedBlocks)
        await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
      }
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

  async function saveEditBlock(block) {
    const newStart = new Date(`${editStartDate}T${editStartTime}`).toISOString()
    const newEnd = (editEndDate && editEndTime) ? new Date(`${editEndDate}T${editEndTime}`).toISOString() : null

    if (newEnd && newEnd <= newStart) {
      alert('終了時刻は開始時刻より後にしてください')
      return
    }

    // 元の時刻との差が6時間を超える場合は確認
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

      // locked_fee を再計算してDBに保存（フリータイムブロックは NULL のまま）
      if (!isFreetime(pricingType) && block.locked_fee !== null && rate) {
        const mins = Math.floor((new Date(update.ended_at) - new Date(newStart)) / 60000)
        update.locked_fee = mins > 0 ? roundUp50((rate.price_per_minute || 0) * mins) : 0
      }
    }

    await supabase.from('time_blocks').update(update).eq('id', block.id)
    const updatedBlocks = timeBlocks.map(b => b.id === block.id ? { ...b, ...update } : b)
    setTimeBlocks(updatedBlocks)
    setEditingBlockId(null)

    if (block.ended_at && rate) {
      const totalPlayFee = isFreetime(pricingType)
        ? (rate.freetime_price || 0)
        : calcTotalPlayFeeFromBlocks(updatedBlocks)
      await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
    }
  }

  return {
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
    calcBlockFee,
  }
}
