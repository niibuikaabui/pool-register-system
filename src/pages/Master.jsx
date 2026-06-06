import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TYPE_LABEL = { general: '一般', female: '女性', student: '学生' }
const PRICING_LABEL = { hourly_multi: '時間制（複数）', hourly_single: '時間制（一人）', freetime: 'フリータイム' }
const EMPTY_PRICING_FORM = { customer_type: 'general', pricing_type: 'hourly_multi', price_per_hour: '', freetime_price: '' }

export default function Master() {
  const [pricing, setPricing] = useState([])
  const [menus, setMenus] = useState([])
  const [settings, setSettings] = useState(null)
  const [activeTab, setActiveTab] = useState('pricing')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newMenu, setNewMenu] = useState({ name: '', category: 'drink', price: '' })

  // Pricing modal state
  const [showPricingForm, setShowPricingForm] = useState(false)
  const [pricingForm, setPricingForm] = useState(EMPTY_PRICING_FORM)
  const [editPricingId, setEditPricingId] = useState(null)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    const [{ data: p }, { data: m }, { data: s }] = await Promise.all([
      supabase.from('pricing_master').select('*').order('customer_type').order('pricing_type'),
      supabase.from('menu_items').select('*').order('category').order('name'),
      supabase.from('shop_settings').select('*').limit(1).single(),
    ])
    setPricing((p || []).map(row => ({
      ...row,
      price_per_hour: row.price_per_minute != null ? row.price_per_minute * 60 : null,
    })))
    setMenus(m || [])
    setSettings(s || { business_start_time: '10:00', business_end_time: '03:00' })
  }

  function startEditPricing(row) {
    setPricingForm({
      customer_type: row.customer_type,
      pricing_type: row.pricing_type,
      price_per_hour: row.price_per_hour ?? '',
      freetime_price: row.freetime_price ?? '',
    })
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
    const payload = {
      customer_type: pricingForm.customer_type,
      pricing_type: pricingForm.pricing_type,
      price_per_minute: price_per_hour != null ? price_per_hour / 60 : null,
      freetime_price,
    }
    if (editPricingId) {
      const { error } = await supabase.from('pricing_master').update(payload).eq('id', editPricingId)
      if (error) { alert('更新エラー: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('pricing_master').insert(payload)
      if (error) { alert('登録エラー: ' + error.message); setSaving(false); return }
    }
    setShowPricingForm(false)
    setEditPricingId(null)
    setSaving(false)
    setMsg(editPricingId ? '料金設定を更新しました' : '料金設定を追加しました')
    setTimeout(() => setMsg(''), 3000)
    fetchAll()
  }

  async function deletePricing(id) {
    if (!confirm('この料金設定を削除しますか？')) return
    await supabase.from('pricing_master').delete().eq('id', id)
    fetchAll()
  }

  async function toggleMenuAvailable(id, current) {
    await supabase.from('menu_items').update({ is_available: !current }).eq('id', id)
    fetchAll()
  }

  async function addMenu() {
    if (!newMenu.name || !newMenu.price) return
    await supabase.from('menu_items').insert({ ...newMenu, price: Number(newMenu.price), is_available: true })
    setNewMenu({ name: '', category: 'drink', price: '' })
    fetchAll()
  }

  async function deleteMenu(id) {
    if (!confirm('削除しますか？')) return
    await supabase.from('menu_items').delete().eq('id', id)
    fetchAll()
  }

  async function saveSettings() {
    setSaving(true)
    if (settings.id) {
      await supabase.from('shop_settings').update({
        business_start_time: settings.business_start_time,
        business_end_time: settings.business_end_time,
      }).eq('id', settings.id)
    } else {
      await supabase.from('shop_settings').insert({
        business_start_time: settings.business_start_time,
        business_end_time: settings.business_end_time,
      })
    }
    setMsg('店舗設定を保存しました')
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
    fetchAll()
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-4">マスタ管理</h1>

      {msg && (
        <div className="bg-green-100 text-green-800 rounded-lg px-4 py-3 mb-4 text-sm">{msg}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[['pricing', '料金設定'], ['menu', 'メニュー'], ['shop', '店舗設定']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setActiveTab(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === v ? 'bg-green-700 text-white' : 'bg-white border text-gray-700'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Pricing */}
      {activeTab === 'pricing' && (
        <div>
          <div className="flex justify-end mb-3">
            <button
              onClick={startAddPricing}
              className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + 新規追加
            </button>
          </div>

          {/* Pricing modal */}
          {showPricingForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                <h2 className="text-lg font-bold mb-4">{editPricingId ? '料金設定を編集' : '料金設定を追加'}</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">区分</label>
                    <div className="flex gap-2">
                      {['general', 'female', 'student'].map(t => (
                        <button
                          key={t}
                          onClick={() => setPricingForm(f => ({ ...f, customer_type: t }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${pricingForm.customer_type === t ? 'bg-green-700 text-white border-green-700' : 'border-gray-300'}`}
                        >
                          {TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">種別</label>
                    <div className="flex gap-2">
                      {['hourly_multi', 'hourly_single', 'freetime'].map(t => (
                        <button
                          key={t}
                          onClick={() => setPricingForm(f => ({ ...f, pricing_type: t }))}
                          className={`flex-1 py-2 rounded-lg text-sm border ${pricingForm.pricing_type === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}`}
                        >
                          {PRICING_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(pricingForm.pricing_type === 'hourly_multi' || pricingForm.pricing_type === 'hourly_single') && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">時間制料金 (円/時)</label>
                      <input
                        type="number"
                        value={pricingForm.price_per_hour}
                        onChange={e => setPricingForm(f => ({ ...f, price_per_hour: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-right"
                        min="0"
                        step="1"
                        placeholder="例: 600"
                      />
                    </div>
                  )}
                  {(pricingForm.pricing_type === 'freetime') && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1 block">フリータイム料金 (円)</label>
                      <input
                        type="number"
                        value={pricingForm.freetime_price}
                        onChange={e => setPricingForm(f => ({ ...f, freetime_price: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-right"
                        min="0"
                        placeholder="例: 1500"
                      />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => setShowPricingForm(false)}
                    className="flex-1 border border-gray-300 rounded-lg py-2 text-gray-700"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={savePricingForm}
                    disabled={saving}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg py-2"
                  >
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
              <div className="divide-y">
                {pricing.map(row => (
                  <div key={row.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
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
                    <button
                      onClick={() => startEditPricing(row)}
                      className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => deletePricing(row.id)}
                      className="text-sm text-red-400 hover:text-red-600 px-2 py-1"
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menu */}
      {activeTab === 'menu' && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          {/* Add form */}
          <div className="flex gap-2 mb-4">
            <select
              value={newMenu.category}
              onChange={e => setNewMenu(m => ({ ...m, category: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="drink">ドリンク</option>
              <option value="food">フード</option>
            </select>
            <input
              value={newMenu.name}
              onChange={e => setNewMenu(m => ({ ...m, name: e.target.value }))}
              placeholder="メニュー名"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={newMenu.price}
              onChange={e => setNewMenu(m => ({ ...m, price: e.target.value }))}
              placeholder="価格"
              type="number"
              className="border rounded-lg px-3 py-2 text-sm w-24"
            />
            <button
              onClick={addMenu}
              className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              追加
            </button>
          </div>

          <div className="divide-y">
            {menus.map(item => (
              <div key={item.id} className="flex items-center gap-3 py-3">
                <span className="text-sm text-gray-400 w-16">{item.category === 'drink' ? '🍹' : '🍔'} {item.category === 'drink' ? 'ドリンク' : 'フード'}</span>
                <span className="flex-1 font-medium">{item.name}</span>
                <span className="text-gray-600">¥{item.price}</span>
                <button
                  onClick={() => toggleMenuAvailable(item.id, item.is_available)}
                  className={`text-xs px-3 py-1 rounded-full ${item.is_available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}
                >
                  {item.is_available ? '販売中' : '停止中'}
                </button>
                <button
                  onClick={() => deleteMenu(item.id)}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shop settings */}
      {activeTab === 'shop' && settings && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-sm text-gray-500 mb-4">営業日の区切りを設定します。例: 開始10:00、終了03:00 → 翌3:00までの会計は前日の営業日として集計されます。</p>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">営業開始時刻</label>
              <input
                type="time"
                value={settings.business_start_time?.slice(0, 5) || '10:00'}
                onChange={e => setSettings(s => ({ ...s, business_start_time: e.target.value }))}
                className="border rounded-lg px-3 py-2 w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">営業終了時刻</label>
              <input
                type="time"
                value={settings.business_end_time?.slice(0, 5) || '03:00'}
                onChange={e => setSettings(s => ({ ...s, business_end_time: e.target.value }))}
                className="border rounded-lg px-3 py-2 w-full"
              />
            </div>
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="mt-4 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  )
}
