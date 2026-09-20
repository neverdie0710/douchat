import { useSyncExternalStore } from 'react'

/**
 * Every sidebar shares one width — the chat list, the contact book and
 * settings — so moving between rails never slides the content underneath you.
 * Kept beside `preferences.ts` and built the same way: a module-level value,
 * written straight to a CSS variable, read by React where a number is needed.
 */
const key = 'douchat.sidebar-width'
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 360
export const SIDEBAR_DEFAULT = 244

function read(): number {
  const saved = Number(globalThis.localStorage?.getItem(key))
  return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT
}

let current = read()
const listeners = new Set<() => void>()

function apply(): void {
  document.documentElement.style.setProperty('--sidebar-width', `${current}px`)
}

export function setSidebarWidth(width: number): void {
  const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)))
  if (next === current) return
  current = next
  globalThis.localStorage?.setItem(key, String(current))
  apply()
  listeners.forEach((notify) => notify())
}

window.addEventListener('storage', (event) => {
  if (event.key !== key) return
  current = read()
  apply()
  listeners.forEach((notify) => notify())
})

// Applied on import, so the first paint already has the stored width rather
// than flashing the default and snapping.
apply()

export function useSidebarWidth(): number {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    () => current
  )
}
