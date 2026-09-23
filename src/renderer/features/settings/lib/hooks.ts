import { useCallback, useEffect, useRef, useState } from 'react'

/** Debounced callback with an explicit flush that also runs on unmount, so edits are never lost. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number): { call: (...args: A) => void; flush: () => void } {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<A | null>(null)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current) { const a = pending.current; pending.current = null; fnRef.current(...a) }
  }, [])
  const call = useCallback((...args: A) => {
    pending.current = args
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, ms)
  }, [flush, ms])
  useEffect(() => flush, [flush])
  return { call, flush }
}

/** Re-render every `ms` (relative timestamps such as “Synced 2 min ago”). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

/** Show a value briefly (e.g. the “Saved” tick). */
export function useFlash(ms = 1600): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trigger = useCallback(() => { setOn(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setOn(false), ms) }, [ms])
  useEffect(() => () => { if (t.current) clearTimeout(t.current) }, [])
  return [on, trigger]
}

export function safeLocalGet(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
export function safeLocalSet(key: string, value: string): void { try { localStorage.setItem(key, value) } catch { /* ignore */ } }
