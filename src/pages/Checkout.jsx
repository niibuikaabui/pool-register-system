import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { isFreetime } from '../lib/constants'
import { roundUp50 } from '../lib/utils'
import TableMoveModal from '../components/TableMoveModal'
import MemberSection from '../components/checkout/MemberSection'
import PlaySettings from '../components/checkout/PlaySettings'
import MenuSection from '../components/checkout/MenuSection'
import OrderHistory from '../components/checkout/OrderHistory'
import CheckoutSection from '../components/checkout/CheckoutSection'

function toLocalDatetimeInput(isoStr) {
  const d = new Date(isoStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Checkout() {
  const { user } = useAuth()
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const tableId = searchParams.get('table')
  const navigate = useNavigate()

  // ── マスタデータ ──
  const [pricing, setPricing] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [tables, setTables] = useState([])
  const [members, setMembers] = useState([])

  // ── セッション・プレー設定 ──
  const [session, setSession] = useState(null)
  const [customerType, setCustomerType] = useState('general')
  const [pricingType, setPricingType] = useState('hourly_multi')
  const [timeBlocks, setTimeBlocks] = useState([])
  const [lockedBlockFees, setLockedBlockFees] = useState({})
  const [currentTableId, setCurrentTableId] = useState(tableId)

  // ── お客様情報 ──
  const [memberId, setMemberId] = useState(null)
  const [memberName, setMemberName] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [memberError, setMemberError] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestNameSaved, setGuestNameSaved] = useState(false)
  const [editingGuestName, setEditingGuestName] = useState(false)
  const [guestNameDraft, setGuestNameDraft] = useState('')

  // ── 注文 ──
  const [orderItems, setOrderItems] = useState([])
  const [menuSearch, setMenuSearch] = useState('')
  const [openCategories, setOpenCategories] = useState({})
  const [flashedItemId, setFlashedItemId] = useState(null)

  // ── UI状態 ──
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [showPayment, setShowPayment] = useState(false)
  const [paymentInput, setPaymentInput] = useState('')
  const [tick, setTick] = useState(0)

  // ── 時間ブロック編集フォーム ──
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [editStartDate, setEditStartDate] = useState('')
  const [editStartTime, setEditStartTime] = useState('')
  const [editEndDate, setEditEndDate] = useState('')
  const [editEndTime, setEditEndTime] = useState('')

  const barcodeRef = useRef(null)

  // 1分ごとに再描画（経過時間更新用）
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // 完了済みブロックの料金をロック（pricing_typeが変わっても再計算しない）
  useEffect(() => {
    if (!session || pricing.length === 0) return
    const origRate = pricing.find(p => p.customer_type === session.customer_type && p.pricing_type === session.pricing_type)
    setLockedBlockFees(prev => {
      const next = { ...prev }
      for (const b of timeBlocks.filter(b => b.ended_at)) {
        if (b.id in next) continue
        if (!isFreetime(session.pricing_type) && origRate) {
          const mins = Math.floor((new Date(b.ended_at) - new Date(b.started_at)) / 60000)
          next[b.id] = mins > 0 ? roundUp50((origRate.price_per_minute || 0) * mins) : 0
        } else {
          next[b.id] = null // freetimeはnullで区別
        }
      }
      return next
    })
  }, [session, pricing, timeBlocks])

  useEffect(() => {
    fetchMaster()
    loadSession()
    const channel = supabase
      .channel(`checkout-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_blocks', filter: `session_id=eq.${sessionId}` }, loadTimeBlocks)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [sessionId])

  // ─── データ取得 ───

  async function fetchMaster() {
    const [{ data: p }, { data: m }, { data: t }] = await Promise.all([
      supabase.from('pricing_master').select('*'),
      supabase.from('menu_items').select('*').eq('is_available', true).order('sort_order').order('id'),
      supabase.from('tables').select('*').order('table_number'),
    ])
    setPricing(p || [])
    setMenuItems(m || [])
    setTables(t || [])
  }

  async function loadSession() {
    const { data: s } = await supabase
      .from('sessions')
      .select('*, order_items(*, menu_items(name, category)), members(name)')
      .eq('id', sessionId)
      .single()
    if (s) {
      setSession(s)
      setCustomerType(s.customer_type)
      setPricingType(s.pricing_type)
      setMemberId(s.member_id)
      if (s.members?.name) setMemberName(s.members.name)
      setCurrentTableId(s.table_id)
      if (s.guest_name) { setGuestName(s.guest_name); setGuestNameSaved(true) }
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

  // ─── 料金計算 ───

  function getRate() {
    return pricing.find(p => p.customer_type === customerType && p.pricing_type === pricingType)
  }

  function calcBlockFee(block) {
    const rate = getRate()
    if (!rate || isFreetime(pricingType)) return 0
    const ended = block.ended_at ? new Date(block.ended_at) : new Date()
    const mins = Math.floor((ended - new Date(block.started_at)) / 60000)
    if (mins <= 0) return 0
    return roundUp50((rate.price_per_minute || 0) * mins)
  }

  // total_play_fee の計算（endTimeBlock・saveEditBlock で共用）
  function calcTotalPlayFeeFromBlocks(blocks, rate) {
    if (isFreetime(pricingType)) return rate.freetime_price || 0
    return blocks
      .filter(b => b.ended_at)
      .reduce((sum, b) => {
        const mins = Math.floor((new Date(b.ended_at) - new Date(b.started_at)) / 60000)
        if (mins <= 0) return sum
        return sum + roundUp50((rate.price_per_minute || 0) * mins)
      }, 0)
  }

  // tick を参照して毎分再計算されるようにする
  // eslint-disable-next-line no-unused-vars
  const _tick = tick

  const activeBlock = timeBlocks.find(b => !b.ended_at)
  const completedBlocks = timeBlocks.filter(b => b.ended_at)

  function calcPlayFee() {
    const rate = getRate()
    if (!rate) return 0
    if (isFreetime(pricingType)) return rate.freetime_price || 0
    // 完了ブロックはロック済み料金を使用（種別変更・時間修正後も正確に反映）
    const completedFee = completedBlocks.reduce((sum, b) => {
      return sum + (b.id in lockedBlockFees ? (lockedBlockFees[b.id] ?? 0) : calcBlockFee(b))
    }, 0)
    return completedFee + (activeBlock ? calcBlockFee(activeBlock) : 0)
  }

  function calcFoodFee() {
    return orderItems.filter(i => !i.cancelled_at).reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  }

  const playFee = calcPlayFee()
  const foodFee = calcFoodFee()
  const grandTotal = playFee + foodFee
  const payment = parseInt(paymentInput) || 0
  const change = payment - grandTotal

  // 注文履歴：全時間ブロック（進行中含む）+ ドリンク注文を時刻順で並べる
  const history = [
    ...completedBlocks.map(b => {
      const locked = b.id in lockedBlockFees
      const fee = locked ? (lockedBlockFees[b.id] ?? 0) : calcBlockFee(b)
      const isLockedFreetime = locked && lockedBlockFees[b.id] === null
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
    ...orderItems.map(o => ({
      type: 'order',
      sortTime: new Date(o._addedAt || Date.now()),
      id: o.id || `${o.menu_item_id}-${o._addedAt}`,
      dbId: o.id,
      name: o.menu_items?.name,
      category: o.menu_items?.category,
      quantity: o.quantity,
      fee: o.unit_price * o.quantity,
      cancelled: !!o.cancelled_at,
    })),
  ].sort((a, b) => a.sortTime - b.sortTime)

  // ─── お客様情報ハンドラ ───

  async function handleMemberRemove() {
    setMemberId(null)
    setMemberName('')
    setMemberSearch('')
    await supabase.from('sessions').update({ member_id: null }).eq('id', sessionId)
  }

  async function handleMemberSelect(m) {
    setMemberId(m.id)
    setMemberName(m.name)
    setMemberSearch('')
    setCustomerType(m.customer_type)
    setMembers([])
    setMemberError('')
    await supabase.from('sessions').update({ member_id: m.id, customer_type: m.customer_type }).eq('id', sessionId)
  }

  async function handleGuestNameSave() {
    setGuestName(guestNameDraft)
    setGuestNameSaved(true)
    setEditingGuestName(false)
    await supabase.from('sessions').update({ guest_name: guestNameDraft.trim() || null }).eq('id', sessionId)
  }

  async function handleGuestNameBlur(e) {
    const name = e.target.value.trim()
    if (name) setGuestNameSaved(true)
    await supabase.from('sessions').update({ guest_name: name || null }).eq('id', sessionId)
  }

  // ─── プレー設定ハンドラ ───

  async function handleCustomerTypeChange(t) {
    const newPricingType = (t === 'high_school' || t === 'staff') && isFreetime(pricingType) ? 'hourly_multi' : pricingType
    setCustomerType(t)
    setPricingType(newPricingType)
    await supabase.from('sessions').update({ customer_type: t, pricing_type: newPricingType }).eq('id', sessionId)
  }

  async function handlePricingTypeChange(v) {
    setPricingType(v)
    await supabase.from('sessions').update({ pricing_type: v }).eq('id', sessionId)
  }

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

      // プレー終了時に total_play_fee を sessions に保存（伝票一覧の合計額に反映するため）
      const rate = getRate()
      if (rate) {
        const totalPlayFee = calcTotalPlayFeeFromBlocks(updatedBlocks, rate)
        await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
      }

      // 終了時の料金をロック（以降の種別変更で再計算されないように）
      const endedMins = Math.floor((new Date(data.ended_at) - new Date(data.started_at)) / 60000)
      const endedFee = !isFreetime(pricingType) && rate && endedMins > 0
        ? roundUp50((rate.price_per_minute || 0) * endedMins)
        : 0
      setLockedBlockFees(prev => ({ ...prev, [blockId]: isFreetime(pricingType) ? null : endedFee }))
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

    // 時間修正後に total_play_fee を再計算してsessionsに保存（伝票一覧の合計額に反映するため）
    const rate = getRate()
    if (rate) {
      const totalPlayFee = calcTotalPlayFeeFromBlocks(updatedBlocks, rate)
      await supabase.from('sessions').update({ total_play_fee: totalPlayFee }).eq('id', sessionId)
    }

    // 時間修正後にlockedBlockFeesも更新（修正後の時間で再ロック）
    if (block.ended_at && rate) {
      const editedEnd = update.ended_at || block.ended_at
      const mins = Math.floor((new Date(editedEnd) - new Date(newStart)) / 60000)
      const fee = !isFreetime(pricingType) && mins > 0 ? roundUp50((rate.price_per_minute || 0) * mins) : 0
      setLockedBlockFees(prev => ({ ...prev, [block.id]: isFreetime(pricingType) ? null : fee }))
    }
  }

  // ─── ドリンク・フード ───

  async function addMenuItem(item) {
    const now = new Date().toISOString()
    const { data } = await supabase.from('order_items').insert({
      session_id: sessionId,
      menu_item_id: item.id,
      quantity: 1,
      unit_price: item.price,
    }).select('*, menu_items(name)').single()
    if (data) {
      setOrderItems(prev => [...prev, { ...data, _addedAt: now }])
      setFlashedItemId(item.id)
      setTimeout(() => setFlashedItemId(null), 600)
    }
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
    await supabase.from('sessions').update({ table_id: newTableId }).eq('id', sessionId)
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', newTableId)
    const { data: remaining } = await supabase
      .from('sessions').select('id')
      .eq('table_id', oldTableId).eq('is_paid', false).neq('id', sessionId)
    if (!remaining || remaining.length === 0) {
      await supabase.from('tables').update({ status: 'empty' }).eq('id', oldTableId)
    }
    setCurrentTableId(newTableId)
    setShowMoveModal(false)
  }

  // ─── 会計完了 ───

  function handleCheckoutStart() {
    if (activeBlock) {
      setCheckoutError('プレーが終了していません。先にプレーを終了させてください。')
      return
    }
    setCheckoutError('')
    setShowPayment(true)
  }

  async function handleCheckout() {
    setSaving(true)

    let finalPlayFee = playFee

    // 進行中のブロックを自動終了
    if (activeBlock) {
      const now = new Date().toISOString()
      await supabase.from('time_blocks').update({ ended_at: now }).eq('id', activeBlock.id)
      finalPlayFee = completedBlocks.reduce((sum, b) => sum + calcBlockFee(b), 0)
        + calcBlockFee({ ...activeBlock, ended_at: now })
      if (isFreetime(pricingType)) {
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
      checked_by: user?.id || null,
    }).eq('id', sessionId)

    const activeTableId = currentTableId || session?.table_id
    const { data: remaining } = await supabase
      .from('sessions')
      .select('id')
      .eq('table_id', activeTableId)
      .eq('is_paid', false)
      .neq('id', sessionId)

    if (!remaining || remaining.length === 0) {
      await supabase.from('tables').update({ status: 'empty', note: null }).eq('id', activeTableId)
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

  // ─── 表示用の派生データ ───

  const filteredMenuItems = menuSearch.trim()
    ? menuItems.filter(m => m.name.toLowerCase().includes(menuSearch.trim().toLowerCase()))
    : menuItems
  const drinks = filteredMenuItems.filter(m => m.category === 'drink')
  const alcohols = filteredMenuItems.filter(m => m.category === 'alcohol')
  const foods = filteredMenuItems.filter(m => m.category === 'food')
  const discounts = filteredMenuItems.filter(m => m.category === 'discount')
  const backPath = currentTableId ? `/table/${currentTableId}` : session?.table_id ? `/table/${session.table_id}` : '/'

  const currentTable = tables.find(t => t.id === currentTableId)
  const tableLabel = currentTable
    ? (currentTable.table_number === 99 ? 'その他' : `#${currentTable.table_number}台`)
    : ''

  // ─── レンダリング ───

  return (
    <div className="max-w-2xl mx-auto">

      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(backPath)} className="text-gray-500 hover:text-gray-700 text-sm">← 戻る</button>
        <h1 className="text-xl font-bold text-gray-800">伝票</h1>
        {tableLabel && (
          <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full">{tableLabel}</span>
        )}
        <button
          onClick={() => setShowMoveModal(true)}
          className="ml-auto text-xs text-white bg-green-700 hover:bg-green-600 px-3 py-1 rounded-lg transition-colors"
        >
          台を移動
        </button>
      </div>

      {showMoveModal && (
        <TableMoveModal
          tables={tables}
          currentTableId={currentTableId}
          onMove={handleMoveTable}
          onClose={() => setShowMoveModal(false)}
        />
      )}

      <MemberSection
        memberId={memberId}
        memberName={memberName}
        memberSearch={memberSearch}
        setMemberSearch={setMemberSearch}
        members={members}
        memberError={memberError}
        guestName={guestName}
        setGuestName={setGuestName}
        guestNameSaved={guestNameSaved}
        editingGuestName={editingGuestName}
        setEditingGuestName={setEditingGuestName}
        guestNameDraft={guestNameDraft}
        setGuestNameDraft={setGuestNameDraft}
        barcodeRef={barcodeRef}
        onMemberSelect={handleMemberSelect}
        onMemberRemove={handleMemberRemove}
        onGuestNameSave={handleGuestNameSave}
        onGuestNameBlur={handleGuestNameBlur}
        onBarcodeInput={handleBarcodeInput}
        onSearch={searchMember}
      />

      <PlaySettings
        customerType={customerType}
        pricingType={pricingType}
        activeBlock={activeBlock}
        editingBlockId={editingBlockId}
        rate={getRate()}
        editStartDate={editStartDate}
        setEditStartDate={setEditStartDate}
        editStartTime={editStartTime}
        setEditStartTime={setEditStartTime}
        onCustomerTypeChange={handleCustomerTypeChange}
        onPricingTypeChange={handlePricingTypeChange}
        onStartBlock={startTimeBlock}
        onEndBlock={endTimeBlock}
        onOpenEdit={openEditBlock}
        onSaveEdit={saveEditBlock}
        onCancelEdit={() => setEditingBlockId(null)}
      />

      <MenuSection
        drinks={drinks}
        alcohols={alcohols}
        foods={foods}
        discounts={discounts}
        grandTotal={grandTotal}
        menuSearch={menuSearch}
        setMenuSearch={setMenuSearch}
        openCategories={openCategories}
        setOpenCategories={setOpenCategories}
        flashedItemId={flashedItemId}
        onAddItem={addMenuItem}
      />

      <OrderHistory
        history={history}
        pricingType={pricingType}
        editingBlockId={editingBlockId}
        editStartDate={editStartDate}
        setEditStartDate={setEditStartDate}
        editStartTime={editStartTime}
        setEditStartTime={setEditStartTime}
        editEndDate={editEndDate}
        setEditEndDate={setEditEndDate}
        editEndTime={editEndTime}
        setEditEndTime={setEditEndTime}
        onEditBlock={openEditBlock}
        onCancelOrder={cancelOrderItem}
        onSaveEdit={saveEditBlock}
        onCancelEdit={() => setEditingBlockId(null)}
      />

      <CheckoutSection
        grandTotal={grandTotal}
        showPayment={showPayment}
        paymentInput={paymentInput}
        setPaymentInput={setPaymentInput}
        saving={saving}
        checkoutError={checkoutError}
        change={change}
        onCheckoutStart={handleCheckoutStart}
        onCheckout={handleCheckout}
      />

    </div>
  )
}
