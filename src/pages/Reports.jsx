import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TYPE_LABEL, isFreetime } from '../lib/constants'

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
  const [sortKey, setSortKey] = useState('ended_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [modalSession, setModalSession] = useState(null)
  const [modalHistory, setModalHistory] = useState([])
  const [modalLoading, setModalLoading] = useState(false)
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
        .select('*, menu_items(name), sessions(customer_type, guest_name, checked_by, table_id, tables(table_number), members(name))')
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

    // キャンセル履歴の担当者IDも profileMap に含める
    const cancelledByIds = [...new Set((cancelled || []).map(i => i.sessions?.checked_by).filter(Boolean))]
    const missingIds = cancelledByIds.filter(id => !profileMap[id])
    if (missingIds.length > 0) {
      const { data: extraProfiles } = await supabase.from('user_profiles').select('id, name').in('id', missingIds)
      ;(extraProfiles || []).forEach(p => { profileMap[p.id] = p.name })
    }

    setSessions((sess || []).map(s => ({ ...s, staff_name: profileMap[s.checked_by] ?? null })))
    setCancelledItems((cancelled || []).map(i => ({ ...i, staff_name: profileMap[i.sessions?.checked_by] ?? null })))
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
    const hourly = list.filter(s => !isFreetime(s.pricing_type))
    const freetime = list.filter(s => isFreetime(s.pricing_type))
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

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  function sortSessions(list) {
    return [...list].sort((a, b) => {
      let av, bv
      if (sortKey === 'ended_at')      { av = a.ended_at; bv = b.ended_at }
      else if (sortKey === 'table')    { av = a.tables?.table_number ?? 0; bv = b.tables?.table_number ?? 0 }
      else if (sortKey === 'type')     { av = a.customer_type; bv = b.customer_type }
      else if (sortKey === 'staff')    { av = a.staff_name ?? ''; bv = b.staff_name ?? '' }
      else if (sortKey === 'play')     { av = a.total_play_fee || 0; bv = b.total_play_fee || 0 }
      else if (sortKey === 'food')     { av = a.total_food_fee || 0; bv = b.total_food_fee || 0 }
      else if (sortKey === 'total')    { av = a.grand_total || 0; bv = b.grand_total || 0 }
      if (av < bv) return sortAsc ? -1 : 1
      if (av > bv) return sortAsc ? 1 : -1
      return 0
    })
  }

  async function openModal(s) {
    setModalSession(s)
    setModalHistory([])
    setModalLoading(true)
    const [{ data: blocks }, { data: orders }, { data: pricing }] = await Promise.all([
      supabase.from('time_blocks').select('*').eq('session_id', s.id).order('started_at'),
      supabase.from('order_items').select('*, menu_items(name, category)').eq('session_id', s.id).order('id'),
      supabase.from('pricing_master').select('*').eq('customer_type', s.customer_type).eq('pricing_type', s.pricing_type),
    ])
    const rate = pricing?.[0]
    const calcBlockFee = (block) => {
      if (isFreetime(s.pricing_type)) return null
      const ended = block.ended_at ? new Date(block.ended_at) : new Date()
      const mins = Math.floor((ended - new Date(block.started_at)) / 60000)
      if (mins <= 0) return 0
      return Math.ceil(((rate?.price_per_minute || 0) * mins) / 50) * 50
    }
    const history = [
      ...(blocks || []).map(b => ({ type: 'block', sortTime: new Date(b.started_at), startTime: b.started_at, endTime: b.ended_at, fee: calcBlockFee(b) })),
      ...(orders || []).map(o => ({ type: 'order', sortTime: new Date(o.created_at || s.started_at), name: o.menu_items?.name, category: o.menu_items?.category, quantity: o.quantity, fee: o.unit_price * o.quantity, cancelled: !!o.cancelled_at })),
    ].sort((a, b) => a.sortTime - b.sortTime)
    setModalHistory(history)
    setModalLoading(false)
  }

  function fmtModalTime(str) {
    return new Date(str).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function fmtTime(str) {
    return new Date(str).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  function fmtElapsed(start, end) {
    const diff = Math.floor((new Date(end || Date.now()) - new Date(start)) / 60000)
    const h = Math.floor(diff / 60), m = diff % 60
    return h > 0 ? `${h}時間${m}分` : `${m}分`
  }

  const CATEGORY_ICON = { drink: '🥤', alcohol: '🍺', food: '🍔', discount: '🏷️' }

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
            <div className="grid grid-cols-5 gap-3">
              {['general', 'female', 'university', 'high_school', 'staff'].map(ct => {
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
                    {[['ended_at','会計日時','left','px-4'],['table','台','left','px-3'],['type','区分','left','px-3'],['staff','担当','left','px-3'],['play','プレー','right','px-3'],['food','F&D','right','px-3'],['total','合計','right','px-4']].map(([key, label, align, px]) => (
                      <th key={key} onClick={() => handleSort(key)}
                        className={`text-${align} ${px} py-2 text-gray-600 cursor-pointer hover:text-gray-900 select-none whitespace-nowrap`}>
                        {label}{sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortSessions(displaySessions).map(s => (
                    <tr key={s.id} className="hover:bg-red-50 cursor-pointer" onClick={() => openModal(s)}>
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
                    <th className="text-left px-3 py-2 text-gray-600">区分</th>
                    <th className="text-left px-3 py-2 text-gray-600">担当</th>
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
                      <td className="px-3 py-2 text-gray-600">
                        <div>{TYPE_LABEL[item.sessions?.customer_type] ?? '-'}</div>
                        {(item.sessions?.members?.name || item.sessions?.guest_name) && (
                          <div className="text-xs text-gray-400">👤{item.sessions?.members?.name || item.sessions?.guest_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{item.staff_name ?? '-'}</td>
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

      {/* 伝票詳細モーダル */}
      {modalSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setModalSession(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <p className="font-semibold text-gray-800">伝票詳細</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {modalSession.tables?.table_number === 99 ? 'その他' : `#${modalSession.tables?.table_number}台`}
                  　{fmtModalTime(modalSession.started_at)} 来店 → {fmtModalTime(modalSession.ended_at)} 会計
                </p>
              </div>
              <button onClick={() => setModalSession(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b">
              {[['プレー', modalSession.total_play_fee], ['F&D', modalSession.total_food_fee], ['合計', modalSession.grand_total]].map(([label, val]) => (
                <div key={label} className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="font-medium text-gray-800">¥{(val || 0).toLocaleString()}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-3 border-b text-sm">
              <div>
                <span className="text-xs text-gray-400">区分</span>
                <p className="text-gray-700">{TYPE_LABEL[modalSession.customer_type]}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">客名</span>
                <p className="text-gray-700">{modalSession.members?.name || modalSession.guest_name || '-'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">担当</span>
                <p className="text-gray-700">{modalSession.staff_name || '-'}</p>
              </div>
            </div>

            <div className="px-5 py-3 overflow-y-auto flex-1">
              <p className="text-xs font-medium text-gray-500 mb-2">注文履歴</p>
              {modalLoading ? (
                <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
              ) : modalHistory.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">履歴なし</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {modalHistory.map((item, i) => (
                    <div key={i} className={`flex items-center justify-between text-sm ${item.cancelled ? 'opacity-40' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400 shrink-0">{fmtTime(item.sortTime)}</span>
                        {item.type === 'block' ? (
                          <span className="text-gray-700">🎱 {fmtTime(item.startTime)}〜{item.endTime ? fmtTime(item.endTime) : 'プレー中'}（{fmtElapsed(item.startTime, item.endTime)}）</span>
                        ) : (
                          <span className={`text-gray-700 ${item.cancelled ? 'line-through' : ''}`}>
                            {CATEGORY_ICON[item.category] ?? '🍹'} {item.name} ×{item.quantity}
                          </span>
                        )}
                        {item.cancelled && <span className="text-xs text-red-400">取消</span>}
                      </div>
                      {item.type === 'block' && item.fee !== null ? (
                        <span className="shrink-0 ml-2 text-gray-600">¥{item.fee.toLocaleString()}</span>
                      ) : item.type === 'block' && item.fee === null ? (
                        <span className="shrink-0 ml-2 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">フリータイム</span>
                      ) : (
                        <span className={`shrink-0 ml-2 ${item.cancelled ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                          ¥{item.fee.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
