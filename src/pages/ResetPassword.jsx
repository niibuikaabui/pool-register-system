import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function ResetPassword() {
  const { setIsRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('パスワードは6文字以上で入力してください'); return }
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError('変更エラー: ' + error.message); setLoading(false); return }
    setDone(true)
    setLoading(false)
    // 3秒後に通常ログイン状態へ
    setTimeout(() => setIsRecovery(false), 3000)
  }

  return (
    <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-gray-800">パスワード変更</h1>
        </div>

        {done ? (
          <div className="text-center">
            <div className="text-green-600 font-medium mb-2">✓ パスワードを変更しました</div>
            <p className="text-sm text-gray-500">まもなくトップ画面に戻ります...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="6文字以上"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">確認（もう一度）</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="同じパスワードを入力"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-3 text-base mt-2 transition-colors"
            >
              {loading ? '変更中...' : 'パスワードを変更'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
