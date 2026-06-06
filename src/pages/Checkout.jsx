import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TYPE_LABEL = { general: '一般', female: '女性', student: '学生' }

function roundUp50(n) {
  return Math.ceil(n / 50) * 50
}

function toLocalDatetimeStr(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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

  // Session state
  const [customerType, setCustomerType] = useState('general')
  const [pricingType, setPricingType] = useState('hourly_multi')
  const [startedAt, setStartedAt] = useState(toLocalDatetimeStr(new Date()))
  const [endedAt, setEndedAt] = useState('')
  const [memberId, setMemberId] = useState(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberError, setMemberError] = useState('')
  const [orderItems, setOrderItems] = useState([])
  const [session, setSession] = useState(null)
  const [saving, setSaving] = useState(false)
  const [paymentInput, setPaymentInput] = useState('')
  const [showPayment, setShowPayment] = useState(false)
  const barcodeRef = useRef(null)

  useEffect(() => {
    fetchMaster()
    if (!isNew) loadSession()
  }, [sessionId])

  async function fetchMaster() {
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('pricing_master').select('*'),
      supabase.from('menu_items').select('*').eq('is_available', true).order('category'),
    ])
    setPricing(p || [])
    setMenuItems(m || [])
  }

  async function loadSession() {
    const { data: s } = await supabase
      .from('sessions')
      .select('*, order_items(*, menu_items(name))')
      .eq('id', sessionId)
      .single()
    if (s) {
      setSession(s)
      setCustomerType(s.customer_type)
      setPricingType(s.pricing_type)
      setStartedAt(toLocalDatetimeStr(new Date(s.started_at)))
      if (s.ended_at) setEndedAt(toLocalDatetimeStr(new Date(s.ended_at)))
      setMemberId(s.member_id)
      setOrderItems(s.order_items || [])
    }
  }

  function getRate() {
    return pricing.find(p => p.customer_type === customerType && p.pricing_type === pricingType)
  }

  function calcPlayFee() {
    const rate = getRate()
    if (!rate) return 0
    if (pricingType === 'freetime') return rate.freetime_price || 0
    if (!endedAt) return 0
    const mins = Math.floor((new Date(endedAt) - new Date(startedAt)) / 60000)
    if (mins <= 0) return 0
    return roundUp50((rate.price_per_minute || 0) * mins)
  }

  const PRICING_LABEL = { hourly_multi: '時間制（複数）', hourly_single: '時間制（一人）', freetime: 'フリータイム' }

  function calcFoodFee() {
    return orderItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  }

  const playFee = calcPlayFee()
  const foodFee = calcFoodFee()
  const grandTotal = playFee + foodFee
  const payment = parseInt(paymentInput) || 0
  const change = payment - grandTotal

  function addMenuItem(item) {
    setOrderItems(prev => {
      const existing = prev.find(o => o.menu_item_id === item.id)
      if (existing) {
        return prev.map(o => o.menu_item_id === item.id ? { ...o, quantity: o.quantity + 1 } : o)
      }
      return [...prev, { menu_item_id: item.id, unit_price: item.price, quantity: 1, menu_items: { name: item.name } }]
    })
  }

  function removeMenuItem(menuItemId) {
    setOrderItems(prev => prev
      .map(o => o.menu_item_id === menuItemId ? { ...o, quantity: o.quantity - 1 } : o)
      .filter(o => o.quantity > 0)
    )
  }

  // 入力変化のたびにデバウンス検索（300ms）
  useEffect(() => {
    if (!memberSearch) { setMembers([]); setMemberError(''); return }
    const t = setTimeout(() => searchMember(memberSearch), 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  async function searchMember(query) {
    if (!query) { setMembers([]); return }
    setMemberError('')
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(`name.ilike.%${query}%,member_number.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(5)
    if (error) { setMemberError('検索エラー: ' + error.message); return }
    setMembers(data || [])
    if (data?.length === 0) setMemberError('該当する会員が見つかりません')
  }

  // Barcode reader: Enterでも即検索
  function handleBarcodeInput(e) {
    if (e.key === 'Enter') searchMember(memberSearch)
  }

  async function handleStartSession() {
    setSaving(true)
    const { data, error } = await supabase.from('sessions').insert({
      table_id: tableId,
      member_id: memberId || null,
      customer_type: customerType,
      pricing_type: pricingType,
      started_at: new Date(startedAt).toISOString(),
      is_paid: false,
    }).select().single()
    if (error) {
      alert('セッション開始エラー: ' + error.message)
      setSaving(false)
      return
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tableId)
    navigate(`/checkout/${data.id}`, { replace: true })
    setSaving(false)
  }

  async function handleCheckout() {
    setSaving(true)
    const ended = endedAt ? new Date(endedAt).toISOString() : new Date().toISOString()

    // Upsert order items
    if (orderItems.length > 0) {
      const toInsert = orderItems
        .filter(o => !o.id)
        .map(o => ({ session_id: sessionId, menu_item_id: o.menu_item_id, quantity: o.quantity, unit_price: o.unit_price }))
      if (toInsert.length > 0) await supabase.from('order_items').insert(toInsert)

      for (const o of orderItems.filter(o => o.id)) {
        await supabase.from('order_items').update({ quantity: o.quantity }).eq('id', o.id)
      }
    }

    await supabase.from('sessions').update({
      ended_at: ended,
      total_play_fee: playFee,
      total_food_fee: foodFee,
      grand_total: grandTotal,
      is_paid: true,
      member_id: memberId || null,
      customer_type: customerType,
      pricing_type: pricingType,
    }).eq('id', sessionId)

    await supabase.from('tables').update({ status: 'empty' }).eq('id', tableId || session?.table_id)

    // Update member stats
    if (memberId) {
      const { data: m } = await supabase.from('members').select('visit_count, total_spent').eq('id', memberId).single()
      if (m) {
        await supabase.from('members').update({
          visit_count: (m.visit_count || 0) + 1,
          total_spent: (m.total_spent || 0) + grandTotal,
        }).eq('id', memberId)
      }
    }

    navigate('/')
  }

  const drinks = menuItems.filter(m => m.category === 'drink')
  const foods = menuItems.filter(m => m.category === 'food')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 戻る</button>
        <h1 className="text-xl font-bold text-gray-800">
          {isNew ? '新規セッション開始' : '会計'}
        </h1>
      </div>

      {/* Customer type & pricing */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <h2 className="font-semibold text-gray-700 mb-3">プレー設定</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">区分</label>
            <div className="flex gap-2">
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
            <div className="flex gap-2">
              <div className="flex gap-2">
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
        </div>

        {/* Rate display */}
        {getRate() && (
          <div className="mt-2 text-sm text-gray-500">
            {pricingType === 'hourly'
              ? `${PRICING_LABEL[pricingType]}: ${((getRate().price_per_minute || 0) * 60).toLocaleString()}円/時`
              : `フリータイム: ${getRate().freetime_price?.toLocaleString()}円`}
          </div>
        )}
      </div>

      {/* Time */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <h2 className="font-semibold text-gray-700 mb-3">時間</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">開始</label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => setStartedAt(toLocalDatetimeStr(new Date()))}
                className="bg-gray-200 hover:bg-gray-300 px-3 rounded-lg text-sm"
              >
                今
              </button>
            </div>
          </div>
          {!isNew && pricingType !== 'freetime' && (
            <div>
              <label className="text-sm text-gray-600 mb-1 block">終了</label>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={endedAt}
                  onChange={e => setEndedAt(e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setEndedAt(toLocalDatetimeStr(new Date()))}
                  className="bg-gray-200 hover:bg-gray-300 px-3 rounded-lg text-sm"
                >
                  今
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Member */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <h2 className="font-semibold text-gray-700 mb-3">会員（任意）</h2>
        {memberId ? (
          <div className="flex items-center gap-3">
            <span className="text-green-700 font-medium">
              ✓ {members.find(m => m.id === memberId)?.name || '会員選択済み'}
            </span>
            <button onClick={() => { setMemberId(null); setMemberSearch('') }} className="text-sm text-gray-400">解除</button>
          </div>
        ) : (
          <div>
            <div className="flex gap-2 mb-2">
              <input
                ref={barcodeRef}
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                onKeyDown={handleBarcodeInput}
                placeholder="名前・会員番号・電話番号で検索（バーコードも可）"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => searchMember(memberSearch)}
                className="bg-gray-200 hover:bg-gray-300 px-3 rounded-lg text-sm"
              >
                検索
              </button>
            </div>
            {memberError && (
              <p className="text-sm text-red-500 mt-1">{memberError}</p>
            )}
            {members.length > 0 && (
              <div className="border rounded-lg divide-y">
                {members.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setMemberId(m.id); setMemberSearch(''); setCustomerType(m.customer_type); setMembers([]); setMemberError('') }}
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

      {/* Menu items (only when session exists) */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <h2 className="font-semibold text-gray-700 mb-3">ドリンク・フード</h2>

          {[['🍹 ドリンク', drinks], ['🍔 フード', foods]].map(([label, items]) => (
            items.length > 0 && (
              <div key={label} className="mb-3">
                <p className="text-sm text-gray-500 mb-2">{label}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => addMenuItem(item)}
                      className="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm"
                    >
                      {item.name} <span className="text-gray-500">¥{item.price}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}

          {orderItems.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-sm font-medium text-gray-600 mb-2">注文内容</p>
              <div className="flex flex-col gap-1">
                {orderItems.map(o => (
                  <div key={o.menu_item_id} className="flex items-center justify-between text-sm">
                    <span>{o.menu_items?.name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeMenuItem(o.menu_item_id)} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-xs">−</button>
                      <span>{o.quantity}</span>
                      <button onClick={() => addMenuItem({ id: o.menu_item_id, price: o.unit_price, name: o.menu_items?.name })} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-xs">+</button>
                      <span className="text-gray-500 w-20 text-right">¥{(o.unit_price * o.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Total */}
      {!isNew && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>プレー料金</span>
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

          {/* Payment */}
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

      {/* Start button */}
      {isNew && (
        <button
          onClick={handleStartSession}
          disabled={saving}
          className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
        >
          {saving ? '処理中...' : 'プレー開始'}
        </button>
      )}
    </div>
  )
}
