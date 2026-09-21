import { expect, it } from 'vitest'
import { npmShimScript, executableCommand } from './windowsCommand'

it('resolves npm shims with spaces and Unicode without using a shell', () => {
  expect(npmShimScript('"%_prog%" "%dp0%\\node_modules\\@vendor\\agent\\cli.js" %*', 'C:\\Users\\小明 Smith\\AppData\\Roaming\\npm\\agent.cmd'))
    .toBe('C:\\Users\\小明 Smith\\AppData\\Roaming\\npm\\node_modules\\@vendor\\agent\\cli.js')
  expect(npmShimScript('@echo hello %*', 'C:\\agent.cmd')).toBeUndefined()
})
it('keeps native executable arguments out of a command shell', async () => {
  expect(await executableCommand('C:\\Program Files\\Agent\\agent.exe', 'win32')).toEqual({ file: 'C:\\Program Files\\Agent\\agent.exe', prefix: [] })
})
