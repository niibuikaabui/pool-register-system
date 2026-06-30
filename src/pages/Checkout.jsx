import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { isFreetime } from '../lib/constants'
import { useMemberSearch } from '../hooks/useMemberSearch'
import { useTimeBlocks } from '../hooks/useTimeBlocks'
import TableMoveModal from '../components/TableMoveModal'
import MemberSection from '../components/checkout/MemberSection'
import PlaySettings from '../components/checkout/PlaySettings'
import MenuSection from '../components/checkout/MenuSection'
import OrderHistory from '../components/checkout/OrderHistory'
import CheckoutSection from '../components/checkout/CheckoutSection'

export default function Checkout() {
  const { user } = useAuth()
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const tableId = searchParams.get('table')
  const navigate = useNavigate()

  // ── セッション・マスタ・注文 ──
  const [session, setSession] = useState(null)
  const [customerType, setCustomerType] = useState('general')
  const [pricingType, setPricingType] = useState('hourly_multi')
  const [pricing, setPricing] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [tables, setTables] = useState([])
  const [orderItems, setOrderItems] = useState([])
  const [currentTableId, setCurrentTableId] = useState(tableId)

  // ── UI状態 ──
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [showPayment, setShowPayment] = useState(false)
  const [paymentInput, setPaymentInput] = useState('')

  // ── メニュー検索 ──
  const [menuSearch, setMenuSearch] = useState('')
  const [openCategories, setOpenCategories] = useState({})
  const [flashedItemId, setFlashedItemId] = useState(null)

  // ── カスタムフック ──
  const member = useMemberSearch(sessionId, { onCustomerTypeChange: setCustomerType })
  const rate = pricing.find(p => p.customer_type === customerType && p.pricing_type === pricingType)
  const tb = useTimeBlocks(sessionId, pricingType, rate)

  // ─── データ取得 ───

  useEffect(() => {
    fetchMaster()
    loadSession()
  }, [sessionId])

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
      setCurrentTableId(s.table_id)
      setOrderItems((s.order_items || []).map(o => ({ ...o, _addedAt: o.created_at || new Date().toISOString() })))
      member.initFromSession(s)
    }
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
    if (tb.activeBlock) {
      setCheckoutError('プレーが終了していません。先にプレーを終了させてください。')
      return
    }
    setCheckoutError('')
    setShowPayment(true)
  }

  async function handleCheckout() {
    setSaving(true)

    let finalPlayFee = tb.playFee

    // 進行中のブロックを自動終了
    if (tb.activeBlock) {
      const now = new Date().toISOString()
      await supabase.from('time_blocks').update({ ended_at: now }).eq('id', tb.activeBlock.id)
      finalPlayFee = tb.completedBlocks.reduce((sum, b) => sum + tb.calcBlockFee(b), 0)
        + tb.calcBlockFee({ ...tb.activeBlock, ended_at: now })
      if (isFreetime(pricingType)) {
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
      member_id: member.memberId || null,
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

    if (member.memberId) {
      const { data: m } = await supabase.from('members').select('visit_count, total_spent').eq('id', member.memberId).single()
      if (m) {
        await supabase.from('members').update({
          visit_count: (m.visit_count || 0) + 1,
          total_spent: (m.total_spent || 0) + finalTotal,
        }).eq('id', member.memberId)
      }
    }

    if (remaining && remaining.length > 0) {
      navigate(`/table/${activeTableId}`)
    } else {
      navigate('/')
    }
  }

  // ─── 派生データ ───

  const foodFee = orderItems.filter(i => !i.cancelled_at).reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  const grandTotal = tb.playFee + foodFee
  const change = (parseInt(paymentInput) || 0) - grandTotal

  const history = [
    ...tb.blockHistory,
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

  const filteredMenuItems = menuSearch.trim()
    ? menuItems.filter(m => m.name.toLowerCase().includes(menuSearch.trim().toLowerCase()))
    : menuItems
  const drinks    = filteredMenuItems.filter(m => m.category === 'drink')
  const alcohols  = filteredMenuItems.filter(m => m.category === 'alcohol')
  const foods     = filteredMenuItems.filter(m => m.category === 'food')
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
        memberId={member.memberId}
        memberName={member.memberName}
        memberSearch={member.memberSearch}
        setMemberSearch={member.setMemberSearch}
        members={member.members}
        memberError={member.memberError}
        guestName={member.guestName}
        setGuestName={member.setGuestName}
        guestNameSaved={member.guestNameSaved}
        editingGuestName={member.editingGuestName}
        setEditingGuestName={member.setEditingGuestName}
        guestNameDraft={member.guestNameDraft}
        setGuestNameDraft={member.setGuestNameDraft}
        barcodeRef={member.barcodeRef}
        onMemberSelect={member.handleMemberSelect}
        onMemberRemove={member.handleMemberRemove}
        onGuestNameSave={member.handleGuestNameSave}
        onGuestNameBlur={member.handleGuestNameBlur}
        onBarcodeInput={member.handleBarcodeInput}
        onSearch={member.onSearch}
      />

      <PlaySettings
        customerType={customerType}
        pricingType={pricingType}
        activeBlock={tb.activeBlock}
        editingBlockId={tb.editingBlockId}
        rate={rate}
        editStartDate={tb.editStartDate}
        setEditStartDate={tb.setEditStartDate}
        editStartTime={tb.editStartTime}
        setEditStartTime={tb.setEditStartTime}
        onCustomerTypeChange={handleCustomerTypeChange}
        onPricingTypeChange={handlePricingTypeChange}
        onStartBlock={tb.startTimeBlock}
        onEndBlock={tb.endTimeBlock}
        onOpenEdit={tb.openEditBlock}
        onSaveEdit={tb.saveEditBlock}
        onCancelEdit={tb.cancelEdit}
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
        editingBlockId={tb.editingBlockId}
        editStartDate={tb.editStartDate}
        setEditStartDate={tb.setEditStartDate}
        editStartTime={tb.editStartTime}
        setEditStartTime={tb.setEditStartTime}
        editEndDate={tb.editEndDate}
        setEditEndDate={tb.setEditEndDate}
        editEndTime={tb.editEndTime}
        setEditEndTime={tb.setEditEndTime}
        onEditBlock={tb.openEditBlock}
        onCancelOrder={cancelOrderItem}
        onSaveEdit={tb.saveEditBlock}
        onCancelEdit={tb.cancelEdit}
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
