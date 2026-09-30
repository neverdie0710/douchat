import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Same character rules as the host validator in remoteValidate. */
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/

/** Read-only list of concrete Host aliases from ~/.ssh/config and its
 * Include files. Only alias names are returned: no keys, users or addresses.
 * Wildcard and negated patterns are skipped. */
export async function listSshHosts(home = homedir()): Promise<string[]> {
  const hosts = new Set<string>()
  const seen = new Set<string>()
  const root = join(home, '.ssh')
  const visit = async (file: string, depth: number): Promise<void> => {
    if (depth > 8 || seen.has(file) || seen.size > 64) return
    seen.add(file)
    let text: string
    try { text = await readFile(file, 'utf8') } catch { return }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim()
      const match = /^(\S+)\s*(?:=\s*|\s+)(.+)$/.exec(line)
      if (!match) continue
      const keyword = match[1].toLowerCase()
      const values = match[2].split(/\s+/).map(value => value.replace(/^"|"$/g, ''))
      if (keyword === 'host') {
        for (const value of values) if (ALIAS.test(value)) hosts.add(value)
      } else if (keyword === 'include') {
        for (const value of values) {
          // Globs in Include are rare; only literal files are followed.
          if (/[*?[\]]/.test(value)) continue
          const path = value.startsWith('~/') ? join(home, value.slice(2)) : isAbsolute(value) ? value : join(root, value)
          await visit(path, depth + 1)
        }
      }
    }
  }
  await visit(join(root, 'config'), 0)
  return [...hosts].slice(0, 500)
}
