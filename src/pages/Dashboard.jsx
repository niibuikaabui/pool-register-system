import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STATUS_LABEL = { empty: '空き', in_use: '使用中' }
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
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchData() {
    const [{ data: tbl }, { data: sess }] = await Promise.all([
      supabase.from('tables').select('*').order('table_number'),
      supabase.from('sessions').select('*, members(name, member_number), guest_name').eq('is_paid', false),
    ])
    setTables(tbl || [])
    const map = {}
    ;(sess || []).forEach(s => {
      if (!map[s.table_id]) map[s.table_id] = []
      map[s.table_id].push(s)
    })
    setSessions(map)
    setLoading(false)
  }

  function startSession(tableId) {
    navigate(`/checkout/new?table=${tableId}`)
  }

  async function updateNote(tableId) {
    await supabase.from('tables').update({ note: noteText }).eq('id', tableId)
    setEditNote(null)
    fetchData()
  }

  function formatElapsed(startedAt) {
    const diff = Math.floor((Date.now() - new Date(startedAt)) / 60000)
    const h = Math.floor(diff / 60)
    const m = diff % 60
    return h > 0 ? `${h}時間${m}分` : `${m}分`
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">読み込み中...</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">台の状況</h1>
        <span className="text-sm text-gray-500">
          使用中: {Object.keys(sessions).length} / {tables.length} 台
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tables.filter(t => t.table_number <= 5 || t.table_number === 99).map(table => {
          const isOther = table.table_number === 99
          const slips = sessions[table.id] || []
          const status = slips.length > 0 ? 'in_use' : 'empty'
          return (
            <div
              key={table.id}
              className={`border-2 rounded-xl p-3 flex flex-col gap-2 ${STATUS_COLOR[status]}`}
            >
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg">{isOther ? 'その他' : `#${table.table_number}`}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  status === 'in_use' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'
                }`}>
                  {STATUS_LABEL[status]}
                </span>
              </div>

              {slips.length > 0 && (
                <div className="text-xs text-gray-600">
                  <div className="font-medium text-green-700">伝票 {slips.length} 件</div>
                  {slips.map((s, i) => (
                    <div key={s.id} className="text-gray-500 mt-0.5">
                      {i + 1}. ⏱{formatElapsed(s.started_at)}
                      {' '}{ { general: '一般', female: '女性', student: '学生' }[s.customer_type]}
                      {s.members && ` 👤${s.members.name}`}
                      {!s.members && s.guest_name && ` 👤${s.guest_name}`}
                    </div>
                  ))}
                </div>
              )}

              {/* Note */}
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
                  className="text-left text-xs text-gray-400 hover:text-gray-600 truncate"
                >
                  {table.note || '📝 備考追加'}
                </button>
              )}

              {/* Actions */}
              {status === 'empty' ? (
                <button
                  onClick={() => startSession(table.id)}
                  className="mt-1 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg py-2 transition-colors"
                >
                  スタート
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/table/${table.id}`)}
                  className="mt-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg py-2 transition-colors"
                >
                  伝票一覧
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
