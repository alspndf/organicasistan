'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import { Send, Bot } from 'lucide-react'
import type { ChatMessage } from '@/types'

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
      >
        <Bot size={14} className="text-white" />
      </div>
      <div
        className="px-4 py-3 rounded-2xl rounded-bl-sm"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-zinc-400"
              style={{
                animation: 'bounce 1.2s infinite',
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Merhaba Alp Bey! Ben Yeliz 😊 Size nasıl yardımcı olabilirim?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSend(e?: FormEvent) {
    if (e) e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      const data = await res.json()
      const reply = data.response || 'Bir hata oluştu, lütfen tekrar deneyin.'

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: reply, timestamp: new Date() },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Üzgünüm, bir bağlantı hatası oluştu. Lütfen tekrar deneyin.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function formatTime(d: Date) {
    return new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <>
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Yeliz</p>
            <p className="text-zinc-500 text-xs">Kişisel AI Asistanınız</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-zinc-500">Çevrimiçi</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
                >
                  <Bot size={14} className="text-white" />
                </div>
              )}

              <div
                className={`flex flex-col gap-1 max-w-[70%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {msg.role === 'assistant' && (
                  <span className="text-xs text-zinc-500 ml-1">Yeliz</span>
                )}
                <div
                  className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-br-sm text-white'
                      : 'rounded-bl-sm text-zinc-100'
                  }`}
                  style={
                    msg.role === 'user'
                      ? { background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }
                      : {
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }
                  }
                >
                  {msg.content}
                </div>
                <span className="text-xs text-zinc-600 px-1">{formatTime(msg.timestamp)}</span>
              </div>
            </div>
          ))}

          {loading && <TypingIndicator />}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          className="px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <form onSubmit={handleSend} className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Bir mesaj yazın..."
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-2xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all disabled:opacity-50"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.09)',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
            >
              <Send size={18} className="text-white" />
            </button>
          </form>
          <p className="text-zinc-700 text-xs mt-2 text-center">
            Görev eklemek, günlük plan oluşturmak veya mevcut görevlerinizi yönetmek için yazın.
          </p>
        </div>
      </div>
    </>
  )
}
