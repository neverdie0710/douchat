export interface BotMember {
  id: string
  name: string
  description?: string
}

/** Exclude code, quoted replies, links and email addresses from mention labels. */
function routingText(content: string): string {
  let fence = ''
  const prose = content
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = marker[1]
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''
        return ''
      }
      return fence ? '' : line
    })
    .join('\n')
  return prose
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
}

const normalizeName = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()
const mentionBoundary = (value: string): boolean =>
  !value || /[\s,，.。!！?？:：;；、()（）[\]{}<>"“”'‘’「」]/u.test(value)

/** Longest names win, so @Ann never accidentally addresses @Anna. */
export function mentionedMembers<T extends BotMember>(content: string, members: T[]): T[] {
  const text = normalizeName(routingText(content))
  const candidates = [...members].filter((member) => member.name.trim()).sort((a, b) => b.name.length - a.name.length)
  const result = new Set<string>()
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '@' || !mentionBoundary(text[index - 1] ?? '')) continue
    const match = candidates.find((member) => {
      const name = normalizeName(member.name)
      return text.startsWith(name, index + 1) && mentionBoundary(text[index + 1 + name.length] ?? '')
    })
    if (match) {
      result.add(match.id)
      index += normalizeName(match.name).length
    }
  }
  return [...result].flatMap((id) => members.filter((member) => member.id === id))
}

export function addressesEveryone(content: string): boolean {
  return /(?:^|[\s,，、])@(?:all|everyone|所有成员|所有人|全体成员|大家)(?=$|[\s,，.。!！?？:：;；、])/iu.test(
    routingText(content).normalize('NFKC')
  )
}

/** An explicit address (including an unknown member) must not inherit a recipient. */
export function hasExplicitMention(content: string): boolean {
  const text = routingText(content).normalize('NFKC')
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '@' && mentionBoundary(text[index - 1] ?? '')) return true
  }
  return false
}

export interface MentionQuery {
  start: number
  end: number
  query: string
}

/** Keep spaces in the query: names such as “我的 codex” are valid members. */
export function mentionQuery(value: string, cursor: number, members: BotMember[] = []): MentionQuery | null {
  const before = value.slice(0, cursor)
  const start = before.lastIndexOf('@')
  if (start < 0 || !mentionBoundary(before[start - 1] ?? '')) return null
  const query = before.slice(start + 1)
  if (query.length > 80 || /[\n@,，。!！?？:：;；]/u.test(query)) return null
  // Once a complete mention is followed by a space, normal message typing
  // resumes; keep supporting spaces while a member's name is incomplete.
  const normalized = normalizeName(query)
  const continuingName = members.some((member) => normalizeName(member.name).startsWith(normalized))
  if (
    !continuingName &&
    ['all', 'everyone', ...members.map((member) => member.name)].some((name) => {
      const complete = normalizeName(name)
      return normalized.startsWith(complete) && /\s/.test(normalized[complete.length] ?? '')
    })
  )
    return null
  return { start, end: cursor, query }
}

export function insertMention(value: string, query: MentionQuery, name: string): { value: string; cursor: number } {
  const mention = `@${name} `
  return {
    value: value.slice(0, query.start) + mention + value.slice(query.end),
    cursor: query.start + mention.length
  }
}
