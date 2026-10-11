import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiagnosticLog } from './diagnostics'

describe('diagnostic files', () => {
  it('persists errors with timestamps, redacts credentials and rotates the previous file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-log-'))
    try {
      const log = new DiagnosticLog(directory, 500)
      log.write('renderer.error', 'Error: failed\n at SettingsPanel Bearer abc api_key=xyz https://example.com/?token=123')
      const first = readFileSync(log.file, 'utf8')
      const entry = JSON.parse(first)
      expect(entry.event).toBe('renderer.error')
      expect(entry.time).toMatch(/^\d{4}-/)
      expect(entry.detail).toContain('SettingsPanel')
      for (const secret of ['abc', 'xyz', 'token=123']) expect(first).not.toContain(secret)
      log.write('large', 'x'.repeat(400))
      expect(readFileSync(`${log.file}.1`, 'utf8')).toBe(first)
      log.write('next', 'y'.repeat(400))
      expect(JSON.parse(readFileSync(`${log.file}.1`, 'utf8')).event).toBe('large')
      expect(JSON.parse(readFileSync(log.file, 'utf8')).event).toBe('next')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('does not throw when the log directory cannot be created', () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-log-'))
    try {
      const file = join(directory, 'file')
      writeFileSync(file, '')
      expect(() => new DiagnosticLog(file).write('error', 'failed')).not.toThrow()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
