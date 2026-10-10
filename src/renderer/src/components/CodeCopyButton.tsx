import { useEffect, useRef, useState } from 'react'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { t } from '../preferences'

export function CodeCopyButton({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await window.douchat.copyText(code)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 2500)
  }
  const label = t(state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy code' : 'Copy code')
  return <button type="button" data-streamdown="code-block-copy-button" data-copy-state={state} title={label} aria-label={label} onClick={() => void copy()}>
    {state === 'copied' ? <Check size={14} /> : state === 'failed' ? <TriangleAlert size={14} /> : <Copy size={14} />}
    <span aria-live="polite">{state === 'idle' ? null : label}</span>
  </button>
}
