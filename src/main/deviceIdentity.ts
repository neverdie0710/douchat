import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The subset of Electron's safeStorage this module needs; injectable for tests. */
export interface SecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

interface StoredDevice {
  version: 1
  id: string
  publicKey: string
  encryptedPrivateKey: string
}

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
 * This computer's owner-device identity (remote-connections.md 6.8.1):
 * `dev_<uuid>` plus an Ed25519 key. The private key is encrypted with the OS
 * secure storage and never leaves the main process. Clearing secure storage
 * makes a new device, which hosts must trust again.
 */
export class DeviceIdentity {
  private loaded?: { id: string; publicKey: string; privateKey: KeyObject }
  private loading?: Promise<{ id: string; publicKey: string } | undefined>

  constructor(private readonly path: string, private readonly storage: SecretStorage) {}

  /** The current identity, created on first use. Undefined when secure storage is unavailable. */
  load(): Promise<{ id: string; publicKey: string } | undefined> {
    if (this.loaded) return Promise.resolve({ id: this.loaded.id, publicKey: this.loaded.publicKey })
    this.loading ??= this.readOrCreate().finally(() => { this.loading = undefined })
    return this.loading
  }

  get id(): string | undefined { return this.loaded?.id }
  get publicKey(): string | undefined { return this.loaded?.publicKey }

  /** Signs with the device key; load() must have succeeded. */
  sign(message: string): string {
    if (!this.loaded) throw new Error('This device has no secure identity. Sign in again.')
    return signUtf8(this.loaded.privateKey, message)
  }

  /** Proof submitted with a desktop login code. */
  async loginProof(code: string): Promise<{ id: string; publicKey: string; signature: string } | undefined> {
    const identity = await this.load().catch(() => undefined)
    if (!identity) return undefined
    return { ...identity, signature: this.sign(DEVICE_LOGIN_DOMAIN + code) }
  }

  private async readOrCreate(): Promise<{ id: string; publicKey: string } | undefined> {
    if (!this.storage.isEncryptionAvailable()) return undefined
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8')) as StoredDevice
      if (stored.version === 1 && DEVICE_ID.test(stored.id) && PUBLIC_KEY.test(stored.publicKey)) {
        const privateKey = createPrivateKey(this.storage.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64')))
        if (rawPublicKey(createPublicKey(privateKey)) === stored.publicKey) {
          this.loaded = { id: stored.id, publicKey: stored.publicKey, privateKey }
          return { id: stored.id, publicKey: stored.publicKey }
        }
      }
    } catch { /* Missing or unreadable: this computer becomes a new device. */ }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const id = `dev_${randomUUID()}`
    const raw = rawPublicKey(publicKey)
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const stored: StoredDevice = { version: 1, id, publicKey: raw, encryptedPrivateKey: this.storage.encryptString(pem).toString('base64') }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(stored), { mode: 0o600 })
    await rename(temporary, this.path)
    this.loaded = { id, publicKey: raw, privateKey }
    return { id, publicKey: raw }
  }
}
