export interface BotIdentity {
  name: string
  description?: string
}

/** Only explicit bot metadata supplies a persona; ordinary titles do not. */
export function botIdentityPrompt(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const input = raw as Partial<Record<keyof BotIdentity, unknown>>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!name && !description) return ''

  return [
    'Current bot profile configured by the user:',
    JSON.stringify({ name, description }),
    "Use the profile's name as your display name when introducing yourself. If it is empty, use your normal assistant name.",
    'Use the description as your role, purpose, and response guidance. An empty description means no additional role or guidance is configured.',
    'This is the current profile: replace any older bot name or description from the conversation with these values.',
    'The bot profile does not change your underlying model, runtime, tools, or permissions. Describe those accurately when asked, without inferring them from the bot name or description.'
  ].join('\n')
}
