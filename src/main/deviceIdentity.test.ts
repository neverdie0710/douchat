import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DEVICE_LOGIN_DOMAIN, DeviceIdentity, MAX_LOGIN_DEVICES, type SecretStorage } from './deviceIdentity'

const storage: SecretStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: data => data.toString() }
let directory = '', path = ''
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'douchat-device-')); path = join(directory, 'device.json') })
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const valid = (proof: { publicKey: string; signature: string }, code: string) =>
  verify(null, Buffer.from(DEVICE_LOGIN_DOMAIN + code), createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: proof.publicKey }, format: 'jwk' }), Buffer.from(proof.signature, 'base64url'))

it('keeps a key per account: each login offers the stored keys and a spare', async () => {
  const device = new DeviceIdentity(path, storage)
  const first = await device.loginProofs('code-a')
  expect(first).toHaveLength(1)
  expect(valid(first[0], 'code-a')).toBe(true)
  expect(await device.adopt(first[0].id)).toBe(true)
  expect(device.id).toBe(first[0].id)

  // Another account: the first key is bound elsewhere, so the service binds the spare.
  const other = new DeviceIdentity(path, storage)
  const second = await other.loginProofs('code-b')
  expect(second).toHaveLength(2)
  expect(second[0].id).toBe(first[0].id)
  expect(second.every(item => valid(item, 'code-b'))).toBe(true)
  const spare = second[1]
  expect(await other.adopt(spare.id)).toBe(true)

  // Both survive a restart, most recent first, and each session signs with its own.
  const restarted = new DeviceIdentity(path, storage)
  expect(await restarted.use(first[0].id)).toBe(true)
  expect(restarted.publicKey).toBe(first[0].publicKey)
  expect((JSON.parse(readFileSync(path, 'utf8')) as { devices: { id: string }[] }).devices.map(item => item.id)).toEqual([spare.id, first[0].id])
  expect(await restarted.use('dev_00000000-0000-0000-0000-000000000000')).toBe(false)
  expect(() => restarted.sign('x')).toThrow()
})

it('reads the single key older versions stored and never adopts an unoffered id', async () => {
  const device = new DeviceIdentity(path, storage)
  const [proof] = await device.loginProofs('code')
  await device.adopt(proof.id)
  const stored = JSON.parse(readFileSync(path, 'utf8')) as { devices: object[] }
  writeFileSync(path, JSON.stringify({ version: 1, ...stored.devices[0] }))
  const upgraded = new DeviceIdentity(path, storage)
  expect(await upgraded.use(proof.id)).toBe(true)
  expect(await upgraded.adopt('dev_00000000-0000-0000-0000-000000000000')).toBe(false)
})

it('offers at most the service limit and has no identity without secure storage', async () => {
  const device = new DeviceIdentity(path, storage)
  for (let index = 0; index < MAX_LOGIN_DEVICES + 2; index += 1) {
    const proofs = await device.loginProofs(`code-${index}`)
    expect(proofs.length).toBeLessThanOrEqual(MAX_LOGIN_DEVICES)
    await device.adopt(proofs[proofs.length - 1].id)
  }
  expect(await new DeviceIdentity(path, { ...storage, isEncryptionAvailable: () => false }).loginProofs('code')).toEqual([])
})
