import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import path from 'path'

interface BotState {
  process: ChildProcess | null
  logs: string[]
  startedAt: Date | null
  pid: number | null
}

// Persist across Next.js hot-reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var __botState: BotState | undefined
}

function getState(): BotState {
  if (!global.__botState) {
    global.__botState = { process: null, logs: [], startedAt: null, pid: null }
  }
  return global.__botState
}

function appendLog(line: string) {
  const state = getState()
  const ts = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
  state.logs.push(`[${ts}] ${line}`)
  if (state.logs.length > 200) state.logs = state.logs.slice(-150)
}

export function startBot(env: Record<string, string>): { ok: boolean; error?: string } {
  const state = getState()
  if (state.process && !state.process.killed) {
    return { ok: false, error: 'Bot zaten çalışıyor.' }
  }

  // Build path at runtime to prevent Turbopack static analysis
  const botDir  = path.resolve(process.cwd(), '..', 'bot')
  const botFile = path.resolve(botDir, ['index', 'js'].join('.'))

  // Merge process.env with provided overrides; expose web/node_modules to bot
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    NODE_PATH: path.join(process.cwd(), 'node_modules'),
  }

  try {
    const child = spawn('node', [botFile], {
      cwd:   botDir,
      env:   mergedEnv,
      stdio: 'pipe',
    })

    state.process   = child
    state.startedAt = new Date()
    state.pid       = child.pid ?? null
    state.logs      = []

    child.stdout?.on('data', (data: Buffer) => {
      String(data).split('\n').filter(Boolean).forEach(appendLog)
    })
    child.stderr?.on('data', (data: Buffer) => {
      String(data).split('\n').filter(Boolean).forEach((l) => appendLog(`⚠️ ${l}`))
    })
    child.on('exit', (code: number | null) => {
      appendLog(`🔴 Bot durdu (exit: ${code ?? 'signal'})`)
      state.process = null
      state.pid     = null
    })
    child.on('error', (err: Error) => {
      appendLog(`❌ Hata: ${err.message}`)
      state.process = null
      state.pid     = null
    })

    appendLog('🟢 Bot başlatıldı.')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export function stopBot(): { ok: boolean; error?: string } {
  const state = getState()
  if (!state.process || state.process.killed) {
    return { ok: false, error: 'Bot zaten durmuş.' }
  }
  state.process.kill('SIGTERM')
  appendLog('⏹ Bot durduruldu.')
  state.process = null
  state.pid     = null
  return { ok: true }
}

export function getBotStatus() {
  const state = getState()
  const running = !!(state.process && !state.process.killed)
  return {
    running,
    pid:       state.pid,
    startedAt: state.startedAt?.toISOString() ?? null,
    logs:      state.logs.slice(-60),
  }
}
