const files = import.meta.glob('./assets/agents/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
export const agentIcons: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.split('.')[0], url]))
agentIcons.claude = agentIcons.claudecode
agentIcons['grok-build'] = agentIcons.grok
