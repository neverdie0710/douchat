// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { reportDiagnostic } from './diagnostics'

it('captures uncaught errors and rejected promises without serializing arbitrary payloads', () => {
  const report = vi.fn()
  const previous = window.douchat
  Object.assign(window, { douchat: { reportDiagnostic: report } })
  try {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('settings failed') }))
    expect(report).toHaveBeenCalledWith('renderer.error', expect.stringContaining('settings failed'))
    const rejection = new Event('unhandledrejection')
    Object.assign(rejection, { reason: { token: 'private' } })
    window.dispatchEvent(rejection)
    expect(report).toHaveBeenCalledWith('renderer.unhandledrejection', expect.stringContaining('payload omitted'))
    expect(JSON.stringify(report.mock.calls)).not.toContain('private')
    report.mockImplementation(() => { throw new Error('IPC unavailable') })
    expect(() => reportDiagnostic('test')).not.toThrow()
  } finally { window.douchat = previous }
})
