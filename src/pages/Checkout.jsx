import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TYPE_LABEL = { general: '一般', female: '女性', student: '学生' }
const PRICING_LABEL = { hourly_multi: '時間制（複数）', hourly_single: '時間制（一人）', freetime: 'フリータイム' }

function roundUp50(n) {
  return Math.ceil(n / 50) * 50
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function fmtElapsed(startedAt, endedAt) {
  const diff = Math.floor((new Date(endedAt || Date.now()) - new Date(startedAt)) / 60000)
  if (diff < 0) return '0分'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

export default function Checkout() {
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const tableId = searchParams.get('table')
  const navigate = useNavigate()
  const isNew = sessionId === 'new'

  const [pricing, setPricing] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [members, setMembers] = useState([])

  const [customerType, setCustomerType] = useState('general')
  const [pricingType, setPricingType] = useState('hourly_multi')
  const [memberId, setMemberId] = useState(null)
  const [memberName, setMemberName] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [guestName, setGuestName] = useState('')
  const [memberError, setMemberError] = useState('')
  const [orderItems, setOrderItems] = useState([])
  const [timeBlocks, setTimeBlocks] = useState([])
  const [session, setSession] = useState(null)
  const [tables, setTables] = useState([])
  const [currentTableId, setCurrentTableId] = useState(tableId)
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [paymentInput, setPaymentInput] = useState('')
  const [showPayment, setShowPayment] = useState(false)
  const [tick, setTick] = useState(0)
  const barcodeRef = useRef(null)

  // 1分ごとに再描画（経過時間更新用）
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetchMaster()
    if (!isNew) {
      loadSession()
      const channel = supabase
        .channel(`checkout-${sessionId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'time_blocks', filter: `session_id=eq.${sessionId}` }, loadTimeBlocks)
        .subscribe()
      return () => supabase.removeChannel(channel)
    }
  }, [sessionId])

  async function fetchMaster() {
    const [{ data: p }, { data: m }, { data: t }] = await Promise.all([
      supabase.from('pricing_master').select('*'),
      supabase.from('menu_items').select('*').eq('is_available', true).order('category'),
      supabase.from('tables').select('*').order('table_number'),
    ])
    setPricing(p || [])
    setMenuItems(m || [])
    setTables(t || [])
  }

  async function loadSession() {
    const { data: s } = await supabase
      .from('sessions')
      .select('*, order_items(*, menu_items(name)), members(name)')
      .eq('id', sessionId)
      .single()
    if (s) {
      setSession(s)
      setCustomerType(s.customer_type)
      setPricingType(s.pricing_type)
      setMemberId(s.member_id)
      if (s.members?.name) setMemberName(s.members.name)
      setCurrentTableId(s.table_id)
      if (s.guest_name) setGuestName(s.guest_name)
      setOrderItems((s.order_items || []).map(o => ({ ...o, _addedAt: o.created_at || new Date().toISOString() })))
    }
    await loadTimeBlocks()
  }

  async function loadTimeBlocks() {
    const { data } = await supabase
      .from('time_blocks')
      .select('*')
      .eq('session_id', sessionId)
      .order('started_at')
    setTimeBlocks(data || [])
  }

  function getRate() {
    return pricing.find(p => p.customer_type === customerType && p.pricing_type === pricingType)
  }

  function calcBlockFee(block) {
    const rate = getRate()
    if (!rate || pricingType === 'freetime') return 0
    const ended = block.ended_at ? new Date(block.ended_at) : new Date()
    const mins = Math.floor((ended - new Date(block.started_at)) / 60000)
    if (mins <= 0) return 0
    return roundUp50((rate.price_per_minute || 0) * mins)
  }

  // tick を参照して毎分再計算されるようにする
  // eslint-disable-next-line no-unused-vars
  const _tick = tick

  const activeBlock = timeBlocks.find(b => !b.ended_at)
  const completedBlocks = timeBlocks.filter(b => b.ended_at)

  function calcPlayFee() {
    const rate = getRate()
    if (!rate) return 0
    if (pricingType === 'freetime') return rate.freetime_price || 0
    // 完了ブロック + 進行中ブロック（見積もり）の合計
    return timeBlocks.reduce((sum, b) => sum + calcBlockFee(b), 0)
  }

  function calcFoodFee() {
    return orderItems.filter(i => !i.cancelled_at).reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  }

  const playFee = calcPlayFee()
  const foodFee = calcFoodFee()
  const grandTotal = playFee + foodFee
  const payment = parseInt(paymentInput) || 0
  const change = payment - grandTotal

  // 注文履歴：完了した時間ブロック + ドリンク注文を時刻順で並べる
  const history = [
    ...completedBlocks.map(b => ({
      type: 'block',
      sortTime: new Date(b.started_at),
      id: b.id,
      startTime: b.started_at,
      endTime: b.ended_at,
      fee: calcBlockFee(b),
    })),
    ...orderItems.map(o => ({
      type: 'order',
      sortTime: new Date(o._addedAt || Date.now()),
      id: o.id || `${o.menu_item_id}-${o._addedAt}`,
      dbId: o.id,
      name: o.menu_items?.name,
      quantity: o.quantity,
      fee: o.unit_price * o.quantity,
      cancelled: !!o.cancelled_at,
    })),
  ].sort((a, b) => a.sortTime - b.sortTime)

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
    if (data) setTimeBlocks(prev => prev.map(b => b.id === blockId ? data : b))
  }

  // ─── ドリンク・フード ───
  async function addMenuItem(item) {
    // 毎回新規行として追加（時刻を個別に記録）
    const now = new Date().toISOString()
    const { data } = await supabase.from('order_items').insert({
      session_id: sessionId,
      menu_item_id: item.id,
      quantity: 1,
      unit_price: item.price,
    }).select('*, menu_items(name)').single()
    if (data) setOrderItems(prev => [...prev, { ...data, _addedAt: now }])
  }

  async function cancelOrderItem(id) {
    const now = new Date().toISOString()
    await supabase.from('order_items').update({ cancelled_at: now }).eq('id', id)
    setOrderItems(prev => prev.map(o => o.id === id ? { ...o, cancelled_at: now } : o))
  }

  // ─── 会員検索 ───
  useEffect(() => {
    if (!memberSearch) { setMembers([]); setMemberError(''); return }
    const t = setTimeout(() => searchMember(memberSearch), 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  async function searchMember(query) {
    if (!query) { setMembers([]); return }
    setMemberError('')
    const numVal = parseInt(query)
    const filters = [`name.ilike.%${query}%`, `phone.ilike.%${query}%`]
    if (!isNaN(numVal)) filters.push(`member_number.eq.${numVal}`)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(filters.join(','))
      .limit(5)
    if (error) { setMemberError('検索エラー: ' + error.message); return }
    setMembers(data || [])
    if (data?.length === 0) setMemberError('該当する会員が見つかりません')
  }

  function handleBarcodeInput(e) {
    if (e.key === 'Enter') searchMember(memberSearch)
  }

  // ─── 台移動 ───
  async function handleMoveTable(newTableId) {
    const oldTableId = currentTableId
    // sessionのtable_idを更新
    await supabase.from('sessions').update({ table_id: newTableId }).eq('id', sessionId)
    // 新しい台を使用中に
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', newTableId)
    // 古い台に残伝票がなければ空きに
    const { data: remaining } = await supabase
      .from('sessions').select('id')
      .eq('table_id', oldTableId).eq('is_paid', false).neq('id', sessionId)
    if (!remaining || remaining.length === 0) {
      await supabase.from('tables').update({ status: 'empty' }).eq('id', oldTableId)
    }
    setCurrentTableId(newTableId)
    setShowMoveModal(false)
  }

  // ─── 伝票作成（新規） ───
  async function handleCreateSession() {
    setSaving(true)
    const { data, error } = await supabase.from('sessions').insert({
      table_id: tableId,
      member_id: memberId || null,
      guest_name: memberId ? null : (guestName.trim() || null),
      customer_type: customerType,
      pricing_type: pricingType,
      started_at: new Date().toISOString(),
      is_paid: false,
    }).select().single()
    if (error) {
      alert('伝票作成エラー: ' + error.message)
      setSaving(false)
      return
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tableId)
    navigate(`/checkout/${data.id}?table=${tableId}`, { replace: true })
    setSaving(false)
  }

  // ─── 会計完了 ───
  async function handleCheckout() {
    setSaving(true)

    let finalPlayFee = playFee

    // 進行中のブロックを自動終了
    if (activeBlock) {
      const now = new Date().toISOString()
      await supabase.from('time_blocks').update({ ended_at: now }).eq('id', activeBlock.id)
      finalPlayFee = completedBlocks.reduce((sum, b) => sum + calcBlockFee(b), 0)
        + calcBlockFee({ ...activeBlock, ended_at: now })
      if (pricingType === 'freetime') {
        const rate = getRate()
        finalPlayFee = rate?.freetime_price || 0
      }
    }

    const finalTotal = finalPlayFee + foodFee

    await supabase.from('sessions').update({
      ended_at: new Date().toISOString(),
      total_play_fee: finalPlayFee,
      total_food_fee: foodFee,
      grand_total: finalTotal,
      is_paid: true,
      member_id: memberId || null,
      customer_type: customerType,
      pricing_type: pricingType,
    }).eq('id', sessionId)

    const activeTableId = currentTableId || session?.table_id
    const { data: remaining } = await supabase
      .from('sessions')
      .select('id')
      .eq('table_id', activeTableId)
      .eq('is_paid', false)
      .neq('id', sessionId)

    if (!remaining || remaining.length === 0) {
      await supabase.from('tables').update({ status: 'empty' }).eq('id', activeTableId)
    }

    if (memberId) {
      const { data: m } = await supabase.from('members').select('visit_count, total_spent').eq('id', memberId).single()
      if (m) {
        await supabase.from('members').update({
          visit_count: (m.visit_count || 0) + 1,
          total_spent: (m.total_spent || 0) + finalTotal,
        }).eq('id', memberId)
      }
    }

    if (remaining && remaining.length > 0) {
      navigate(`/table/${activeTableId}`)
    } else {
      navigate('/')
    }
  }

  const drinks = menuItems.filter(m => m.category === 'drink')
  const foods = menuItems.filter(m => m.category === 'food')
  const backPath = currentTableId ? `/table/${currentTableId}` : session?.table_id ? `/table/${session.table_id}` : '/'

  const currentTable = tables.find(t => t.id === currentTableId)
  const tableLabel = currentTable
    ? (currentTable.table_number === 99 ? 'その他' : `#${currentTable.table_number}台`)
    : ''

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(backPath)} className="text-gray-500 hover:text-gray-700 text-sm">← 戻る</button>
        <h1 className="text-xl font-bold text-gray-800">
          {isNew ? '新規伝票' : `伝票`}
        </h1>
        {!isNew && tableLabel && (
          <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full">{tableLabel}</span>
        )}
        {!isNew && (
          <button
            onClick={() => setShowMoveModal(true)}
            className="ml-auto text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1 rounded-full transition-colors"
          >
            台を移動
          </button>
        )}
      </div>

      {/* 台移動モーダル */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowMoveModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-gray-800 mb-4">移動先の台を選択</h2>
            <div className="flex flex-col gap-2">
              {tables
                .filter(t => (t.table_number <= 5 || t.table_number === 99) && t.id !== currentTableId)
                .map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleMoveTable(t.id)}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border hover:bg-gray-50 text-left transition-colors"
                  >
                    <span className="font-medium">{t.table_number === 99 ? 'その他' : `#${t.table_number}台`}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'in_use' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {t.status === 'in_use' ? '使用中' : '空き'}
                    </span>
                  </button>
                ))}
            </div>
            <button onClick={() => setShowMoveModal(false)} className="mt-4 w-full text-gray-400 text-sm">キャンセル</button>
          </div>
        </div>
      )}


      {/* ── プレー設定（時間コントロールを含む） ── */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <h2 className="font-semibold text-gray-700 mb-3">プレー設定</h2>

        {/* 区分・種別 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">区分</label>
            <div className="flex gap-1">
              {['general', 'female', 'student'].map(t => (
                <button
                  key={t}
                  onClick={() => setCustomerType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    customerType === t ? 'bg-green-700 text-white border-green-700' : 'border-gray-300 text-gray-700'
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">種別</label>
            <div className="flex gap-1">
              {['hourly_multi', 'hourly_single', 'freetime'].map(v => (
                <button
                  key={v}
                  onClick={() => setPricingType(v)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border whitespace-nowrap ${
                    pricingType === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'
                  }`}
                >
                  {PRICING_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 料金表示 */}
        {getRate() && (
          <p className="text-sm text-gray-500 mb-3">
            {pricingType !== 'freetime'
              ? `${PRICING_LABEL[pricingType]}: ${((getRate().price_per_minute || 0) * 60).toLocaleString()}円/時`
              : `フリータイム: ${getRate().freetime_price?.toLocaleString()}円`}
          </p>
        )}

        {/* 時間ブロック（既存伝票 かつ 時間制の場合のみ） */}
        {!isNew && pricingType !== 'freetime' && (
          <div className="border-t pt-3 mt-1">
            {activeBlock ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <div className="text-sm">
                  <span className="font-semibold text-green-800">▶ プレー中</span>
                  <span className="text-gray-600 ml-3">{fmtTime(activeBlock.started_at)} 開始</span>
                  <span className="text-gray-500 ml-2">経過 {fmtElapsed(activeBlock.started_at, null)}</span>
                </div>
                <button
                  onClick={() => endTimeBlock(activeBlock.id)}
                  className="bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  ■ 終了
                </button>
              </div>
            ) : (
              <button
                onClick={startTimeBlock}
                className="w-full bg-green-700 hover:bg-green-600 text-white font-bold rounded-lg py-3 text-sm transition-colors"
              >
                ▶ ビリヤード開始
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── 会員（任意） ── */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <h2 className="font-semibold text-gray-700 mb-3">お客様情報（任意）</h2>
        {memberId ? (
          <div className="flex items-center gap-3">
            <span className="text-green-700 font-medium">✓ {memberName || '会員選択済み'}</span>
            <button onClick={() => { setMemberId(null); setMemberName(''); setMemberSearch('') }} className="text-sm text-gray-400">解除</button>
          </div>
        ) : !isNew && guestName ? (
          <div className="flex items-center gap-3">
            <span className="text-gray-700 font-medium">👤 {guestName}</span>
          </div>
        ) : (
          <div>
            {/* 非会員の名前入力 */}
            {isNew && (
              <div className="mb-3">
                <label className="text-sm text-gray-600 mb-1 block">お名前（非会員）</label>
                <input
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="例：田中さん"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}
            <div className="flex gap-2 mb-2">
              <input
                ref={barcodeRef}
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                onKeyDown={handleBarcodeInput}
                placeholder="会員検索（名前・会員番号・電話番号）"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={() => searchMember(memberSearch)} className="bg-gray-200 hover:bg-gray-300 px-3 rounded-lg text-sm">
                検索
              </button>
            </div>
            {memberError && <p className="text-sm text-red-500 mt-1">{memberError}</p>}
            {members.length > 0 && (
              <div className="border rounded-lg divide-y">
                {members.map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setMemberId(m.id)
                      setMemberName(m.name)
                      setMemberSearch('')
                      setCustomerType(m.customer_type)
                      setMembers([])
                      setMemberError('')
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-gray-400 ml-2">#{m.member_number}</span>
                    <span className="text-gray-400 ml-2">{TYPE_LABEL[m.customer_type]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 注文履歴（既存伝票のみ） ── */}
      {!isNew && history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <h2 className="font-semibold text-gray-700 mb-3">注文履歴</h2>
          <div className="flex flex-col gap-2">
            {history.map((item, i) => (
              <div key={`${item.id}-${i}`} className={`flex items-center justify-between text-sm ${item.cancelled ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400 text-xs shrink-0">{fmtTime(item.sortTime)}</span>
                  {item.type === 'block' ? (
                    <span className="text-gray-700">
                      🎱 {fmtTime(item.startTime)}〜{fmtTime(item.endTime)}
                      <span className="text-gray-400 ml-1">({fmtElapsed(item.startTime, item.endTime)})</span>
                    </span>
                  ) : (
                    <span className={`text-gray-700 ${item.cancelled ? 'line-through' : ''}`}>
                      🍹 {item.name} ×{item.quantity}
                    </span>
                  )}
                  {item.cancelled && (
                    <span className="text-xs text-red-400 font-medium">キャンセル</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {item.type === 'order' && !item.cancelled && item.dbId && (
                    <button
                      onClick={() => cancelOrderItem(item.dbId)}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-0.5 rounded transition-colors"
                    >
                      取消
                    </button>
                  )}
                  <span className={`font-medium w-16 text-right ${item.cancelled ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                    ¥{item.fee.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ドリンク・フード（既存伝票のみ） ── */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <h2 className="font-semibold text-gray-700 mb-3">ドリンク・フード</h2>
          {[['🍹 ドリンク', drinks], ['🍔 フード', foods]].map(([label, items]) =>
            items.length > 0 && (
              <div key={label} className="mb-3">
                <p className="text-sm text-gray-500 mb-2">{label}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => addMenuItem(item)}
                      className="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm transition-colors"
                    >
                      {item.name} <span className="text-gray-500">¥{item.price}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── 合計・会計（既存伝票のみ） ── */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>
              プレー料金
              {activeBlock && pricingType !== 'freetime' && (
                <span className="text-xs text-orange-500 ml-1">（進行中含む概算）</span>
              )}
            </span>
            <span>¥{playFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>ドリンク・フード</span>
            <span>¥{foodFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold text-lg border-t pt-2">
            <span>合計</span>
            <span>¥{grandTotal.toLocaleString()}</span>
          </div>

          {showPayment ? (
            <div className="mt-4">
              <label className="text-sm text-gray-600 mb-1 block">お預かり金額（現金）</label>
              <input
                type="number"
                value={paymentInput}
                onChange={e => setPaymentInput(e.target.value)}
                className="w-full border-2 border-blue-400 rounded-lg px-4 py-3 text-xl text-right font-bold"
                placeholder="0"
              />
              {payment > 0 && (
                <div className={`mt-2 text-right text-lg font-bold ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  お釣り: ¥{change.toLocaleString()}
                </div>
              )}
              <button
                onClick={handleCheckout}
                disabled={saving || payment < grandTotal}
                className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
              >
                {saving ? '処理中...' : '会計完了'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPayment(true)}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-4 text-lg transition-colors"
            >
              会計へ進む
            </button>
          )}
        </div>
      )}

      {/* ── 伝票作成ボタン（新規のみ） ── */}
      {isNew && (
        <button
          onClick={handleCreateSession}
          disabled={saving}
          className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
        >
          {saving ? '処理中...' : '伝票を作成'}
        </button>
      )}
    </div>
  )
}
