import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The subset of Electron's safeStorage this module needs; injectable for tests. */
export interface SecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

interface StoredKey {
  id: string
  publicKey: string
  encryptedPrivateKey: string
}
/** Version 1 held one key; version 2 holds one per account, most recently used first. */
type StoredFile = ({ version: 1 } & StoredKey) | { version: 2; devices: StoredKey[] }
interface Key { id: string; publicKey: string; privateKey: KeyObject }
type Proof = { id: string; publicKey: string; signature: string }

/** Matches the service's MAX_LOGIN_DEVICES: the stored keys plus one spare. */
export const MAX_LOGIN_DEVICES = 8

export const DEVICE_LOGIN_DOMAIN = 'douchat-device-v1\n'
const DEVICE_ID = /^dev_[0-9a-f-]{36}$/
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/

/** Raw 32-byte Ed25519 public key as base64url (43 characters). */
export function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' }) as { x?: string }
  if (!jwk.x || !PUBLIC_KEY.test(jwk.x)) throw new Error('Invalid device key')
  return jwk.x
}

/** Ed25519 signature over UTF-8 bytes, base64url (86 characters). */
export function signUtf8(privateKey: KeyObject, message: string): string {
  return sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url')
}

/**
 * This computer's owner-device identities (remote-connections.md 6.8.1):
 * `dev_<uuid>` plus an Ed25519 key. The service binds a device to one account
 * for good, so the computer keeps a key per account it signed in with. Every
 * login offers all of them plus a spare; the service picks the one bound to
 * that account, or binds the spare. Private keys are encrypted with the OS
 * secure storage and never leave the main process. Clearing secure storage
 * makes new devices, which hosts must trust again.
 */
export class DeviceIdentity {
  private active?: Key
  private spare?: Key

  constructor(private readonly path: string, private readonly storage: SecretStorage) {}

  get id(): string | undefined { return this.active?.id }
  get publicKey(): string | undefined { return this.active?.publicKey }

  /** Makes the stored key `id` the one this session signs with. */
  async use(id: string): Promise<boolean> {
    this.active = (await this.read()).find(key => key.id === id)
    return Boolean(this.active)
  }

  /** Signs with the session's device key; use() or adopt() must have succeeded. */
  sign(message: string): string {
    if (!this.active) throw new Error('This device has no secure identity. Sign in again.')
    return signUtf8(this.active.privateKey, message)
  }

  /** Proofs submitted with a desktop login code: every stored key, then a new spare. Empty without secure storage. */
  async loginProofs(code: string): Promise<Proof[]> {
    if (!this.storage.isEncryptionAvailable()) return []
    const keys = (await this.read()).slice(0, MAX_LOGIN_DEVICES - 1)
    this.spare = newKey()
    return [...keys, this.spare].map(key => ({ id: key.id, publicKey: key.publicKey, signature: signUtf8(key.privateKey, DEVICE_LOGIN_DOMAIN + code) }))
  }

  /** The service bound `id` to the signed-in account: keep it (first, as most recent) and sign with it. */
  async adopt(id: string): Promise<boolean> {
    const keys = await this.read()
    const key = keys.find(item => item.id === id) ?? (this.spare?.id === id ? this.spare : undefined)
    if (!key) return false
    this.spare = undefined
    await this.write([key, ...keys.filter(item => item.id !== id)].slice(0, MAX_LOGIN_DEVICES - 1))
    this.active = key
    return true
  }

  private async read(): Promise<Key[]> {
    if (!this.storage.isEncryptionAvailable()) return []
    let stored: StoredFile
    try { stored = JSON.parse(await readFile(this.path, 'utf8')) as StoredFile } catch { return [] }
    const items = stored.version === 2 && Array.isArray(stored.devices) ? stored.devices : stored.version === 1 ? [stored] : []
    const keys: Key[] = []
    for (const item of items) {
      try {
        if (!DEVICE_ID.test(item.id) || !PUBLIC_KEY.test(item.publicKey)) continue
        const privateKey = createPrivateKey(this.storage.decryptString(Buffer.from(item.encryptedPrivateKey, 'base64')))
        if (rawPublicKey(createPublicKey(privateKey)) === item.publicKey) keys.push({ id: item.id, publicKey: item.publicKey, privateKey })
      } catch { /* Unreadable key: skipped; its account binds a new one at the next login. */ }
    }
    return keys
  }

  private async write(keys: Key[]): Promise<void> {
    const stored: StoredFile = { version: 2, devices: keys.map(key => ({ id: key.id, publicKey: key.publicKey,
      encryptedPrivateKey: this.storage.encryptString(key.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64') })) }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(stored), { mode: 0o600 })
    await rename(temporary, this.path)
  }
}

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { id: `dev_${randomUUID()}`, publicKey: rawPublicKey(publicKey), privateKey }
}
