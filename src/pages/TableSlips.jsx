import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TYPE_LABEL, PRICING_LABEL } from '../lib/constants'
import { fmtElapsed } from '../lib/utils'

export default function TableSlips() {
  const { tableId } = useParams()
  const [table, setTable] = useState(null)
  const [slips, setSlips] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
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
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tableId])

  async function fetchData() {
    const [{ data: tbl }, { data: sess }, { data: activeBlocks }] = await Promise.all([
      supabase.from('tables').select('*').eq('id', tableId).single(),
      supabase.from('sessions')
        .select('*, members(name, member_number), guest_name')
        .eq('table_id', tableId)
        .eq('is_paid', false)
        .order('started_at'),
      supabase.from('time_blocks').select('session_id, started_at').is('ended_at', null),
    ])
    setTable(tbl)
    const playingIds = new Set((activeBlocks || []).map(b => b.session_id))
    const playingStart = Object.fromEntries((activeBlocks || []).map(b => [b.session_id, b.started_at]))
    setSlips((sess || []).map(s => ({
      ...s,
      isPlaying: playingIds.has(s.id),
      playStartedAt: playingStart[s.id] || null,
    })))
    setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">読み込み中...</div>

  return (
    <div>
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
                  <div className="flex items-center gap-2 mb-1.5">
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
                <span className="text-blue-600 font-medium text-sm ml-4">会計 →</span>
              </div>
            </button>
          ))}
        </div>
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
