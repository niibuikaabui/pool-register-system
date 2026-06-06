import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const TYPE_LABEL = { general: '一般', female: '女性', student: '学生' }

const EMPTY_FORM = { name: '', customer_type: 'general', phone: '', birthday: '', notes: '' }

export default function Members() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [editMemberNumber, setEditMemberNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => { fetchMembers() }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchMembers(search), 300)
    return () => clearTimeout(t)
  }, [search])

  async function fetchMembers(q = '') {
    setLoading(true)
    let query = supabase.from('members').select('*').order('member_number', { ascending: false })
    if (q) query = query.or(`name.ilike.%${q}%,member_number.ilike.%${q}%,phone.ilike.%${q}%`)
    const { data } = await query.limit(50)
    setMembers(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name) return
    setSaving(true)

    // 空文字は null に変換（date型などに空文字を送るとDBエラーになる）
    const payload = {
      ...form,
      phone:    form.phone    || null,
      birthday: form.birthday || null,
      notes:    form.notes    || null,
    }

    if (editId) {
      const { error } = await supabase.from('members').update(payload).eq('id', editId)
      if (error) { alert('更新エラー: ' + error.message); setSaving(false); return }
    } else {
      // Auto member_number: get max and increment
      const { data: last } = await supabase
        .from('members')
        .select('member_number')
        .order('member_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextNum = String(parseInt(last?.member_number || '0') + 1).padStart(6, '0')
      const { error } = await supabase.from('members').insert({ ...payload, member_number: nextNum })
      if (error) { alert('登録エラー: ' + error.message); setSaving(false); return }
    }
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(false)
    setSaving(false)
    fetchMembers(search)
  }

  function startEdit(m) {
    setForm({ name: m.name, customer_type: m.customer_type, phone: m.phone || '', birthday: m.birthday || '', notes: m.notes || '' })
    setEditId(m.id)
    setEditMemberNumber(m.member_number)
    setShowForm(true)
  }

  // Barcode reader support
  function handleSearchKey(e) {
    if (e.key === 'Enter') fetchMembers(search)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">会員管理</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true) }}
          className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + 新規登録
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          ref={searchRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="名前・会員番号・電話番号で検索（バーコードリーダー対応）"
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editId ? '会員情報編集' : '新規会員登録'}</h2>
              {editId && (
                <span className="text-sm font-mono bg-gray-100 text-gray-600 px-3 py-1 rounded-full">
                  会員番号 #{editMemberNumber}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">名前 *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="山田 太郎"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">区分 *</label>
                <div className="flex gap-2">
                  {['general', 'female', 'student'].map(t => (
                    <button
                      key={t}
                      onClick={() => setForm(f => ({ ...f, customer_type: t }))}
                      className={`flex-1 py-2 rounded-lg text-sm border ${form.customer_type === t ? 'bg-green-700 text-white border-green-700' : 'border-gray-300'}`}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">電話番号</label>
                <input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="090-0000-0000"
                  type="tel"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">生年月日</label>
                <input
                  value={form.birthday}
                  onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                  type="date"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">備考</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-300 rounded-lg py-2 text-gray-700"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name}
                className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg py-2"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">読み込み中...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {members.length === 0 ? (
            <div className="text-center py-10 text-gray-400">会員が見つかりません</div>
          ) : (
            <div className="divide-y">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{m.name}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{TYPE_LABEL[m.customer_type]}</span>
                    </div>
                    <div className="text-sm text-gray-400 flex gap-3 mt-0.5">
                      <span>#{m.member_number}</span>
                      {m.phone && <span>{m.phone}</span>}
                      <span>来店: {m.visit_count || 0}回</span>
                      <span>累計: ¥{(m.total_spent || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => startEdit(m)}
                    className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400"
                  >
                    編集
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
