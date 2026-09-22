/** Logging must remain safe even when preload is unavailable. Never include app state. */
export function reportDiagnostic(event: string, detail = ''): void {
  try { window.douchat?.reportDiagnostic?.(event, detail.slice(0, 15000)) } catch { /* best effort */ }
}
export function reportError(event: string, error: unknown, componentStack = ''): void {
  const detail = error instanceof Error ? error.stack || error.message : typeof error === 'string' ? error : 'Non-Error rejection (payload omitted)'
  reportDiagnostic(event, `${detail}\n${componentStack}`)
}
if (typeof window !== 'undefined') window.addEventListener('error', (event) => {
  reportError('renderer.error', event.error || event.message || 'Resource failed to load')
}, true)
if (typeof window !== 'undefined') window.addEventListener('unhandledrejection', (event) => reportError('renderer.unhandledrejection', event.reason))
