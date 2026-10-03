/** Append options before the prompt delimiter; never interpret arguments as shell code. */
export function appendLocalAgentArguments(base: string[], extra: string[] = []): string[] {
  const separator = base.indexOf('--')
  return separator < 0 ? [...base, ...extra] : [...base.slice(0, separator), ...extra, ...base.slice(separator)]
}

export const MAX_AGENT_STARTUP_ARGS = 16

/** An agent's own arguments, appended after its runtime's (e.g. `-a <name>` so
 * one FastClaw runtime can serve several FastClaw agents). */
export function validateAgentStartupArgs(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > MAX_AGENT_STARTUP_ARGS
    || value.some(arg => typeof arg !== 'string' || !arg || arg.length > 1024 || /[\0\r\n]/.test(arg))) {
    throw new Error(`Enter up to ${MAX_AGENT_STARTUP_ARGS} valid startup arguments.`)
  }
  if (value.some(arg => arg.includes('{prompt}'))) throw new Error('{prompt} can only be set on the agent runtime.')
  return value.length ? [...value] : undefined
}

/** Arguments are separated by spaces or new lines, as typed in a terminal (`-a zhaocai`);
 * quote a value that contains spaces. No other shell syntax is interpreted. */
export function parseStartupArgsText(text: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | undefined
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (quote) throw new Error('Close the quote in the startup arguments.')
  if (started) args.push(current)
  return args
}

/** The editable text for stored arguments; parses back to the same list. */
export function formatStartupArgs(args: string[] = []): string {
  return args.map(arg => !/[\s"']/.test(arg) ? arg : arg.includes('"') ? `'${arg}'` : `"${arg}"`).join(' ')
}

export function customLocalAgentArguments(args: string[] = [], prompt: string): string[] {
  const hasPrompt = args.some(arg => arg.includes('{prompt}'))
  const expanded = args.map(arg => arg.replaceAll('{prompt}', prompt))
  return hasPrompt ? expanded : [...expanded, prompt]
}
