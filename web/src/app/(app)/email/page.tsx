'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Mail, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertCircle, Calendar, Zap } from 'lucide-react'
import type { EmailActionItem } from '@/types'

interface EmailConnection {
  connected: boolean
  lastChecked: string | null
  checkTime: string
  provider: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-6 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {children}
    </div>
  )
}

const actionTypeColors: Record<string, string> = {
  meeting: 'rgba(59,130,246,0.2)',
  action: 'rgba(16,185,129,0.2)',
  deadline: 'rgba(239,68,68,0.2)',
  info: 'rgba(255,255,255,0.08)',
}

const actionTypeLabels: Record<string, string> = {
  meeting: 'Toplantı',
  action: 'Aksiyon',
  deadline: 'Son Tarih',
  info: 'Bilgi',
}

const actionTypeTextColors: Record<string, string> = {
  meeting: '#60a5fa',
  action: '#34d399',
  deadline: '#f87171',
  info: '#a1a1aa',
}

export default function EmailPage() {
  const { data: connection, mutate: mutateConnection } = useSWR<EmailConnection>(
    '/api/email/status',
    fetcher
  )
  const [connecting, setConnecting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [actionItems, setActionItems] = useState<EmailActionItem[]>([])
  const [summary, setSummary] = useState('')
  const [fetchError, setFetchError] = useState('')

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await fetch('/api/email/auth')
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setConnecting(false)
    }
  }

  async function handleFetchEmails() {
    setFetching(true)
    setFetchError('')
    setActionItems([])
    setSummary('')

    try {
      const res = await fetch('/api/email/fetch', { method: 'POST' })
      const data = await res.json()

      if (res.ok) {
        setActionItems(data.actionItems || [])
        setSummary(data.summary || '')
        mutateConnection()
      } else {
        setFetchError(data.error || 'E-postalar alınamadı.')
      }
    } catch {
      setFetchError('Bağlantı hatası.')
    } finally {
      setFetching(false)
    }
  }

  const isConnected = connection?.connected

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Mail size={22} />
          E-posta
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Gmail bağlantısı ve e-posta analizi</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Connection status */}
        <GlassCard>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center`}
                style={{
                  background: isConnected ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                }}
              >
                <Mail size={18} className={isConnected ? 'text-green-400' : 'text-zinc-500'} />
              </div>
              <div>
                <p className="text-white text-sm font-medium">Gmail</p>
                <p className="text-xs mt-0.5" style={{ color: isConnected ? '#34d399' : '#71717a' }}>
                  {isConnected ? 'Bağlı' : 'Bağlı değil'}
                </p>
              </div>
            </div>

            {isConnected ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-green-400" />
                <span className="text-green-400 text-xs">Bağlandı</span>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
              >
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Gmail&apos;e Bağlan
              </button>
            )}
          </div>

          {isConnected && connection?.lastChecked && (
            <p className="text-zinc-600 text-xs mt-4">
              Son kontrol: {new Date(connection.lastChecked).toLocaleString('tr-TR')}
            </p>
          )}
        </GlassCard>

        {/* Fetch emails button */}
        {isConnected && (
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-medium text-sm">E-posta Analizi</h3>
                <p className="text-zinc-500 text-xs mt-0.5">Son e-postaları analiz et ve aksiyon öğelerini çıkar</p>
              </div>
              <button
                onClick={handleFetchEmails}
                disabled={fetching}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: fetching ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                }}
              >
                {fetching ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {fetching ? 'Analiz ediliyor...' : 'E-postaları Şimdi Kontrol Et'}
              </button>
            </div>

            {fetchError && (
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-red-400 text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <AlertCircle size={14} />
                {fetchError}
              </div>
            )}
          </GlassCard>
        )}

        {/* Summary */}
        {summary && (
          <GlassCard>
            <h3 className="text-white font-medium text-sm mb-3 flex items-center gap-2">
              <Zap size={14} className="text-yellow-400" />
              E-posta Özeti
            </h3>
            <p className="text-zinc-300 text-sm leading-relaxed">{summary}</p>
          </GlassCard>
        )}

        {/* Action items */}
        {actionItems.length > 0 && (
          <GlassCard>
            <h3 className="text-white font-medium text-sm mb-4 flex items-center gap-2">
              <Calendar size={14} className="text-blue-400" />
              Aksiyon Öğeleri ({actionItems.length})
            </h3>
            <div className="space-y-2">
              {actionItems.map((item, i) => (
                <div
                  key={i}
                  className="px-4 py-3 rounded-xl"
                  style={{
                    background: actionTypeColors[item.type] || 'rgba(255,255,255,0.06)',
                    border: `1px solid ${actionTypeTextColors[item.type]}30`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            color: actionTypeTextColors[item.type],
                            background: `${actionTypeTextColors[item.type]}20`,
                          }}
                        >
                          {actionTypeLabels[item.type] || item.type}
                        </span>
                        {item.time && (
                          <span className="text-xs text-zinc-500">{item.time}</span>
                        )}
                      </div>
                      <p className="text-white text-sm">{item.title}</p>
                      {item.from && (
                        <p className="text-zinc-500 text-xs mt-1">Kimden: {item.from}</p>
                      )}
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        background: item.priority === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                        color: item.priority === 'high' ? '#f87171' : '#71717a',
                      }}
                    >
                      {item.priority === 'high' ? 'Yüksek' : item.priority === 'medium' ? 'Orta' : 'Düşük'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Not connected state */}
        {!isConnected && (
          <div
            className="rounded-2xl p-12 text-center"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.1)',
            }}
          >
            <Mail size={36} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">
              E-posta analizini kullanmak için Gmail hesabınızı bağlayın.
            </p>
            <p className="text-zinc-700 text-xs mt-2">
              Yalnızca okuma izni istenir. E-postalarınız güvenle analiz edilir.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
