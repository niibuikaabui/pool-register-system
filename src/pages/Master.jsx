import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { TYPE_LABEL, PRICING_LABEL, CATEGORY_ICON, CATEGORY_LABEL } from '../lib/constants'

const EMPTY_USER_FORM = { name: '', email: '', password: '', role: 'staff' }
const EMPTY_PRICING_FORM = { customer_type: 'general', pricing_type: 'hourly_multi', price_per_hour: '', freetime_price: '' }

// ── ドラッグ可能リスト ──────────────────────────────────────────
function SortableList({ items, onReorder, renderItem }) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const dragItem = useRef(null)

  function handleDragStart(e, id) {
    dragItem.current = id
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, id) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== draggingId) setOverId(id)
  }

  function handleDrop(e, targetId) {
    e.preventDefault()
    if (!dragItem.current || dragItem.current === targetId) return
    const from = items.findIndex(i => i.id === dragItem.current)
    const to = items.findIndex(i => i.id === targetId)
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder(next)
    setDraggingId(null)
    setOverId(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setOverId(null)
  }

  return (
    <div className="divide-y">
      {items.map(item => (
        <div
          key={item.id}
          draggable
          onDragStart={e => handleDragStart(e, item.id)}
          onDragOver={e => handleDragOver(e, item.id)}
          onDrop={e => handleDrop(e, item.id)}
          onDragEnd={handleDragEnd}
          className={`flex items-center gap-3 px-4 py-3 transition-colors
            ${draggingId === item.id ? 'opacity-40' : ''}
            ${overId === item.id ? 'bg-blue-50 border-t-2 border-blue-400' : 'hover:bg-gray-50'}
          `}
        >
          <span className="text-gray-300 cursor-grab active:cursor-grabbing select-none text-lg">⠿</span>
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

function useFlashMsg() {
  const [msg, setMsg] = useState('')
  const flash = (text) => {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }
  return [msg, flash]
}

export default function Master() {
  const [pricing, setPricing] = useState([])
  const [menus, setMenus] = useState([])
  const [settings, setSettings] = useState(null)
  const [activeTab, setActiveTab] = useState('pricing')
  const [saving, setSaving] = useState(false)
  const [msg, flash] = useFlashMsg()
  const [showMenuForm, setShowMenuForm] = useState(false)
  const [menuForm, setMenuForm] = useState({ name: '', category: 'drink', price: '' })
  const [editMenuId, setEditMenuId] = useState(null)
  const [bulkEditMode, setBulkEditMode] = useState(false)
  const [bulkDraft, setBulkDraft] = useState([])

  const [showPricingForm, setShowPricingForm] = useState(false)
  const [pricingForm, setPricingForm] = useState(EMPTY_PRICING_FORM)
  const [editPricingId, setEditPricingId] = useState(null)

  const [users, setUsers] = useState([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM)
  const [editUserId, setEditUserId] = useState(null)
  const [userError, setUserError] = useState('')
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: p }, { data: m }, { data: s }, { data: u }] = await Promise.all([
      supabase.from('pricing_master').select('*').order('sort_order').order('id'),
      supabase.from('menu_items').select('*').order('sort_order').order('id'),
      supabase.from('shop_settings').select('*').limit(1).single(),
      supabase.from('user_profiles').select('*').order('name'),
    ])
    setPricing((p || []).map(row => ({ ...row, price_per_hour: row.price_per_minute != null ? row.price_per_minute * 60 : null })))
    setMenus(m || [])
    setSettings(s || { business_start_time: '10:00', business_end_time: '03:00' })
    setUsers(u || [])
  }

  // ── 並び替え保存 ────────────────────────────────────────────
  async function reorderPricing(next) {
    setPricing(next)
    await Promise.all(next.map((row, i) =>
      supabase.from('pricing_master').update({ sort_order: i + 1 }).eq('id', row.id)
    ))
  }

  async function reorderMenus(next) {
    setMenus(next)
    await Promise.all(next.map((row, i) =>
      supabase.from('menu_items').update({ sort_order: i + 1 }).eq('id', row.id)
    ))
  }

  // ── 料金設定 CRUD ───────────────────────────────────────────
  function startEditPricing(row) {
    setPricingForm({ customer_type: row.customer_type, pricing_type: row.pricing_type, price_per_hour: row.price_per_hour ?? '', freetime_price: row.freetime_price ?? '' })
    setEditPricingId(row.id)
    setShowPricingForm(true)
  }

  function startAddPricing() {
    setPricingForm(EMPTY_PRICING_FORM)
    setEditPricingId(null)
    setShowPricingForm(true)
  }

  async function savePricingForm() {
    setSaving(true)
    const price_per_hour = pricingForm.price_per_hour !== '' ? Number(pricingForm.price_per_hour) : null
    const freetime_price = pricingForm.freetime_price !== '' ? Number(pricingForm.freetime_price) : null
    const payload = { customer_type: pricingForm.customer_type, pricing_type: pricingForm.pricing_type, price_per_minute: price_per_hour != null ? price_per_hour / 60 : null, freetime_price }
    if (editPricingId) {
      const { error } = await supabase.from('pricing_master').update(payload).eq('id', editPricingId)
      if (error) { alert('更新エラー: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('pricing_master').insert({ ...payload, sort_order: pricing.length + 1 })
      if (error) { alert('登録エラー: ' + error.message); setSaving(false); return }
    }
    setShowPricingForm(false)
    setEditPricingId(null)
    setSaving(false)
    flash(editPricingId ? '料金設定を更新しました' : '料金設定を追加しました')
    fetchAll()
  }

  async function deletePricing(id) {
    if (!confirm('この料金設定を削除しますか？')) return
    await supabase.from('pricing_master').delete().eq('id', id)
    fetchAll()
  }

  // ── メニュー CRUD ───────────────────────────────────────────
  async function toggleMenuAvailable(id, current) {
    await supabase.from('menu_items').update({ is_available: !current }).eq('id', id)
    fetchAll()
  }

  function startBulkEdit() {
    setBulkDraft(menus.map(m => ({ ...m, price: String(m.price) })))
    setBulkEditMode(true)
  }

  function cancelBulkEdit() {
    setBulkEditMode(false)
    setBulkDraft([])
  }

  function addBulkRow() {
    setBulkDraft(d => [...d, { id: null, _tmpId: Date.now(), name: '', category: 'drink', price: '' }])
  }

  async function saveBulkEdit() {
    setSaving(true)
    const existing = bulkDraft.filter(d => d.id !== null)
    const newRows = bulkDraft.filter(d => d.id === null && d.name.trim() && d.price !== '')

    const updates = existing.filter(draft => {
      const orig = menus.find(m => m.id === draft.id)
      return orig && (orig.name !== draft.name || orig.category !== draft.category || String(orig.price) !== draft.price)
    })

    const results = await Promise.all([
      ...updates.map(draft =>
        supabase.from('menu_items').update({
          name: draft.name,
          category: draft.category,
          price: Number(draft.price),
        }).eq('id', draft.id)
      ),
      ...newRows.map(draft =>
        supabase.from('menu_items').insert({
          name: draft.name.trim(),
          category: draft.category,
          price: Number(draft.price),
          is_available: true,
        })
      ),
    ])

    const errors = results.map(r => r.error).filter(Boolean)
    if (errors.length > 0) {
      alert('保存エラー: ' + errors.map(e => e.message).join('\n'))
      setSaving(false)
      return
    }

    setBulkEditMode(false)
    setBulkDraft([])
    setSaving(false)
    flash(`更新 ${updates.length}件・追加 ${newRows.length}件`)
    await fetchAll()
  }

  function startAddMenu() {
    setMenuForm({ name: '', category: 'drink', price: '' })
    setEditMenuId(null)
    setShowMenuForm(true)
  }

  function startEditMenu(item) {
    setMenuForm({ name: item.name, category: item.category, price: String(item.price) })
    setEditMenuId(item.id)
    setShowMenuForm(true)
  }

  async function saveMenuForm() {
    if (!menuForm.name || !menuForm.price) return
    setSaving(true)
    if (editMenuId) {
      const { error } = await supabase.from('menu_items').update({
        name: menuForm.name,
        category: menuForm.category,
        price: Number(menuForm.price),
      }).eq('id', editMenuId)
      if (error) { alert('更新エラー: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('menu_items').insert({
        name: menuForm.name,
        category: menuForm.category,
        price: Number(menuForm.price),
        is_available: true,
      })
      if (error) { alert('追加エラー: ' + error.message); setSaving(false); return }
    }
    setShowMenuForm(false)
    setEditMenuId(null)
    setSaving(false)
    flash(editMenuId ? 'メニューを更新しました' : 'メニューを追加しました')
    fetchAll()
  }

  async function deleteMenu(id) {
    if (!confirm('削除しますか？')) return
    const { error } = await supabase.from('menu_items').delete().eq('id', id)
    if (error) {
      if (confirm('注文履歴で使用されているため削除できません。\n販売停止にしますか？')) {
        await supabase.from('menu_items').update({ is_available: false }).eq('id', id)
      }
    }
    fetchAll()
  }

  // ── ユーザー管理 ────────────────────────────────────────────
  function startAddUser() {
    setUserForm(EMPTY_USER_FORM)
    setEditUserId(null)
    setUserError('')
    setShowUserForm(true)
  }

  function startEditUser(u) {
    setUserForm({ name: u.name, email: u.email || '', password: '', role: u.role })
    setEditUserId(u.id)
    setUserError('')
    setResetSent(false)
    setShowUserForm(true)
  }

  async function saveUserForm() {
    setUserError('')
    if (!userForm.name.trim()) { setUserError('名前を入力してください'); return }
    setSaving(true)

    if (editUserId) {
      const { error } = await supabase.from('user_profiles').update({ name: userForm.name.trim(), role: userForm.role }).eq('id', editUserId)
      if (error) { setUserError('更新エラー: ' + error.message); setSaving(false); return }
    } else {
      if (!userForm.email.trim()) { setUserError('メールアドレスを入力してください'); setSaving(false); return }
      if (userForm.password.length < 6) { setUserError('パスワードは6文字以上で入力してください'); setSaving(false); return }
      // 管理者のセッションを維持するため別インスタンスで登録
      const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
      const { data, error: signUpError } = await tempClient.auth.signUp({ email: userForm.email.trim(), password: userForm.password })
      if (signUpError) { setUserError('登録エラー: ' + signUpError.message); setSaving(false); return }
      const { error: profileError } = await supabase.from('user_profiles').insert({ id: data.user.id, name: userForm.name.trim(), role: userForm.role, email: userForm.email.trim() })
      if (profileError) { setUserError('プロフィール登録エラー: ' + profileError.message); setSaving(false); return }
    }

    setShowUserForm(false)
    setEditUserId(null)
    setSaving(false)
    flash(editUserId ? 'ユーザーを更新しました' : 'ユーザーを登録しました')
    fetchAll()
  }

  async function sendPasswordReset(email) {
    if (!email) { setUserError('メールアドレスが登録されていません'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://niibuikaabui.github.io/pool-register-system/',
    })
    if (error) { setUserError('送信エラー: ' + error.message); return }
    setResetSent(true)
  }

  async function deleteUser(id) {
    if (!confirm('このユーザーを削除しますか？\n（ログインできなくなります）')) return
    await supabase.from('user_profiles').delete().eq('id', id)
    fetchAll()
  }

  // ── 店舗設定 ────────────────────────────────────────────────
  async function saveSettings() {
    setSaving(true)
    if (settings.id) {
      await supabase.from('shop_settings').update({ business_start_time: settings.business_start_time, business_end_time: settings.business_end_time }).eq('id', settings.id)
    } else {
      await supabase.from('shop_settings').insert({ business_start_time: settings.business_start_time, business_end_time: settings.business_end_time })
    }
    flash('店舗設定を保存しました')
    setSaving(false)
    fetchAll()
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">マスタ管理</h1>

      {msg && <div className="bg-green-100 text-green-800 rounded-lg px-4 py-3 mb-4 text-sm">{msg}</div>}

      <div className="flex gap-2 mb-4">
        {[['pricing', '料金設定'], ['menu', 'メニュー'], ['shop', '店舗設定'], ['users', 'ユーザー']].map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === v ? 'bg-green-700 text-white' : 'bg-white border text-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── 料金設定 ── */}
      {activeTab === 'pricing' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={startAddPricing} className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              + 新規追加
            </button>
          </div>

          {showPricingForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                <h2 className="text-lg font-bold mb-4">{editPricingId ? '料金設定を編集' : '料金設定を追加'}</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">区分</label>
                    <div className="flex gap-2">
                      {['general', 'female', 'university', 'high_school'].map(t => (
                        <button key={t} onClick={() => setPricingForm(f => ({ ...f, customer_type: t }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${pricingForm.customer_type === t ? 'bg-green-700 text-white border-green-700' : 'border-gray-300'}`}>
                          {TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">種別</label>
                    <div className="flex gap-2">
                      {['hourly_multi', 'hourly_single', 'freetime'].map(t => (
                        <button key={t} onClick={() => setPricingForm(f => ({ ...f, pricing_type: t }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${pricingForm.pricing_type === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}`}>
                          {PRICING_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(pricingForm.pricing_type === 'hourly_multi' || pricingForm.pricing_type === 'hourly_single') && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">時間制料金 (円/時)</label>
                      <input type="number" value={pricingForm.price_per_hour} onChange={e => setPricingForm(f => ({ ...f, price_per_hour: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-right" min="0" step="1" placeholder="例: 600" />
                    </div>
                  )}
                  {pricingForm.pricing_type === 'freetime' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">フリータイム料金 (円)</label>
                      <input type="number" value={pricingForm.freetime_price} onChange={e => setPricingForm(f => ({ ...f, freetime_price: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-right" min="0" placeholder="例: 1500" />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowPricingForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-gray-700">キャンセル</button>
                  <button onClick={savePricingForm} disabled={saving} className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg py-2">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {pricing.length === 0 ? (
              <div className="text-center py-10 text-gray-400">料金設定がありません</div>
            ) : (
              <SortableList
                items={pricing}
                onReorder={reorderPricing}
                renderItem={row => (
                  <>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{TYPE_LABEL[row.customer_type]}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{PRICING_LABEL[row.pricing_type]}</span>
                      </div>
                      <div className="text-sm text-gray-400 mt-0.5">
                        {row.pricing_type !== 'freetime'
                          ? `${(row.price_per_hour ?? 0).toLocaleString()} 円/時`
                          : `${(row.freetime_price ?? 0).toLocaleString()} 円`}
                      </div>
                    </div>
                    <button onClick={() => startEditPricing(row)} className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400">編集</button>
                    <button onClick={() => deletePricing(row.id)} className="text-sm text-red-400 hover:text-red-600 px-2 py-1">削除</button>
                  </>
                )}
              />
            )}
          </div>
        </div>
      )}

      {/* ── メニュー ── */}
      {activeTab === 'menu' && (
        <div>
          <div className="flex justify-end gap-2 mb-3">
            {bulkEditMode ? (
              <>
                <button onClick={cancelBulkEdit} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium">キャンセル</button>
                <button onClick={saveBulkEdit} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {saving ? '保存中...' : '保存'}
                </button>
              </>
            ) : (
              <>
                <button onClick={startBulkEdit} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium">一括編集</button>
                <button onClick={startAddMenu} className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ 新規追加</button>
              </>
            )}
          </div>

          {showMenuForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                <h2 className="text-lg font-bold mb-4">{editMenuId ? 'メニューを編集' : 'メニューを追加'}</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">カテゴリ</label>
                    <div className="flex gap-2">
                      {[['drink', `${CATEGORY_ICON.drink} ドリンク`], ['food', `${CATEGORY_ICON.food} フード`], ['discount', `${CATEGORY_ICON.discount} 割引`]].map(([v, l]) => (
                        <button key={v} onClick={() => setMenuForm(f => ({ ...f, category: v }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${menuForm.category === v ? 'bg-green-700 text-white border-green-700' : 'border-gray-300'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">メニュー名</label>
                    <input value={menuForm.name} onChange={e => setMenuForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2" placeholder="例：コーラ" autoFocus />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">価格（円）</label>
                    <input type="number" value={menuForm.price} onChange={e => setMenuForm(f => ({ ...f, price: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-right" min="0" placeholder="例：300" />
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowMenuForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-gray-700">キャンセル</button>
                  <button onClick={saveMenuForm} disabled={saving || !menuForm.name || !menuForm.price}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg py-2">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {menus.length === 0 ? (
              <div className="text-center py-10 text-gray-400">メニューがありません</div>
            ) : bulkEditMode ? (
              <div className="divide-y">
                {bulkDraft.map((draft, i) => (
                  <div key={draft.id ?? draft._tmpId} className={`flex items-center gap-2 px-4 py-2 ${draft.id === null ? 'bg-green-50' : ''}`}>
                    <select
                      value={draft.category}
                      onChange={e => setBulkDraft(d => d.map((r, j) => j === i ? { ...r, category: e.target.value } : r))}
                      className="border rounded px-2 py-1 text-sm text-gray-600 w-28 shrink-0"
                    >
                      <option value="drink">{CATEGORY_ICON.drink} ドリンク</option>
                      <option value="food">{CATEGORY_ICON.food} フード</option>
                      <option value="discount">{CATEGORY_ICON.discount} 割引</option>
                    </select>
                    <input
                      value={draft.name}
                      onChange={e => setBulkDraft(d => d.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      placeholder={draft.id === null ? 'メニュー名' : ''}
                    />
                    <input
                      type="number"
                      value={draft.price}
                      onChange={e => setBulkDraft(d => d.map((r, j) => j === i ? { ...r, price: e.target.value } : r))}
                      className="border rounded px-2 py-1 text-sm w-24 text-right"
                      placeholder={draft.id === null ? '価格' : ''}
                    />
                    <span className="text-xs text-gray-400 w-6 text-center">円</span>
                    {draft.id === null && (
                      <button
                        onClick={() => setBulkDraft(d => d.filter((_, j) => j !== i))}
                        className="text-gray-300 hover:text-red-400 text-lg leading-none px-1"
                      >×</button>
                    )}
                  </div>
                ))}
                <div className="px-4 py-2">
                  <button onClick={addBulkRow} className="text-sm text-green-700 hover:text-green-600 font-medium">
                    ＋ 行を追加
                  </button>
                </div>
              </div>
            ) : (
              <SortableList
                items={menus}
                onReorder={reorderMenus}
                renderItem={item => (
                  <>
                    <span className="text-sm text-gray-400 w-16 shrink-0">{CATEGORY_ICON[item.category]} {CATEGORY_LABEL[item.category]}</span>
                    <span className="flex-1 font-medium">{item.name}</span>
                    <span className="text-gray-600">¥{item.price}</span>
                    <button onClick={() => toggleMenuAvailable(item.id, item.is_available)}
                      className={`text-xs px-3 py-1 rounded-full ${item.is_available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                      {item.is_available ? '販売中' : '停止中'}
                    </button>
                    <button onClick={() => startEditMenu(item)} className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400">編集</button>
                    <button onClick={() => deleteMenu(item.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1">削除</button>
                  </>
                )}
              />
            )}
          </div>
        </div>
      )}

      {/* ── ユーザー管理 ── */}
      {activeTab === 'users' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={startAddUser} className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              + 新規登録
            </button>
          </div>

          {showUserForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                <h2 className="text-lg font-bold mb-4">{editUserId ? 'ユーザーを編集' : 'ユーザーを登録'}</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">名前</label>
                    <input value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2" placeholder="例：山田 太郎" />
                  </div>
                  {!editUserId ? (
                    <>
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">メールアドレス</label>
                        <input type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                          className="w-full border rounded-lg px-3 py-2" placeholder="例：staff@example.com" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">パスワード（6文字以上）</label>
                        <input type="password" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                          className="w-full border rounded-lg px-3 py-2" placeholder="••••••••" />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">メールアドレス</label>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-gray-600 border rounded-lg px-3 py-2 bg-gray-50">
                          {userForm.email || '未登録'}
                        </span>
                        <button
                          type="button"
                          onClick={() => sendPasswordReset(userForm.email)}
                          disabled={resetSent}
                          className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 disabled:opacity-50 px-3 py-2 rounded-lg whitespace-nowrap"
                        >
                          PW リセットメール送信
                        </button>
                      </div>
                      {resetSent && (
                        <div className="mt-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          ✓ パスワードリセットメールを送信しました
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">権限</label>
                    <div className="flex gap-2">
                      {[['staff', 'スタッフ'], ['admin', '管理者']].map(([v, l]) => (
                        <button key={v} onClick={() => setUserForm(f => ({ ...f, role: v }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${userForm.role === v ? 'bg-green-700 text-white border-green-700' : 'border-gray-300'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {userError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{userError}</div>}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowUserForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-gray-700">キャンセル</button>
                  <button onClick={saveUserForm} disabled={saving} className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg py-2">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {users.length === 0 ? (
              <div className="text-center py-10 text-gray-400">ユーザーがいません</div>
            ) : (
              <div className="divide-y">
                {users.map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{u.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                          {u.role === 'admin' ? '管理者' : 'スタッフ'}
                        </span>
                      </div>
                      {u.email && <div className="text-xs text-gray-400 mt-0.5">{u.email}</div>}
                    </div>
                    <button onClick={() => startEditUser(u)} className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400">編集</button>
                    <button onClick={() => deleteUser(u.id)} className="text-sm text-red-400 hover:text-red-600 px-2 py-1">削除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">※ Supabase の「メール確認」をOFFにしないと登録後すぐにログインできません（Authentication → Providers → Email → Confirm email をOFF）</p>
        </div>
      )}

      {/* ── 店舗設定 ── */}
      {activeTab === 'shop' && settings && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-sm text-gray-500 mb-4">営業日の区切りを設定します。例: 開始10:00、終了03:00 → 翌3:00までの会計は前日の営業日として集計されます。</p>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">営業開始時刻</label>
              <input type="time" value={settings.business_start_time?.slice(0, 5) || '10:00'} onChange={e => setSettings(s => ({ ...s, business_start_time: e.target.value }))} className="border rounded-lg px-3 py-2 w-full" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">営業終了時刻</label>
              <input type="time" value={settings.business_end_time?.slice(0, 5) || '03:00'} onChange={e => setSettings(s => ({ ...s, business_end_time: e.target.value }))} className="border rounded-lg px-3 py-2 w-full" />
            </div>
          </div>
          <button onClick={saveSettings} disabled={saving} className="mt-4 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  )
}
