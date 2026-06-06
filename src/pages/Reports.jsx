import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TYPE_LABEL } from '../lib/constants'

function toLocalDateStr(dt) {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getBusinessDate(datetimeStr, businessStartTime) {
  // businessStartTime: "HH:MM:SS" or "HH:MM"
  const dt = new Date(datetimeStr)
  const [startH] = (businessStartTime || '00:00').split(':').map(Number)
  // If time is before business_start_time, it belongs to the previous business day
  if (dt.getHours() < startH) {
    dt.setDate(dt.getDate() - 1)
  }
  return toLocalDateStr(dt)
}

function todayStr() { return toLocalDateStr(new Date()) }
function nowTimeStr() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Reports() {
  const [tab, setTab] = useState('daily')
  const [sessions, setSessions] = useState([])
  const [cancelledItems, setCancelledItems] = useState([])
  const [shopSettings, setShopSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(() => todayStr())
  const [rangeFromDate, setRangeFromDate] = useState(() => todayStr())
  const [rangeFromTime, setRangeFromTime] = useState('00:00')
  const [rangeToDate, setRangeToDate] = useState(() => todayStr())
  const [rangeToTime, setRangeToTime] = useState(() => nowTimeStr())

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    if (shopSettings !== null) fetchSessions()
  }, [shopSettings, tab, selectedMonth, selectedDate])

  async function fetchSettings() {
    const { data } = await supabase.from('shop_settings').select('*').limit(1).single()
    setShopSettings(data || { business_start_time: '10:00', business_end_time: '03:00' })
  }

  async function fetchSessions(overrideTab) {
    setLoading(true)
    const t = overrideTab || tab
    let from, to
    if (t === 'daily') {
      from = new Date(`${selectedDate}T00:00:00`)
      to = new Date(`${selectedDate}T23:59:59`)
      from.setHours(0, 0, 0, 0)
      to.setDate(to.getDate() + 1)
      to.setHours(23, 59, 59, 999)
    } else if (t === 'range') {
      from = new Date(`${rangeFromDate}T${rangeFromTime}:00`)
      to = new Date(`${rangeToDate}T${rangeToTime}:59`)
    } else {
      from = new Date(`${selectedMonth}-01T00:00:00`)
      to = new Date(from)
      to.setMonth(to.getMonth() + 1)
    }

    const [{ data: sess }, { data: cancelled }] = await Promise.all([
      supabase
        .from('sessions')
        .select('*, tables(table_number), members(name)')
        .eq('is_paid', true)
        .gte('ended_at', from.toISOString())
        .lt('ended_at', to.toISOString())
        .order('ended_at'),
      supabase
        .from('order_items')
        .select('*, menu_items(name), sessions(table_id, tables(table_number))')
        .not('cancelled_at', 'is', null)
        .gte('cancelled_at', from.toISOString())
        .lt('cancelled_at', to.toISOString())
        .order('cancelled_at', { ascending: false }),
    ])

    // checked_by（auth.users ID）からスタッフ名を別途取得して紐づけ
    const checkedByIds = [...new Set((sess || []).map(s => s.checked_by).filter(Boolean))]
    let profileMap = {}
    if (checkedByIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, name')
        .in('id', checkedByIds)
      ;(profiles || []).forEach(p => { profileMap[p.id] = p.name })
    }

    setSessions((sess || []).map(s => ({ ...s, staff_name: profileMap[s.checked_by] ?? null })))
    setCancelledItems(cancelled || [])
    setLoading(false)
  }

  const startTime = shopSettings?.business_start_time || '00:00'

  // Group by business date
  const grouped = {}
  sessions.forEach(s => {
    const d = getBusinessDate(s.ended_at, startTime)
    if (!grouped[d]) grouped[d] = []
    grouped[d].push(s)
  })

  function calcStats(list) {
    const play = list.reduce((a, s) => a + (s.total_play_fee || 0), 0)
    const food = list.reduce((a, s) => a + (s.total_food_fee || 0), 0)
    const total = list.reduce((a, s) => a + (s.grand_total || 0), 0)
    const byType = {}
    list.forEach(s => {
      const ct = s.customer_type
      if (!byType[ct]) byType[ct] = { count: 0, total: 0 }
      byType[ct].count++
      byType[ct].total += s.grand_total || 0
    })
    const hourly = list.filter(s => s.pricing_type !== 'freetime')
    const freetime = list.filter(s => s.pricing_type === 'freetime')
    return { play, food, total, count: list.length, byType, hourly, freetime }
  }

  function downloadCSV() {
    const header = ['日付', '件数', 'プレー料金', 'F&D', '合計', '一般', '女性', '大学生', '高校生', '時間制', 'フリータイム']
    const rows = Object.entries(grouped).sort().map(([date, list]) => {
      const s = calcStats(list)
      return [
        date,
        s.count,
        s.play,
        s.food,
        s.total,
        s.byType.general?.total || 0,
        s.byType.female?.total || 0,
        s.byType.university?.total || 0,
        s.byType.high_school?.total || 0,
        s.hourly.reduce((a, x) => a + (x.grand_total || 0), 0),
        s.freetime.reduce((a, x) => a + (x.grand_total || 0), 0),
      ]
    })
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const label = tab === 'daily' ? selectedDate : tab === 'range' ? `${rangeFromDate}_${rangeToDate}` : selectedMonth
    a.download = `売上_${label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // For daily tab, show single date stats; for monthly, show each day
  const displayDates = tab === 'daily'
    ? (grouped[selectedDate] ? [selectedDate] : [])
    : Object.keys(grouped).sort()

  const displaySessions = tab === 'daily' ? (grouped[selectedDate] || []) : sessions
  const allStats = calcStats(displaySessions)

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">売上レポート</h1>
        <button
          onClick={downloadCSV}
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
        >
          CSV
        </button>
      </div>

      {/* Tab */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[['daily', '日別'], ['monthly', '月別'], ['range', '期間指定']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${tab === v ? 'bg-green-700 text-white' : 'bg-white text-gray-700 border'}`}
          >
            {l}
          </button>
        ))}
        <div className="ml-auto">
          {tab === 'daily' && (
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm" />
          )}
          {tab === 'monthly' && (
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm" />
          )}
        </div>
      </div>

      {/* 期間指定UI */}
      {tab === 'range' && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-12 shrink-0">開始</label>
            <input type="date" value={rangeFromDate} onChange={e => setRangeFromDate(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm" />
            <input type="time" value={rangeFromTime} onChange={e => setRangeFromTime(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-24" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 w-12 shrink-0">終了</label>
            <input type="date" value={rangeToDate} onChange={e => setRangeToDate(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm" />
            <input type="time" value={rangeToTime} onChange={e => setRangeToTime(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-24" />
          </div>
          <button
            onClick={() => fetchSessions('range')}
            className="self-start bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            集計する
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">読み込み中...</div>
      ) : (
        <>
          {/* Summary card */}
          <div className="bg-green-700 text-white rounded-xl p-4 mb-4 grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xs opacity-80">プレー</div>
              <div className="text-xl font-bold">¥{allStats.play.toLocaleString()}</div>
            </div>
            <div className="text-center border-x border-green-600">
              <div className="text-xs opacity-80">F&D</div>
              <div className="text-xl font-bold">¥{allStats.food.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-xs opacity-80">合計</div>
              <div className="text-xl font-bold">¥{allStats.total.toLocaleString()}</div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">区分別</h3>
            <div className="grid grid-cols-4 gap-3">
              {['general', 'female', 'university', 'high_school'].map(ct => {
                const d = allStats.byType[ct] || { count: 0, total: 0 }
                return (
                  <div key={ct} className="text-center">
                    <div className="text-xs text-gray-500">{TYPE_LABEL[ct]}</div>
                    <div className="font-bold">¥{d.total.toLocaleString()}</div>
                    <div className="text-xs text-gray-400">{d.count}件</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className="text-xs text-gray-500">時間制</div>
                <div className="font-bold">¥{allStats.hourly.reduce((a, s) => a + (s.grand_total || 0), 0).toLocaleString()}</div>
                <div className="text-xs text-gray-400">{allStats.hourly.length}件</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500">フリータイム</div>
                <div className="font-bold">¥{allStats.freetime.reduce((a, s) => a + (s.grand_total || 0), 0).toLocaleString()}</div>
                <div className="text-xs text-gray-400">{allStats.freetime.length}件</div>
              </div>
            </div>
          </div>

          {/* Date-by-date (monthly view) */}
          {tab === 'monthly' && displayDates.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600">日付</th>
                    <th className="text-right px-3 py-2 text-gray-600">件数</th>
                    <th className="text-right px-3 py-2 text-gray-600">プレー</th>
                    <th className="text-right px-3 py-2 text-gray-600">F&D</th>
                    <th className="text-right px-4 py-2 text-gray-600">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {displayDates.map(d => {
                    const s = calcStats(grouped[d])
                    return (
                      <tr key={d} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{d.slice(5)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{s.count}</td>
                        <td className="px-3 py-2 text-right">¥{s.play.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">¥{s.food.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-bold">¥{s.total.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {displayDates.length === 0 && (
            <div className="text-center py-10 text-gray-400">データがありません</div>
          )}

          {/* 伝票一覧 */}
          {displaySessions.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-gray-700">伝票一覧</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600">会計日時</th>
                    <th className="text-left px-3 py-2 text-gray-600">台</th>
                    <th className="text-left px-3 py-2 text-gray-600">区分</th>
                    <th className="text-left px-3 py-2 text-gray-600">担当</th>
                    <th className="text-right px-3 py-2 text-gray-600">プレー</th>
                    <th className="text-right px-3 py-2 text-gray-600">F&D</th>
                    <th className="text-right px-4 py-2 text-gray-600">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {displaySessions.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                        {new Date(s.ended_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {s.tables?.table_number === 99 ? 'その他' : `#${s.tables?.table_number ?? '-'}`}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        <div>{TYPE_LABEL[s.customer_type]}</div>
                        {(s.members?.name || s.guest_name) && (
                          <div className="text-xs text-gray-400">👤{s.members?.name || s.guest_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{s.staff_name ?? '-'}</td>
                      <td className="px-3 py-2 text-right">¥{(s.total_play_fee || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">¥{(s.total_food_fee || 0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-bold">¥{(s.grand_total || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* キャンセル履歴 */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-4">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">キャンセル履歴</h3>
              {cancelledItems.length > 0 && (
                <span className="text-sm text-red-500 font-medium">
                  合計 ¥{cancelledItems.reduce((s, i) => s + i.unit_price * i.quantity, 0).toLocaleString()} ({cancelledItems.length}件)
                </span>
              )}
            </div>
            {cancelledItems.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">キャンセルはありません</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600">キャンセル日時</th>
                    <th className="text-left px-3 py-2 text-gray-600">台</th>
                    <th className="text-left px-3 py-2 text-gray-600">商品</th>
                    <th className="text-right px-4 py-2 text-gray-600">金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cancelledItems.map(item => (
                    <tr key={item.id} className="hover:bg-red-50">
                      <td className="px-4 py-2 text-gray-500">
                        {new Date(item.cancelled_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {item.sessions?.tables?.table_number === 99 ? 'その他' : `#${item.sessions?.tables?.table_number ?? '-'}`}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-700">
                        {item.menu_items?.name} ×{item.quantity}
                      </td>
                      <td className="px-4 py-2 text-right text-red-500 font-medium">
                        ¥{(item.unit_price * item.quantity).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
