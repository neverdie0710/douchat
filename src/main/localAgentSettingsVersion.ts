// Invalidate warm CLI connections after settings change, without re-running discovery on every message.
const versions = new Map<string, number>()
export function localAgentSettingsVersion(id: string): number { return versions.get(id) ?? 0 }
export function changedLocalAgentSettings(id: string): void { versions.set(id, localAgentSettingsVersion(id) + 1) }
