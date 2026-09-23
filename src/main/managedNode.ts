import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, delimiter } from 'node:path'
import { promisify } from 'node:util'
const execute = promisify(execFile)
const version = '24.21.0'
// Pinned against https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
const checksums: Record<string, string> = {
  'darwin-arm64': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  'darwin-x64': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
  'linux-arm64': '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
  'linux-x64': '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
  'win32-arm64': '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921',
  'win32-x64': '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
}
let root = ''
let pending: Promise<void> | undefined
export function configureManagedNode(userData: string): void { root = join(userData, 'local-tools') }
export function managedNodePaths() {
  if (!root) throw new Error("The local runtime has not been initialized.")
  const runtime = join(root, `node-${version}-${process.platform}-${process.arch}`)
  const bin = process.platform === 'win32' ? runtime : join(runtime, 'bin')
  const prefix = join(root, 'agents')
  return { runtime, bin, prefix, agentBin: process.platform === 'win32' ? prefix : join(prefix, 'bin'),
    node: join(bin, process.platform === 'win32' ? 'node.exe' : 'node'),
    npm: join(runtime, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm/bin/npm-cli.js') }
}
export function managedSearchPaths(): string[] { return root ? [managedNodePaths().agentBin, managedNodePaths().bin] : [] }
export function compatibleNodeVersion(value: string): boolean {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return Boolean(match && (Number(match[1]) >= 24 || (Number(match[1]) === 22 && Number(match[2]) >= 19)))
}
export function verifyNodeArchive(bytes: Uint8Array, expected: string): void {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error("Runtime download verification failed. Try again.")
}
async function usable(node: string, npm: string): Promise<boolean> {
  try {
    await access(npm)
    const { stdout } = await execute(node, ['--version'], { timeout: 5000, windowsHide: true })
    if (!compatibleNodeVersion(stdout)) return false
    await execute(node, [npm, '--version'], { timeout: 5000, windowsHide: true, env: { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` } })
    return true
  } catch { return false }
}
export async function selectNodeEnvironment(resolve: (command: string) => Promise<string | undefined>) {
  const own = managedNodePaths()
  const node = await resolve(process.platform === 'win32' ? 'node.exe' : 'node')
  const npmLauncher = await resolve(process.platform === 'win32' ? 'npm.cmd' : 'npm')
  if (node && npmLauncher) {
    const npm = process.platform === 'win32' ? join(dirname(npmLauncher), 'node_modules/npm/bin/npm-cli.js') : await realpath(npmLauncher).catch(() => '')
    if (await usable(node, npm)) return { node, npm, needsDownload: false }
  }
  return { node: own.node, npm: own.npm, needsDownload: !(await usable(own.node, own.npm)) }
}
export async function ensureManagedNode(): Promise<void> {
  pending ??= install().finally(() => { pending = undefined })
  return pending
}
async function install(): Promise<void> {
  const paths = managedNodePaths()
  if (await usable(paths.node, paths.npm)) return
  const hash = checksums[`${process.platform}-${process.arch}`]
  if (!hash) throw new Error("Automatic Node.js setup does not support this architecture. Install Node.js 24 manually.")
  await mkdir(root, { recursive: true })
  const staging = await mkdtemp(join(root, '.node-download-'))
  const name = `node-v${version}-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const archive = join(staging, process.platform === 'win32' ? 'node.zip' : 'node.tar.gz')
  try {
    const response = await fetch(`https://nodejs.org/dist/v${version}/${name}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`, { signal: AbortSignal.timeout(180000), redirect: 'error' })
    if (!response.ok) throw new Error(`Runtime download failed (${response.status}). Check your connection and try again.`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    verifyNodeArchive(bytes, hash)
    await writeFile(archive, bytes)
    if (process.platform === 'win32') {
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const script = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(staging)}`
      await execute('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 120000, windowsHide: true })
    } else {
      await execute('/usr/bin/tar', ['-xzf', archive, '-C', staging], { timeout: 120000 })
    }
    // Remove only a broken copy of this pinned runtime, never the agent prefix.
    await rm(paths.runtime, { recursive: true, force: true })
    await rename(join(staging, name), paths.runtime)
    if (!(await usable(paths.node, paths.npm))) throw new Error("The runtime could not start. Check system compatibility.")
  } finally { await rm(staging, { recursive: true, force: true }) }
}
