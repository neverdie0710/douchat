/** A persisted emoji avatar is exactly one visible grapheme. This accepts
 * joined emoji, skin tones, flags, and keycaps while rejecting ordinary text. */
export function normalizeAgentEmoji(value: string | undefined): string {
  const emoji = value?.trim() ?? ''
  if (!emoji || emoji.length > 32) return ''
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)]
  if (segments.length !== 1) return ''
  const isPictograph = /\p{Extended_Pictographic}/u.test(emoji)
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(emoji)
  const isKeycap = /^[0-9#*]\uFE0F?\u20E3$/u.test(emoji)
  return isPictograph || isFlag || isKeycap ? emoji : ''
}
