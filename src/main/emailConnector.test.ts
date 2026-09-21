import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

import type { EmailConnectorAccount } from '../shared/types'
import { EmailConnectorManager } from './emailConnector'
import { DouchatStore } from './store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function mailbox(id: string, agentIds: string[] = []): EmailConnectorAccount {
  return {
    id,
    kind: 'email',
    name: 'Work mailbox',
    email: 'work@example.com',
    username: 'work@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    agentIds,
    status: 'connected',
    updatedAt: 1
  }
}

describe('email connector account isolation', () => {
  it('lets only the connector owner migrate and decrypt a legacy credential', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'douchat-email-account-'))
    directories.push(directory)
    const store = new DouchatStore(join(directory, 'douchat.db'))
    const first = store.ensureDefaultCloudContact('user-1', { provider: 'gateway', model: 'default' }).agent!
    store.setConnectors([mailbox('mail-1', [first.id])])
    store.ensureDefaultCloudContact('user-2', { provider: 'gateway', model: 'default' })
    const credentialPath = join(directory, 'email-connectors.json')
    const credential = { username: 'work@example.com', password: 'private-password' }
    await writeFile(credentialPath, JSON.stringify({
      'mail-1': Buffer.from(JSON.stringify(credential)).toString('base64')
    }))
    const manager = new EmailConnectorManager(store, directory) as unknown as {
      credential: (connectorId: string) => Promise<typeof credential | undefined>
    }

    expect(await manager.credential('mail-1')).toBeUndefined()
    expect(JSON.parse(await readFile(credentialPath, 'utf8'))).toHaveProperty('mail-1')

    store.setCurrentAccountId('user-1')
    await expect(manager.credential('mail-1')).resolves.toEqual(credential)
    const migrated = JSON.parse(await readFile(credentialPath, 'utf8')) as Record<string, string>
    expect(migrated['user-1:mail-1']).toBeTruthy()
    expect(migrated['mail-1']).toBeUndefined()

    store.setCurrentAccountId('user-2')
    store.setConnectors([mailbox('mail-1')])
    expect(await manager.credential('mail-1')).toBeUndefined()
  })
})
