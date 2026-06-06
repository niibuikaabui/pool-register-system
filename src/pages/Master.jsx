import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TYPE_LABEL = { general: '一般', female: '女性', student: '学生' }
const PRICING_LABEL = { hourly: '時間制', freetime: 'フリータイム' }

export default function Master() {
  const [pricing, setPricing] = useState([])
  const [menus, setMenus] = useState([])
  const [settings, setSettings] = useState(null)
  const [activeTab, setActiveTab] = useState('pricing')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newMenu, setNewMenu] = useState({ name: '', category: 'drink', price: '' })

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

  async function savePricing() {
    setSaving(true)
    for (const row of pricing) {
      const { price_per_hour, ...rest } = row
      const toSave = { ...rest, price_per_minute: price_per_hour != null ? price_per_hour / 60 : null }
      await supabase.from('pricing_master').upsert(toSave)
    }
    setMsg('料金設定を保存しました')
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  function updatePricing(id, field, value) {
    setPricing(prev => prev.map(p => p.id === id ? { ...p, [field]: value === '' ? null : Number(value) } : p))
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
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-sm text-gray-500 mb-4">時間制: 1時間あたりの料金（円/時）を設定。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4">区分</th>
                  <th className="text-left py-2 pr-4">種別</th>
                  <th className="text-right py-2 pr-4">時間制 (円/時)</th>
                  <th className="text-right py-2">フリータイム (円)</th>
                </tr>
              </thead>
              <tbody>
                {['general', 'female', 'student'].flatMap(ct =>
                  ['hourly', 'freetime'].map(pt => {
                    const row = pricing.find(p => p.customer_type === ct && p.pricing_type === pt)
                    if (!row) return null
                    return (
                      <tr key={row.id} className="border-b">
                        <td className="py-3 pr-4 font-medium">{TYPE_LABEL[ct]}</td>
                        <td className="py-3 pr-4 text-gray-500">{PRICING_LABEL[pt]}</td>
                        <td className="py-3 pr-4 text-right">
                          {pt === 'hourly' ? (
                            <input
                              type="number"
                              value={row.price_per_hour ?? ''}
                              onChange={e => updatePricing(row.id, 'price_per_hour', e.target.value)}
                              className="border rounded px-2 py-1 w-24 text-right"
                              min="0"
                              step="1"
                            />
                          ) : '-'}
                        </td>
                        <td className="py-3 text-right">
                          {pt === 'freetime' ? (
                            <input
                              type="number"
                              value={row.freetime_price ?? ''}
                              onChange={e => updatePricing(row.id, 'freetime_price', e.target.value)}
                              className="border rounded px-2 py-1 w-24 text-right"
                              min="0"
                            />
                          ) : '-'}
                        </td>
                      </tr>
                    )
                  }).filter(Boolean)
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={savePricing}
            disabled={saving}
            className="mt-4 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium"
          >
            {saving ? '保存中...' : '保存'}
          </button>
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
