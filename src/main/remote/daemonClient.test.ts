import { createHash, generateKeyPairSync } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentPermissions } from '../../shared/agentPermissions'
import type { AgentConfig } from '../../shared/types'
import { deviceFingerprint, enrollmentToken, hostAgentConfig, hostDownloadBase, installCommand } from './daemonClient'

const publicKey = (generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) as { x: string }).x

it('builds a one-time install command carrying the owner device key', () => {
  const token = enrollmentToken({ serviceUrl: 'https://douchat.ai', ticket: 'det_abcdefghijklmnopqrstuvwxyz', hostId: 'hst_00000000-0000-4000-8000-000000000000', devicePublicKey: publicKey, deviceId: 'dev_1', ownerId: 'u1', exp: 123 })
  expect(token).toMatch(/^dch1_[A-Za-z0-9_-]+$/)
  const body = JSON.parse(Buffer.from(token.slice(5), 'base64url').toString('utf8'))
  expect(body).toEqual({ v: 1, serviceUrl: 'https://douchat.ai', ticket: 'det_abcdefghijklmnopqrstuvwxyz', hostId: 'hst_00000000-0000-4000-8000-000000000000', ownerId: 'u1',
    devicePublicKey: publicKey, deviceId: 'dev_1', fingerprint: deviceFingerprint(publicKey), exp: 123 })
  expect(installCommand(token, 'https://douchat.ai/host')).toBe(`curl -fsSL 'https://douchat.ai/host/install.sh' | DOUCHAT_HOST_URL='https://douchat.ai/host' DOUCHAT_ENROLL='${token}' sh`)
})

it('serves the host bundle from the service unless overridden, over HTTPS only', () => {
  expect(hostDownloadBase('https://douchat.ai', '')).toBe('https://douchat.ai/host')
  expect(hostDownloadBase('http://localhost:3000', undefined)).toBe('http://localhost:3000/host')
  expect(hostDownloadBase('https://douchat.ai', 'https://cdn.example.com/host/')).toBe('https://cdn.example.com/host')
  expect(() => hostDownloadBase('https://douchat.ai', 'http://cdn.example.com/host')).toThrow(/HTTPS/)
})

it('fingerprints the raw public key bytes', () => {
  const hex = createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex')
  expect(deviceFingerprint(publicKey)).toBe(hex.slice(0, 16).match(/.{4}/g)!.join('-'))
  expect(deviceFingerprint(publicKey)).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/)
})

it('sends a host only enabled skills, without files, and derives sharing from permissions', () => {
  const agent = { id: 'a1', name: 'Codex', role: 'Dev', instructions: 'Be brief', color: '#123456', provider: 'local', model: 'default', revision: 4, startupArgs: ['--x'],
    skills: [{ id: 's1', name: 'One', enabled: true, files: [{ path: 'a' }], directory: '/tmp/x' }, { id: 's2', name: 'Two', enabled: false }] } as unknown as AgentConfig
  const config = hostAgentConfig(agent, { adapter: 'codex', executable: 'codex', args: ['--a'] })
  expect(config).toMatchObject({ localId: 'a1', configRevision: 4, permissionsRevision: 4, adapter: 'codex', args: ['--a', '--x'], allowSharing: true })
  expect(config.skills).toEqual([{ id: 's1', name: 'One', enabled: true }])
  const closed = { ...agent, permissions: { ...agentPermissions(), groupHumans: 'deny', groupAgents: 'deny' } } as AgentConfig
  expect(hostAgentConfig(closed, { adapter: 'codex', executable: 'codex', args: [] }).allowSharing).toBe(false)
  const agentsOnly = { ...agent, permissions: { ...agentPermissions(), groupHumans: 'deny', groupAgents: 'ask' } } as AgentConfig
  expect(hostAgentConfig(agentsOnly, { adapter: 'codex', executable: 'codex', args: [] }).allowSharing).toBe(true)
})
