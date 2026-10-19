// `make dev`: the local Douchat service and the web app with live reload,
// reachable from this computer and from phones on the same Wi-Fi.
//
// Phones cannot reach localhost, and the web app runs on an app.* host that
// signs in on the main site. nip.io names keep that shape on the LAN:
//   web app  http://app.<lan-ip>.nip.io:5276
//   site     http://<lan-ip>.nip.io:3004   (sign-in, credits)
// Both resolve to this computer from any device. The service accepts these
// sign-in returns only in development.
//
//   DOUCHAT_TANSTACK_DIR  the douchat-tanstack checkout (default ../douchat-tanstack)
//   DOUCHAT_SERVICE_PORT / DOUCHAT_WEB_PORT  ports (default 3004 / 5276)
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const SERVICE_PORT = Number(process.env.DOUCHAT_SERVICE_PORT || 3004)
const WEB_PORT = Number(process.env.DOUCHAT_WEB_PORT || 5276)
const tanstack = resolve(process.env.DOUCHAT_TANSTACK_DIR || '../douchat-tanstack')

/** This computer's LAN address, preferring Wi-Fi/Ethernet on a private range. */
function lanAddress() {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => address.family === 'IPv4' && !address.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address))
  return (candidates.find((address) => /^en\d/.test(address.name)) ?? candidates[0])?.address
}

/** Taken on IPv4 or IPv6: dev servers often listen on [::1] only, which `localhost` reaches first. */
async function portInUse(port) {
  const open = (host) => new Promise((done) => {
    const socket = createConnection({ port, host })
    socket.once('connect', () => { socket.destroy(); done(true) })
    socket.once('error', () => done(false))
  })
  return (await open('127.0.0.1')) || (await open('::1'))
}

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`
function run(label, code, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = color(code, `[${label}]`)
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) process.stdout.write(`${prefix} ${line}\n`)
    })
  }
  child.on('exit', (status) => { process.stdout.write(`${prefix} exited (${status ?? 'signal'})\n`); shutdown() })
  return child
}

const children = []
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (!existsSync(resolve(tanstack, 'package.json'))) {
  console.error(`douchat-tanstack not found at ${tanstack}. Set DOUCHAT_TANSTACK_DIR.`)
  process.exit(1)
}
for (const port of [SERVICE_PORT, WEB_PORT]) {
  if (await portInUse(port)) {
    console.error(`Port ${port} is in use. Stop the server running there (e.g. pnpm dev --port ${port}), then run make dev again.`)
    process.exit(1)
  }
}

const ip = lanAddress()
const site = ip ? `http://${ip}.nip.io:${SERVICE_PORT}` : `http://localhost:${SERVICE_PORT}`
const webOnPhone = ip ? `http://app.${ip}.nip.io:${WEB_PORT}` : undefined

children.push(run('service', 36, 'pnpm', ['exec', 'vite', 'dev', '--port', String(SERVICE_PORT), '--host', '0.0.0.0'], {
  cwd: tanstack,
  env: {
    ...process.env,
    // Sign-in served over plain HTTP on the LAN: non-secure cookies, and its origin trusted.
    AUTH_URL: site,
    AUTH_TRUSTED_ORIGINS: [process.env.AUTH_TRUSTED_ORIGINS, '.nip.io'].filter(Boolean).join(',')
  }
}))
children.push(run('web', 35, 'npx', ['vite', '--config', 'vite.web.config.ts'], {
  env: { ...process.env, DOUCHAT_WEB_HOST: '0.0.0.0', DOUCHAT_WEB_PORT: String(WEB_PORT), DOUCHAT_SITE_URL: site, DOUCHAT_SERVICE_URL: `http://127.0.0.1:${SERVICE_PORT}` }
}))

console.log(`
${color(1, 'Douchat dev')}
  Web app (this computer)  ${color(32, `http://app.localhost:${WEB_PORT}`)}
  Web app (phone)          ${webOnPhone ? color(32, webOnPhone) : color(33, 'no LAN address found; phones cannot connect')}
  Site / sign-in           ${site}
  Admin                    ${site}/admin
Phone and computer must be on the same Wi-Fi. Ctrl-C stops everything.
`)
