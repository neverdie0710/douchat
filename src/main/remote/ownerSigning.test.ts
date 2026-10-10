import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { expect, it } from 'vitest'
import { canonicalJson, ownerSignedBytes, sha256Hex, signCommand, SIGNATURE_LIFETIME_MS } from './ownerSigning'
import { approvalDecision, MAX_REMOTE_APPROVALS_PER_HOST, RemoteApprovals } from './remoteApprovals'

it('encodes canonical JSON with sorted keys and without undefined members', () => {
  expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 0, y: -1.5 } })).toBe('{"a":[true,null,"x"],"b":1,"d":{"y":-1.5,"z":0}}')
  expect(() => canonicalJson({ n: Number.NaN })).toThrow()
  expect(() => canonicalJson({ n: Infinity })).toThrow()
})

it('signs an owner command the service and host can verify', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const signer = { getDeviceId: () => 'dev_1', signAsDevice: (message: string) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url') }
  const signed = signCommand(signer, { serviceUrl: 'https://douchat.ai/some/path', ownerId: 'u1', hostId: 'hst_1', method: 'task.cancel', payload: { taskId: 't', skip: undefined }, now: 1000 })
  expect(signed.envelope).toMatchObject({ v: 1, origin: 'https://douchat.ai', ownerId: 'u1', hostId: 'hst_1', deviceId: 'dev_1', method: 'task.cancel', issuedAt: 1000, expiresAt: 1000 + SIGNATURE_LIFETIME_MS })
  expect(signed.payload).toEqual({ taskId: 't' })
  expect(signed.envelope.payloadHash).toBe(sha256Hex('{"taskId":"t"}'))
  expect(ownerSignedBytes(signed.envelope).startsWith('douchat-owner-v1\n{')).toBe(true)
  expect(verify(null, Buffer.from(ownerSignedBytes(signed.envelope)), publicKey, Buffer.from(signed.signature, 'base64url'))).toBe(true)
  expect(signed.signature).toHaveLength(86)
  // Each command has its own request id, so a replay is detectable.
  expect(signCommand(signer, { serviceUrl: 'https://douchat.ai', ownerId: 'u1', hostId: '', method: 'x', payload: {} }).envelope.requestId).not.toBe(signed.envelope.requestId)
})

it('refuses to sign without a device identity', () => {
  expect(() => signCommand({ getDeviceId: () => undefined, signAsDevice: () => '' }, { serviceUrl: 'https://douchat.ai', ownerId: 'u', hostId: 'h', method: 'm', payload: {} })).toThrow()
})

const approval = (id: string, extra: Record<string, unknown> = {}) => ({ id: `task-${id}:approval:${id}`, hostId: 'hst_a', taskId: `task-${id}`, bindingRevision: 1, claimHash: 'c', requestId: `r${id}`,
  capability: 'localExecution', operation: 'Bash', details: 'ls', requester: 'Alice', paramsHash: 'p', createdAt: Number(id), expiresAt: 10_000, ...extra })
const context = { ownerId: 'u1', agentId: 'agent-1', agentName: 'Codex', roomName: 'Codex', context: 'direct' as const, executorLabel: 'dev-box' }

it('mirrors the latest host approvals snapshot with an executor label', () => {
  const approvals = new RemoteApprovals()
  expect(approvals.sync([{ content: approval('2'), context }, { content: approval('1'), context }, { content: { id: 'bad' }, context }, { content: approval('3', { expiresAt: 5 }), context }], 100)).toBe(true)
  const list = approvals.snapshot(100)
  expect(list.map(item => item.id)).toEqual(['remote:task-1:approval:1', 'remote:task-2:approval:2'])
  expect(list[0]).toMatchObject({ agentId: 'agent-1', executorLabel: 'dev-box', expiresAt: 10_000, capability: 'localExecution', requester: 'Alice' })
  expect(approvals.get('remote:task-1:approval:1')?.requestId).toBe('r1')
  // Missing from the next snapshot means answered elsewhere, expired or ended.
  approvals.sync([{ content: approval('2'), context }], 100)
  expect(approvals.snapshot(100).map(item => item.id)).toEqual(['remote:task-2:approval:2'])
  expect(approvals.snapshot(20_000)).toEqual([])
})

it('caps approvals per host and maps decisions', () => {
  const approvals = new RemoteApprovals()
  approvals.sync(Array.from({ length: MAX_REMOTE_APPROVALS_PER_HOST + 5 }, (_, index) => ({ content: approval(String(index + 1)), context })), 0)
  expect(approvals.snapshot(0)).toHaveLength(MAX_REMOTE_APPROVALS_PER_HOST)
  expect(approvalDecision(true)).toEqual({ decision: 'allow', scope: 'once' })
  expect(approvalDecision('task')).toEqual({ decision: 'allow', scope: 'task' })
  expect(approvalDecision('session')).toEqual({ decision: 'allow', scope: 'session' })
  expect(approvalDecision(false)).toEqual({ decision: 'deny', scope: 'once' })
})
