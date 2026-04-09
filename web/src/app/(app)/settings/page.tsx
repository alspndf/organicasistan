'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Key, Bell, Calendar, User, Trash2, Eye, EyeOff, Save, Loader2, CheckCircle2, Bot, Play, Square, RefreshCw } from 'lucide-react'
import type { UserSettings } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <h2 className="text-white font-semibold text-sm mb-5 flex items-center gap-2">
        <Icon size={15} className="text-zinc-400" />
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-4 py-2.5 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all disabled:opacity-40"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        colorScheme: 'dark',
      }}
    />
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${
        checked ? 'bg-blue-600' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          checked ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function BotControl() {
  const { data, mutate } = useSWR('/api/bot', fetcher, { refreshInterval: 3000 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const logsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [data?.logs])

  async function toggle() {
    setLoading(true)
    setError('')
    try {
      const action = data?.running ? 'stop' : 'start'
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!json.ok) setError(json.error || 'İşlem başarısız.')
      mutate()
    } catch (e) {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  const running = data?.running ?? false

  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-white font-semibold text-sm flex items-center gap-2">
          <Bot size={15} className="text-zinc-400" />
          Telegram Bot
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: running ? '#22c55e' : '#71717a', boxShadow: running ? '0 0 6px #22c55e' : 'none' }}
            />
            <span className="text-xs text-zinc-400">{running ? 'Çalışıyor' : 'Durdu'}</span>
          </div>
          <button
            onClick={toggle}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
            style={{
              background: running ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
              border: running ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(34,197,94,0.25)',
              color: running ? '#f87171' : '#4ade80',
            }}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : running ? (
              <><Square size={11} /> Durdur</>
            ) : (
              <><Play size={11} /> Başlat</>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)' }}>
          {error}
        </p>
      )}

      {data?.startedAt && running && (
        <p className="text-zinc-500 text-xs mb-3">
          Başladı: {new Date(data.startedAt).toLocaleTimeString('tr-TR')}
          {data.pid && ` · PID: ${data.pid}`}
        </p>
      )}

      {/* Log window */}
      <div
        ref={logsRef}
        className="font-mono text-xs rounded-xl p-3 overflow-y-auto"
        style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
          height: '180px',
          color: '#a1a1aa',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {data?.logs?.length
          ? data.logs.map((line: string, i: number) => (
              <div key={i} className="leading-5">{line}</div>
            ))
          : <span className="text-zinc-600">Henüz log yok.</span>
        }
      </div>

      <button
        onClick={() => mutate()}
        className="mt-2 flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <RefreshCw size={10} /> Yenile
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const { data: settings, mutate } = useSWR<UserSettings>('/api/settings', fetcher)

  const [anthropicKey, setAnthropicKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [notifyTelegram, setNotifyTelegram] = useState(true)
  const [notifyWeb, setNotifyWeb] = useState(true)
  const [dailyPlanTime, setDailyPlanTime] = useState('09:00')
  const [assistantName, setAssistantName] = useState('Yeliz')
  const [userName, setUserName] = useState('Alp Bey')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deletingTasks, setDeletingTasks] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)

  useEffect(() => {
    if (settings) {
      setTelegramChatId(settings.telegramChatId || '')
      setNotifyTelegram(settings.notifyTelegram)
      setNotifyWeb(settings.notifyWeb)
      setDailyPlanTime(settings.dailyPlanTime || '09:00')
      setAssistantName(settings.assistantName || 'Yeliz')
      setUserName(settings.userName || 'Alp Bey')
    }
  }, [settings])

  async function handleSave() {
    setSaving(true)
    setSaved(false)

    try {
      const body: Record<string, unknown> = {
        telegramChatId,
        notifyTelegram,
        notifyWeb,
        dailyPlanTime,
        assistantName,
        userName,
      }

      if (anthropicKey) body.anthropicKey = anthropicKey
      if (telegramToken) body.telegramToken = telegramToken

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        mutate()
        setAnthropicKey('')
        setTelegramToken('')
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleResetAll() {
    if (!confirm('Tüm görevler, rutinler ve hafıza silinecek. Bu işlem geri alınamaz. Emin misiniz?')) return
    setResettingAll(true)
    try {
      await fetch('/api/reset', { method: 'DELETE' })
    } catch (err) {
      console.error(err)
    } finally {
      setResettingAll(false)
    }
  }

  async function handleDeleteTodayTasks() {
    if (!confirm('Bugünün tüm görevleri silinecek. Emin misiniz?')) return

    setDeletingTasks(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await fetch(`/api/tasks?date=${today}&deleteAll=true`, { method: 'DELETE' })
    } catch (err) {
      console.error(err)
    } finally {
      setDeletingTasks(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Ayarlar</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Asistan ve bildirim tercihlerinizi yönetin</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* API Keys */}
        <Section icon={Key} title="API Anahtarları">
          <div className="space-y-4">
            <Field label="Anthropic API Anahtarı">
              <div className="relative">
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  placeholder={
                    settings?.anthropicKeySet ? '••••••••••••••••••• (Ayarlandı)' : 'sk-ant-...'
                  }
                  className="w-full px-4 py-2.5 pr-10 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                >
                  {showAnthropicKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {settings?.anthropicKeySet && !anthropicKey && (
                <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  API anahtarı ayarlandı
                </p>
              )}
            </Field>

            <Field label="Telegram Bot Token">
              <Input
                type="password"
                value={telegramToken}
                onChange={setTelegramToken}
                placeholder={settings?.telegramTokenSet ? '••••••••••• (Ayarlandı)' : 'Bot token...'}
              />
            </Field>

            <Field label="Telegram Chat ID">
              <Input
                value={telegramChatId}
                onChange={setTelegramChatId}
                placeholder="-1001234567890"
              />
            </Field>
          </div>
        </Section>

        {/* Notifications */}
        <Section icon={Bell} title="Bildirimler">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm">Telegram Bildirimleri</p>
                <p className="text-zinc-500 text-xs mt-0.5">Görev hatırlatmalarını Telegram üzerinden al</p>
              </div>
              <Toggle checked={notifyTelegram} onChange={setNotifyTelegram} />
            </div>
            <div
              className="h-px"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm">Web Bildirimleri</p>
                <p className="text-zinc-500 text-xs mt-0.5">Tarayıcı push bildirimleri</p>
              </div>
              <Toggle checked={notifyWeb} onChange={setNotifyWeb} />
            </div>
          </div>
        </Section>

        {/* Schedule */}
        <Section icon={Calendar} title="Zamanlama">
          <Field label="Günlük Plan Saati">
            <input
              type="time"
              value={dailyPlanTime}
              onChange={e => setDailyPlanTime(e.target.value)}
              className="w-36 px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                colorScheme: 'dark',
              }}
            />
          </Field>
        </Section>

        {/* Personal */}
        <Section icon={User} title="Kişisel Ayarlar">
          <div className="space-y-4">
            <Field label="Asistan Adı">
              <Input
                value={assistantName}
                onChange={setAssistantName}
                placeholder="Yeliz"
              />
            </Field>
            <Field label="Adınız">
              <Input
                value={userName}
                onChange={setUserName}
                placeholder="Alp Bey"
              />
            </Field>
          </div>
        </Section>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-2xl text-white font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <>
              <CheckCircle2 size={16} />
              Kaydedildi!
            </>
          ) : (
            <>
              <Save size={16} />
              Ayarları Kaydet
            </>
          )}
        </button>

        {/* Telegram Bot */}
        <BotControl />

        {/* Danger Zone */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.15)',
          }}
        >
          <h2 className="text-red-400 font-semibold text-sm mb-4 flex items-center gap-2">
            <Trash2 size={15} />
            Tehlikeli Bölge
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm">Bugünün Görevlerini Sil</p>
                <p className="text-zinc-500 text-xs mt-0.5">Yalnızca bugünkü görevler silinir</p>
              </div>
              <button
                onClick={handleDeleteTodayTasks}
                disabled={deletingTasks}
                className="px-4 py-2 rounded-xl text-red-400 text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                {deletingTasks ? <Loader2 size={14} className="animate-spin" /> : 'Bugünü Temizle'}
              </button>
            </div>
            <div className="h-px" style={{ background: 'rgba(239,68,68,0.15)' }} />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm">Tüm Verileri Sıfırla</p>
                <p className="text-zinc-500 text-xs mt-0.5">Tüm görevler, rutinler ve hafıza silinir</p>
              </div>
              <button
                onClick={handleResetAll}
                disabled={resettingAll}
                className="px-4 py-2 rounded-xl text-red-400 text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
              >
                {resettingAll ? <Loader2 size={14} className="animate-spin" /> : 'Sıfırla'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
