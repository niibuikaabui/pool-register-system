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
 * @param {object|null} session    sessions 行（完了ブロック料金の初期ロック用）
 * @param {array}  pricing         pricing_master 全行（同上）
 */
export function useTimeBlocks(sessionId, pricingType, rate, session, pricing) {
  const [timeBlocks, setTimeBlocks] = useState([])
  // 完了済みブロックの料金をロック（種別変更・時間修正後も正確に反映）
  // null は廃止 — フリータイムブロックも実額を格納する
  const [lockedBlockFees, setLockedBlockFees] = useState({})
  // フリータイムとして完了したブロックの ID セット（バッジ表示用）
  const [lockedFreetimeIds, setLockedFreetimeIds] = useState(new Set())
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

  // 完了済みブロックの料金をロック（ページロード時・新規完了時に未登録分を処理）
  useEffect(() => {
    if (!session || pricing.length === 0) return
    const origRate = pricing.find(
      p => p.customer_type === session.customer_type && p.pricing_type === session.pricing_type
    )
    let newFreetimeIds = []
    setLockedBlockFees(prev => {
      const next = { ...prev }
      newFreetimeIds = []
      for (const b of timeBlocks.filter(b => b.ended_at)) {
        if (b.id in next) continue
        if (origRate) {
          if (!isFreetime(session.pricing_type)) {
            const mins = Math.floor((new Date(b.ended_at) - new Date(b.started_at)) / 60000)
            next[b.id] = mins > 0 ? roundUp50((origRate.price_per_minute || 0) * mins) : 0
          } else {
            next[b.id] = origRate.freetime_price || 0
            newFreetimeIds.push(b.id)
          }
        } else {
          next[b.id] = 0
        }
      }
      return next
    })
    if (newFreetimeIds.length > 0) {
      setLockedFreetimeIds(prev => {
        const s = new Set(prev)
        for (const id of newFreetimeIds) s.add(id)
        return s
      })
    }
  }, [session, pricing, timeBlocks])

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
  // 新規終了ブロック（未ロック）は newBlockId/newBlockFee で明示的に渡す。
  function calcTotalPlayFeeFromBlocks(blocks, newBlockId = null, newBlockFee = 0) {
    return blocks
      .filter(b => b.ended_at)
      .reduce((sum, b) => {
        if (b.id === newBlockId) return sum + newBlockFee
        return sum + (lockedBlockFees[b.id] ?? 0)
      }, 0)
  }

  function calcPlayFee() {
    if (!rate) return 0
    if (isFreetime(pricingType)) return rate.freetime_price || 0
    // 完了ブロックはロック済み料金を使用（種別変更後も正確に反映）
    // フリータイムブロックのロック料金には freetime_price の実額が入っている
    const completedFee = completedBlocks.reduce((sum, b) => {
      return sum + (b.id in lockedBlockFees ? lockedBlockFees[b.id] : calcBlockFee(b))
    }, 0)
    return completedFee + (activeBlock ? calcBlockFee(activeBlock) : 0)
  }

  const playFee = calcPlayFee()

  // ブロック部分の履歴（注文との合成は呼び出し元で行う）
  const blockHistory = [
    ...completedBlocks.map(b => {
      const fee = b.id in lockedBlockFees ? lockedBlockFees[b.id] : calcBlockFee(b)
      return {
        type: 'block',
        sortTime: new Date(b.started_at),
        id: b.id,
        startTime: b.started_at,
        endTime: b.ended_at,
        fee,
        isLockedFreetime: lockedFreetimeIds.has(b.id),
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
    const { data } = await supabase.from('time_blocks').update({
      ended_at: new Date().toISOString(),
    }).eq('id', blockId).select().single()
    if (data) {
      const updatedBlocks = timeBlocks.map(b => b.id === blockId ? data : b)
      setTimeBlocks(updatedBlocks)

      const endedMins = Math.floor((new Date(data.ended_at) - new Date(data.started_at)) / 60000)
      const endedFee = isFreetime(pricingType)
        ? (rate?.freetime_price || 0)
        : (rate && endedMins > 0 ? roundUp50((rate.price_per_minute || 0) * endedMins) : 0)

      // プレー終了時に total_play_fee を sessions に保存（伝票一覧の合計額に反映するため）
      if (rate) {
        const totalPlayFee = calcTotalPlayFeeFromBlocks(updatedBlocks, blockId, endedFee)
        await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
      }

      // 終了時の料金をロック（以降の種別変更で再計算されないように）
      setLockedBlockFees(prev => ({ ...prev, [blockId]: endedFee }))
      if (isFreetime(pricingType)) {
        setLockedFreetimeIds(prev => new Set([...prev, blockId]))
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
    if (block.ended_at) update.ended_at = newEnd || block.ended_at
    await supabase.from('time_blocks').update(update).eq('id', block.id)
    const updatedBlocks = timeBlocks.map(b => b.id === block.id ? { ...b, ...update } : b)
    setTimeBlocks(updatedBlocks)
    setEditingBlockId(null)

    if (block.ended_at && rate) {
      const editedEnd = update.ended_at || block.ended_at
      const mins = Math.floor((new Date(editedEnd) - new Date(newStart)) / 60000)
      // フリータイムブロックはフラット料金のため時間修正しても金額不変
      const newFee = lockedFreetimeIds.has(block.id)
        ? (lockedBlockFees[block.id] ?? 0)
        : (!isFreetime(pricingType) && mins > 0 ? roundUp50((rate.price_per_minute || 0) * mins) : 0)

      // 時間修正後に total_play_fee を再計算してsessionsに保存
      const totalPlayFee = calcTotalPlayFeeFromBlocks(updatedBlocks, block.id, newFee)
      await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)

      setLockedBlockFees(prev => ({ ...prev, [block.id]: newFee }))
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
