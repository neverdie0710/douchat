export interface ContactEntry {
  id: string
  name: string
}

/** Pinyin bucket boundaries: the first character of each initial's range.
 * I, U and V never start a pinyin syllable, so they have no section. */
const SECTION_BOUNDARIES: [string, string][] = [
  ['A', '阿'],
  ['B', '八'],
  ['C', '擦'],
  ['D', '搭'],
  ['E', '讹'],
  ['F', '发'],
  ['G', '嘎'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '趴'],
  ['Q', '七'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '他'],
  ['W', '挖'],
  ['X', '昔'],
  ['Y', '压'],
  ['Z', '匝']
]

export const OTHER_SECTION = '#'

function collator(): Intl.Collator {
  try {
    return new Intl.Collator('zh-Hans-u-co-pinyin')
  } catch {
    return new Intl.Collator('zh-Hans')
  }
}

const pinyinCollator = collator()

/** The A–Z index letter for a contact, with Han characters read by pinyin. */
export function contactSection(name: string): string {
  const first = name.trim()[0]
  if (!first) return OTHER_SECTION
  if (/[a-z]/i.test(first)) return first.toUpperCase()
  if (!/\p{Script=Han}/u.test(first)) return OTHER_SECTION
  for (let index = SECTION_BOUNDARIES.length - 1; index >= 0; index -= 1) {
    if (pinyinCollator.compare(first, SECTION_BOUNDARIES[index][1]) >= 0) return SECTION_BOUNDARIES[index][0]
  }
  return OTHER_SECTION
}

export function compareContacts(left: ContactEntry, right: ContactEntry): number {
  const leftSection = contactSection(left.name)
  const rightSection = contactSection(right.name)
  // Names outside the alphabet sink below Z, the way a phone book ends.
  if (leftSection !== rightSection) {
    if (leftSection === OTHER_SECTION) return 1
    if (rightSection === OTHER_SECTION) return -1
    return leftSection < rightSection ? -1 : 1
  }
  return pinyinCollator.compare(left.name, right.name) || left.id.localeCompare(right.id)
}

export interface ContactSection<T extends ContactEntry> {
  letter: string
  contacts: T[]
}

/** Group contacts into the letter sections an alphabetical index renders. */
export function contactSections<T extends ContactEntry>(contacts: readonly T[]): ContactSection<T>[] {
  const sections: ContactSection<T>[] = []
  for (const contact of [...contacts].sort(compareContacts)) {
    const letter = contactSection(contact.name)
    const current = sections[sections.length - 1]
    if (current?.letter === letter) current.contacts.push(contact)
    else sections.push({ letter, contacts: [contact] })
  }
  return sections
}

export function matchesContactQuery(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || name.toLocaleLowerCase().includes(needle)
}
