import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

// Only probe the bundled engine, never launch the desktop GUI as a CLI.
export function codexDesktopCandidates(platform: string, home: string, env: NodeJS.ProcessEnv, discovered: string[] = []): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'darwin') {
    return [...new Set(['/Applications/Codex.app', p.join(home, 'Applications/Codex.app'), ...discovered])]
      .map(root => p.join(root, 'Contents/Resources/codex'))
  }
  if (platform !== 'win32') return []
  const roots = [
    ...(env.LOCALAPPDATA ? [p.join(env.LOCALAPPDATA, 'Programs/Codex'), p.join(env.LOCALAPPDATA, 'Codex')] : []),
    ...(env.ProgramFiles ? [p.join(env.ProgramFiles, 'Codex')] : []),
    ...discovered
  ]
  return [...new Set(roots)].flatMap(root => [p.join(root, 'resources/codex.exe'), p.join(root, 'app/resources/codex.exe')])
}

async function installationLocations(): Promise<string[]> {
  try {
    const options = { timeout: 2500, killSignal: 'SIGKILL' as const, windowsHide: true, maxBuffer: 65536 }
    const result = process.platform === 'darwin'
      ? await execute('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "com.openai.codex"'], options)
      : process.platform === 'win32'
        ? await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Get-AppxPackage -Name "*Codex*" | Select-Object -ExpandProperty InstallLocation'], options)
        : undefined
    return (result?.stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => path.isAbsolute(line)).slice(0, 16)
  } catch { return [] }
}

export async function findCodexDesktopExecutable(): Promise<string | undefined> {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined
  const probe = async (candidates: string[]): Promise<string | undefined> => {
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK)
        const { stdout } = await execute(candidate, ['--version'], { timeout: 1500, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 4096 })
        if (/^codex(?:-cli)?\s+\d+\./im.test(stdout)) return candidate
      } catch { /* An inaccessible, stale or incompatible installation is not ready. */ }
    }
    return undefined
  }
  const known = codexDesktopCandidates(process.platform, homedir(), process.env)
  const found = await probe(known)
  if (found) return found
  const discovered = codexDesktopCandidates(process.platform, homedir(), process.env, await installationLocations())
  return probe(discovered.filter(candidate => !known.includes(candidate)))
}
