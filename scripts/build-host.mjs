// Builds the douchat-host release: host/dist/{douchat-host.mjs, install.sh, manifest.json}.
//   node scripts/build-host.mjs [--publish <dir>]
// --publish also copies the three files into <dir>, e.g. ../douchat-tanstack/public/host
// so the service serves them at <service>/host/ (the default download address).
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'host', 'dist')
const version = /export const HOST_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'host', 'src', 'cli.ts'), 'utf8'))?.[1]
if (!version) throw new Error('HOST_VERSION not found in host/src/cli.ts')

mkdirSync(dist, { recursive: true })
await build({
  entryPoints: [join(root, 'host', 'src', 'cli.ts')],
  outfile: join(dist, 'douchat-host.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning'
})
copyFileSync(join(root, 'host', 'install.sh'), join(dist, 'install.sh'))
chmodSync(join(dist, 'install.sh'), 0o755)
const sha256 = createHash('sha256').update(readFileSync(join(dist, 'douchat-host.mjs'))).digest('hex')
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ version, sha256, minNode: 20, builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log(`douchat-host ${version} → ${dist} (sha256 ${sha256.slice(0, 12)}…)`)

const at = process.argv.indexOf('--publish')
if (at >= 0) {
  const target = resolve(process.argv[at + 1] ?? '')
  if (!process.argv[at + 1]) throw new Error('--publish needs a directory')
  mkdirSync(target, { recursive: true })
  for (const file of ['douchat-host.mjs', 'install.sh', 'manifest.json']) copyFileSync(join(dist, file), join(target, file))
  console.log(`published to ${target}`)
}
