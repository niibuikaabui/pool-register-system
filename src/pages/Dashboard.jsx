import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TYPE_LABEL } from '../lib/constants'
import { fmtElapsed } from '../lib/utils'

const STATUS_COLOR = {
  empty: 'bg-gray-100 border-gray-300 text-gray-700',
  in_use: 'bg-green-50 border-green-400 text-green-800',
}

export default function Dashboard() {
  const [tables, setTables] = useState([])
  const [sessions, setSessions] = useState({})
  const [loading, setLoading] = useState(true)
  const [editNote, setEditNote] = useState(null)
  const [noteText, setNoteText] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel('tables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_blocks' }, fetchData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchData() {
    const [{ data: tbl }, { data: sess }, { data: activeBlocks }] = await Promise.all([
      supabase.from('tables').select('*').order('table_number'),
      supabase.from('sessions').select('*, members(name, member_number), guest_name').eq('is_paid', false),
      supabase.from('time_blocks').select('session_id').is('ended_at', null),
    ])
    setTables(tbl || [])

    // セッションIDのセット（プレー中）
    const playingSessionIds = new Set((activeBlocks || []).map(b => b.session_id))

    const map = {}
    ;(sess || []).forEach(s => {
      if (!map[s.table_id]) map[s.table_id] = []
      map[s.table_id].push({ ...s, isPlaying: playingSessionIds.has(s.id) })
    })
    setSessions(map)
    setLoading(false)
  }

  async function startSession(tableId) {
    const { data, error } = await supabase.from('sessions').insert({
      table_id: tableId,
      customer_type: 'general',
      pricing_type: 'hourly_multi',
      started_at: new Date().toISOString(),
      is_paid: false,
    }).select().single()
    if (error) { alert('伝票作成エラー: ' + error.message); return }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tableId)
    navigate(`/checkout/${data.id}?table=${tableId}`)
  }

  async function updateNote(tableId) {
    await supabase.from('tables').update({ note: noteText }).eq('id', tableId)
    setEditNote(null)
    fetchData()
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">読み込み中...</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">台の状況</h1>
        <span className="text-sm text-gray-500">
          使用中: {Object.keys(sessions).length} 台
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tables.filter(table => table.table_number < 6 || table.table_number === 99).map(table => {
          const isOther = table.table_number === 99
          const slips = sessions[table.id] || []
          const status = slips.length > 0 ? 'in_use' : 'empty'
          const playingCount = slips.filter(s => s.isPlaying).length
          function handleCardClick(e) {
            if (status === 'empty') startSession(table.id)
            else navigate(`/table/${table.id}`)
          }

          return (
            <div
              key={table.id}
              className={`border-2 rounded-xl p-3 flex flex-col gap-2 ${STATUS_COLOR[status]}`}
            >
              <button
                onClick={handleCardClick}
                className={`flex justify-between items-center w-full rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                  status === 'in_use'
                    ? 'hover:bg-green-100 active:bg-green-200'
                    : 'hover:bg-gray-200 active:bg-gray-300'
                }`}
              >
                <span className="font-bold text-lg">{isOther ? 'その他' : `#${table.table_number}`}</span>
                {slips.length > 0 && (
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className="text-green-700">📋 {slips.length}件</span>
                    <span className={playingCount > 0 ? 'text-blue-600' : 'text-gray-400'}>🎱 {playingCount}人</span>
                  </div>
                )}
              </button>

              {slips.length > 0 && (
                <div className="flex flex-col gap-1">
                  {slips.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={e => { e.stopPropagation(); navigate(`/checkout/${s.id}?table=${table.id}`) }}
                      className={`text-left text-xs rounded-lg px-2 py-1.5 transition-colors active:opacity-70 ${
                        s.isPlaying ? 'bg-blue-50 hover:bg-blue-100' : 'bg-white/60 hover:bg-white'
                      }`}
                    >
                      <div className="flex sm:flex-row flex-col sm:items-center sm:gap-1">
                        <div className="flex items-center gap-1 text-gray-600">
                          <span>{i + 1}.</span>
                          {s.members && <span>👤{s.members.name}</span>}
                          {!s.members && s.guest_name && <span>👤{s.guest_name}</span>}
                          <span>{TYPE_LABEL[s.customer_type]}</span>
                        </div>
                        {s.isPlaying && <span className="text-blue-500 font-medium">▶ {fmtElapsed(s.started_at)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Note — クリックイベントを止めてカード遷移と干渉しないようにする */}
              <div onClick={e => e.stopPropagation()}>
                {editNote === table.id ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      className="flex-1 border rounded px-2 py-1 text-xs text-gray-800"
                      placeholder="備考を入力"
                    />
                    <button onClick={() => updateNote(table.id)} className="bg-green-600 text-white px-2 rounded text-xs">✓</button>
                    <button onClick={() => setEditNote(null)} className="bg-gray-300 px-2 rounded text-xs">✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditNote(table.id); setNoteText(table.note || '') }}
                    className="text-left text-xs text-gray-400 hover:text-gray-600 truncate w-full"
                  >
                    {table.note || '📝 備考追加'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
