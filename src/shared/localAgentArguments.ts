/** Append options before the prompt delimiter; never interpret arguments as shell code. */
export function appendLocalAgentArguments(base: string[], extra: string[] = []): string[] {
  const separator = base.indexOf('--')
  return separator < 0 ? [...base, ...extra] : [...base.slice(0, separator), ...extra, ...base.slice(separator)]
}

export function customLocalAgentArguments(args: string[] = [], prompt: string): string[] {
  const hasPrompt = args.some(arg => arg.includes('{prompt}'))
  const expanded = args.map(arg => arg.replaceAll('{prompt}', prompt))
  return hasPrompt ? expanded : [...expanded, prompt]
}
