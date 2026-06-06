import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TYPE_LABEL, PRICING_LABEL } from '../lib/constants'
import { fmtElapsed } from '../lib/utils'
import TableMoveModal from '../components/TableMoveModal'

function roundUp50(n) { return Math.ceil(n / 50) * 50 }

export default function TableSlips() {
  const { tableId } = useParams()
  const [table, setTable] = useState(null)
  const [slips, setSlips] = useState([])
  const [pricing, setPricing] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [endingPlay, setEndingPlay] = useState(false)
  const [showBulkPay, setShowBulkPay] = useState(false)
  const [bulkPayInput, setBulkPayInput] = useState('')
  const [bulkPaying, setBulkPaying] = useState(false)
  const [movingSlip, setMovingSlip] = useState(null)
  const [allTables, setAllTables] = useState([])
  const [tick, setTick] = useState(0)
  const navigate = useNavigate()

  async function addSlip() {
    setCreating(true)
    const { data, error } = await supabase.from('sessions').insert({
      table_id: tableId,
      customer_type: 'general',
      pricing_type: 'hourly_multi',
      started_at: new Date().toISOString(),
      is_paid: false,
    }).select().single()
    if (error) { alert('伝票作成エラー: ' + error.message); setCreating(false); return }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tableId)
    navigate(`/checkout/${data.id}?table=${tableId}`)
  }

  // 経過時間を1分ごとに更新
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel(`table-slips-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_blocks' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tableId])

  async function fetchData() {
    const [{ data: tbl }, { data: sess }, { data: activeBlocks }, { data: p }, { data: tbls }] = await Promise.all([
      supabase.from('tables').select('*').eq('id', tableId).single(),
      supabase.from('sessions')
        .select('*, members(name, member_number), guest_name, order_items(unit_price, quantity, cancelled_at)')
        .eq('table_id', tableId)
        .eq('is_paid', false)
        .order('started_at'),
      supabase.from('time_blocks').select('session_id, started_at').is('ended_at', null),
      supabase.from('pricing_master').select('*'),
      supabase.from('tables').select('*').order('table_number'),
    ])
    setTable(tbl)
    setPricing(p || [])
    setAllTables(tbls || [])
    const playingIds = new Set((activeBlocks || []).map(b => b.session_id))
    const playingStart = Object.fromEntries((activeBlocks || []).map(b => [b.session_id, b.started_at]))
    setSlips((sess || []).map(s => ({
      ...s,
      isPlaying: playingIds.has(s.id),
      playStartedAt: playingStart[s.id] || null,
    })))
    setLoading(false)
  }

  // eslint-disable-next-line no-unused-vars
  const _tick = tick

  function calcSlipFee(slip) {
    const foodFee = (slip.order_items || []).filter(o => !o.cancelled_at).reduce((a, o) => a + o.unit_price * o.quantity, 0)
    const rate = pricing.find(p => p.customer_type === slip.customer_type && p.pricing_type === slip.pricing_type)
    let playFee = slip.total_play_fee || 0
    if (slip.isPlaying && slip.playStartedAt && rate) {
      if (slip.pricing_type === 'freetime') {
        playFee = rate.freetime_price || 0
      } else {
        const mins = Math.floor((new Date() - new Date(slip.playStartedAt)) / 60000)
        playFee += roundUp50((rate.price_per_minute || 0) * mins)
      }
    }
    return { playFee, foodFee, total: playFee + foodFee }
  }

  async function endAllPlay() {
    const playingSlips = slips.filter(s => s.isPlaying)
    if (playingSlips.length === 0) return
    if (!confirm(`${playingSlips.length}件のプレーを一括終了しますか？`)) return
    setEndingPlay(true)
    const now = new Date().toISOString()

    await Promise.all(playingSlips.map(async slip => {
      // アクティブなブロックを終了
      const { data: activeBlock } = await supabase
        .from('time_blocks')
        .update({ ended_at: now })
        .eq('session_id', slip.id)
        .is('ended_at', null)
        .select()
        .single()

      // 全ブロック取得して料金計算
      const { data: allBlocks } = await supabase
        .from('time_blocks')
        .select('*')
        .eq('session_id', slip.id)

      const rate = pricing.find(p => p.customer_type === slip.customer_type && p.pricing_type === slip.pricing_type)
      let totalPlayFee = 0
      if (rate) {
        if (slip.pricing_type === 'freetime') {
          totalPlayFee = rate.freetime_price || 0
        } else {
          totalPlayFee = (allBlocks || []).reduce((sum, b) => {
            const ended = b.ended_at ? new Date(b.ended_at) : new Date(now)
            const mins = Math.floor((ended - new Date(b.started_at)) / 60000)
            if (mins <= 0) return sum
            return sum + roundUp50((rate.price_per_minute || 0) * mins)
          }, 0)
        }
      }

      // セッションの料金を更新
      const { data: orderData } = await supabase
        .from('order_items')
        .select('unit_price, quantity')
        .eq('session_id', slip.id)
        .is('cancelled_at', null)
      const foodFee = (orderData || []).reduce((sum, o) => sum + o.unit_price * o.quantity, 0)

      await supabase.from('sessions').update({
        total_play_fee: totalPlayFee,
        total_food_fee: foodFee,
        grand_total: totalPlayFee + foodFee,
      }).eq('id', slip.id)
    }))

    setEndingPlay(false)
    await fetchData()
  }

  async function handleMoveTable(newTableId) {
    if (!movingSlip) return
    // 選択した伝票を新しい台に移動
    await supabase.from('sessions').update({ table_id: newTableId }).eq('id', movingSlip.id)
    // 新しい台を使用中に
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', newTableId)
    // 元の台に残伝票がなければ空きに
    const { data: remaining } = await supabase
      .from('sessions').select('id')
      .eq('table_id', tableId).eq('is_paid', false).neq('id', movingSlip.id)
    if (!remaining || remaining.length === 0) {
      await supabase.from('tables').update({ status: 'empty' }).eq('id', tableId)
    }
    setMovingSlip(null)
    await fetchData()
  }

  async function handleBulkPay() {
    setBulkPaying(true)
    const now = new Date().toISOString()
    await Promise.all(slips.map(slip =>
      supabase.from('sessions').update({
        ended_at: slip.ended_at || now,
        is_paid: true,
      }).eq('id', slip.id)
    ))
    // 台を空きに
    await supabase.from('tables').update({ status: 'empty', note: null }).eq('id', tableId)
    setBulkPaying(false)
    navigate('/')
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">読み込み中...</div>

  return (
    <div>
      {/* 台移動モーダル */}
      {movingSlip && (
        <TableMoveModal
          tables={allTables}
          currentTableId={tableId}
          onMove={handleMoveTable}
          onClose={() => setMovingSlip(null)}
          description={`伝票 ${slips.findIndex(s => s.id === movingSlip.id) + 1}${(movingSlip.members?.name || movingSlip.guest_name) ? `（${movingSlip.members?.name || movingSlip.guest_name}）` : ''} を移動します`}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 text-sm">← 戻る</button>
        <h1 className="text-xl font-bold text-gray-800">
          #{table?.table_number} 台 — 伝票一覧
        </h1>
        <span className="ml-auto text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {slips.length} 件
        </span>
      </div>

      {/* Slip list */}
      {slips.length === 0 ? (
        <div className="text-center py-12 text-gray-400">伝票がありません</div>
      ) : (
        <div className="flex flex-col gap-3 mb-4">
          {slips.map((slip, i) => (
            <button
              key={slip.id}
              onClick={() => navigate(`/checkout/${slip.id}?table=${tableId}`)}
              className="bg-white rounded-xl shadow-sm p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors w-full"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-bold text-gray-800">伝票 {i + 1}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {TYPE_LABEL[slip.customer_type]}
                    </span>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                      {PRICING_LABEL[slip.pricing_type]}
                    </span>
                    {slip.isPlaying ? (
                      <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">▶ プレー中</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">休憩中</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 flex gap-4">
                    {slip.members && <span>👤 {slip.members.name}</span>}
                    {!slip.members && slip.guest_name && <span>👤 {slip.guest_name}</span>}
                    {slip.isPlaying && (
                      <>
                        <span>⏱ {fmtElapsed(slip.playStartedAt)}</span>
                        <span className="text-gray-400">
                          {new Date(slip.playStartedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 開始
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right ml-4 shrink-0">
                  {(() => {
                    const { playFee, foodFee, total } = calcSlipFee(slip)
                    return (
                      <>
                        <div className={`text-lg font-bold ${slip.isPlaying ? 'text-orange-500' : 'text-gray-700'}`}>
                          ¥{total.toLocaleString()}
                          {slip.isPlaying && <span className="text-xs ml-1">概算</span>}
                        </div>
                        <div className="text-xs text-gray-400 space-x-2">
                          {playFee > 0 && <span>🎱¥{playFee.toLocaleString()}</span>}
                          {foodFee > 0 && <span>🍹¥{foodFee.toLocaleString()}</span>}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
              <div className="mt-2 flex justify-end" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setMovingSlip(slip)}
                  className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1 rounded-full transition-colors"
                >
                  台を移動
                </button>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 全員合計 & まとめ払い */}
      {slips.length > 0 && !slips.some(s => s.isPlaying) && (() => {
        const grandTotal = slips.reduce((sum, s) => sum + calcSlipFee(s).total, 0)
        const payment = parseInt(bulkPayInput) || 0
        const change = payment - grandTotal
        return (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold text-gray-700">全員合計</span>
              <span className="text-2xl font-bold text-green-700">¥{grandTotal.toLocaleString()}</span>
            </div>
            {showBulkPay ? (
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  お預かり金額（現金）<span className="text-gray-400 font-normal ml-1">任意</span>
                </label>
                <input
                  type="number"
                  value={bulkPayInput}
                  onChange={e => setBulkPayInput(e.target.value)}
                  className="w-full border-2 border-blue-400 rounded-lg px-4 py-3 text-xl text-right font-bold mb-2"
                  placeholder="入力しない場合はそのまま会計完了"
                  autoFocus
                />
                {payment > 0 && (
                  <div className={`text-right text-lg font-bold mb-3 ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    お釣り: ¥{change.toLocaleString()}
                  </div>
                )}
                <button
                  onClick={handleBulkPay}
                  disabled={bulkPaying}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
                >
                  {bulkPaying ? '処理中...' : '会計完了（全員）'}
                </button>
                <button
                  onClick={() => { setShowBulkPay(false); setBulkPayInput('') }}
                  className="w-full mt-2 text-gray-400 text-sm py-2"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowBulkPay(true)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-3 text-base transition-colors"
              >
                まとめ払い
              </button>
            )}
          </div>
        )
      })()}

      {/* 一括プレー終了ボタン */}
      {slips.some(s => s.isPlaying) && (
        <button
          onClick={endAllPlay}
          disabled={endingPlay}
          className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors mb-3"
        >
          {endingPlay ? '処理中...' : `■ この台のプレーを一括終了（${slips.filter(s => s.isPlaying).length}件）`}
        </button>
      )}

      {/* Add slip button */}
      <button
        onClick={addSlip}
        disabled={creating}
        className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
      >
        {creating ? '作成中...' : '+ 伝票を追加'}
      </button>
    </div>
  )
}
