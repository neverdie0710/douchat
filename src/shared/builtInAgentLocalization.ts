import type { BuiltInAgentDefinition } from './types'
import type { InterfaceLanguage } from './language'

export const drDouLocalizations = {
  en: { role: 'Douchat assistant', instructions: 'You are Dr. Dou, a friendly, reliable and concise assistant. Help the user solve problems and complete tasks. Reply in the language the user is using.', labels: 'Dr. Dou, Douchat' },
  'zh-CN': { role: '豆博士', instructions: '你是豆博士（Dr. Dou），友好、可靠、简洁地帮助用户解决问题、完成任务，默认使用用户正在使用的语言回复。', labels: '豆博士, Douchat' }
}
export const legacyDrDouDefaults = {
  role: '豆博士',
  instructions: '你是豆博士（Dr. Dou），Douchat 的云端智能助手。友好、可靠、简洁地帮助用户解决问题、完成任务，默认使用用户正在使用的语言回复。',
  labels: '豆博士, Douchat'
}
export function localizedBuiltInAgent(definition: BuiltInAgentDefinition, language: InterfaceLanguage): BuiltInAgentDefinition {
  const translation = definition.localizations?.[language]
  if (translation) return { ...definition, ...translation }
  // Old servers/cache have no localization map. Migrate only the known stock
  // fields, never a different server-provided template.
  if (definition.systemKey !== 'dr-dou') return definition
  const result = { ...definition }
  for (const key of ['role', 'instructions', 'labels'] as const) {
    if (definition[key] === legacyDrDouDefaults[key] || key === 'labels' && definition[key] === 'Douchat') result[key] = drDouLocalizations[language][key]
  }
  return result
}
export function builtInDefaultValues(definition: BuiltInAgentDefinition, key: 'role' | 'instructions' | 'labels'): (string | undefined)[] {
  return [definition[key], ...Object.values(definition.localizations ?? {}).map(value => value?.[key]),
    ...(definition.systemKey === 'dr-dou' ? [legacyDrDouDefaults[key], ...Object.values(drDouLocalizations).map(value => value[key]), ...(key === 'labels' ? ['Douchat'] : [])] : [])]
}
