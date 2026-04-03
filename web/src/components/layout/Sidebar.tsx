'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  MessageSquare,
  Mail,
  Settings,
  LogOut,
} from 'lucide-react'

interface SidebarProps {
  user: {
    name: string | null
    email: string | null
  }
}

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tasks', icon: CheckSquare, label: 'Görevler' },
  { href: '/schedule', icon: Calendar, label: 'Haftalık Plan' },
  { href: '/chat', icon: MessageSquare, label: 'Sohbet' },
  { href: '/email', icon: Mail, label: 'E-posta' },
  { href: '/settings', icon: Settings, label: 'Ayarlar' },
]

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()

  const initials = user.name
    ? user.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : (user.email?.[0] ?? '?').toUpperCase()

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-60 flex flex-col bg-zinc-950 z-40"
      style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Brand */}
      <div className="px-6 py-6">
        <h1
          className="text-2xl font-bold"
          style={{
            background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Yeliz
        </h1>
        <p className="text-zinc-600 text-xs mt-0.5">Kişisel AI Asistan</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="px-3 pb-4 mt-auto">
        <div
          className="p-3 rounded-xl"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
            >
              {initials}
            </div>
            <div className="overflow-hidden">
              <p className="text-white text-sm font-medium truncate">{user.name || 'Kullanıcı'}</p>
              <p className="text-zinc-500 text-xs truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 text-xs transition-all"
          >
            <LogOut size={14} />
            Çıkış Yap
          </button>
        </div>
      </div>
    </aside>
  )
}
