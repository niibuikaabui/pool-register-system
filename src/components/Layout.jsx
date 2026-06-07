import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const navItems = [
  { path: '/', label: 'ダッシュボード', icon: '🎱' },
  { path: '/members', label: '会員管理', icon: '👤' },
  { path: '/reports', label: '売上レポート', icon: '📊' },
]

const adminItems = [
  { path: '/master', label: 'マスタ管理', icon: '⚙️' },
]

export default function Layout({ children }) {
  const { profile, isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const allItems = isAdmin ? [...navItems, ...adminItems] : navItems

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-green-800 text-white shadow-md">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="lg:hidden p-1 rounded"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="text-xl">☰</span>
            </button>
            <button onClick={() => navigate('/')} className="font-bold text-lg hover:text-green-200 transition-colors">🎱 ビリヤード レジ</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-green-200 hidden sm:block">
              {profile?.name} ({profile?.role === 'admin' ? '管理者' : 'スタッフ'})
            </span>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <nav className="lg:hidden border-t border-green-700 px-4 py-2 flex flex-col gap-1">
            {allItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 rounded ${
                  location.pathname === item.path
                    ? 'bg-green-600'
                    : 'hover:bg-green-700'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-green-700 text-green-300 text-xs mt-2"
            >
              <span>🚪</span>
              <span>ログアウト</span>
            </button>
          </nav>
        )}
      </header>

      <div className="flex flex-1">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex flex-col w-48 bg-green-900 text-white py-4">
          {allItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-4 py-3 hover:bg-green-700 transition-colors ${
                location.pathname === item.path ? 'bg-green-700 border-l-4 border-yellow-400' : ''
              }`}
            >
              <span>{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </Link>
          ))}
          <div className="flex-1" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 hover:bg-green-700 transition-colors text-green-400 text-xs"
          >
            <span>🚪</span>
            <span>ログアウト</span>
          </button>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-4">
          {children}
        </main>
      </div>
    </div>
  )
}
