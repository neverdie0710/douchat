import type { ReactElement } from 'react'

const BACKGROUNDS = ['#E8E1FF', '#D7F2EC', '#FFE3CF', '#DCEAFF', '#F9DDE8', '#E9EDC9']
const SKIN_TONES = ['#F8D7C0', '#EFC09D', '#D99A73', '#B96F4C', '#8D5035', '#613823']
const HAIR_COLORS = ['#2D2523', '#5A3828', '#8C5A35', '#D4A24C', '#3C3748', '#1F2937']
const SHIRT_COLORS = ['#4F46E5', '#0F9F8F', '#E45772', '#E98A2E', '#3878D4', '#6D5BA8']

export interface GeneratedAvatarTraits {
  background: string
  skin: string
  hair: string
  shirt: string
  hairStyle: number
  glasses: boolean
  smile: number
  faceWidth: number
}

function seedNumber(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/** Turn the persisted random seed into stable visual choices. Reopening the
 * app never reshuffles a contact, while two newly created contacts are very
 * unlikely to receive the same face. */
export function generatedAvatarTraits(seed: string): GeneratedAvatarTraits {
  let state = seedNumber(seed) || 0x9e3779b9
  const next = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  const pick = <T,>(values: readonly T[]): T => values[next() % values.length]
  return {
    background: pick(BACKGROUNDS),
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS),
    shirt: pick(SHIRT_COLORS),
    hairStyle: next() % 5,
    glasses: next() % 4 === 0,
    smile: next() % 3,
    faceWidth: 28 + next() % 5
  }
}

function Hair({ style, color }: { style: number; color: string }): ReactElement {
  if (style === 1) {
    return <path d="M17 24c1-10 7-15 15-15 9 0 14 6 15 15-6-1-10-5-13-10-3 5-9 9-17 10z" fill={color} />
  }
  if (style === 2) {
    return <g fill={color}>
      <circle cx="18" cy="20" r="7" /><circle cx="24" cy="13" r="7" />
      <circle cx="32" cy="11" r="7" /><circle cx="40" cy="13" r="7" />
      <circle cx="46" cy="20" r="7" /><circle cx="32" cy="17" r="8" />
    </g>
  }
  if (style === 3) {
    return <path d="M16 25C16 13 22 7 33 7c9 0 15 6 15 17-6-1-11-5-15-11-2 6-8 10-17 12z" fill={color} />
  }
  if (style === 4) {
    return <>
      <path d="M17 21C19 11 24 8 32 8c8 0 13 3 15 13-9-5-21-5-30 0z" fill={color} />
      <path d="M19 17l5-6m2 5 4-8m2 8 3-8m2 9 4-6" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="1.4" />
    </>
  }
  return <path d="M16 25C16 13 22 7 32 7c11 0 17 7 16 19-5-2-9-6-12-12-4 6-10 10-20 11z" fill={color} />
}

export function GeneratedAgentAvatar({ seed }: { seed: string }): ReactElement {
  const traits = generatedAvatarTraits(seed)
  const faceX = (64 - traits.faceWidth) / 2
  const leftEye = 26
  const rightEye = 38
  const mouth = traits.smile === 0
    ? 'M27 39c3 3 7 3 10 0'
    : traits.smile === 1
      ? 'M28 40c2 1 6 1 8 0'
      : 'M27 39h10'

  return (
    <svg viewBox="0 0 64 64" role="presentation" focusable="false">
      <rect width="64" height="64" fill={traits.background} />
      <circle cx="52" cy="10" r="12" fill="#fff" opacity=".18" />
      <path d="M7 64c1-12 10-19 25-19s24 7 25 19z" fill={traits.shirt} />
      <path d="M27 42h10v9H27z" fill={traits.skin} />
      {traits.hairStyle === 1 && <path d="M14 26c0-12 7-19 18-19s18 7 18 19v19H14z" fill={traits.hair} />}
      <circle cx={faceX + 1} cy="30" r="4" fill={traits.skin} />
      <circle cx={faceX + traits.faceWidth - 1} cy="30" r="4" fill={traits.skin} />
      <rect x={faceX} y="10" width={traits.faceWidth} height="39" rx={traits.faceWidth / 2} fill={traits.skin} />
      <Hair style={traits.hairStyle} color={traits.hair} />
      <path d={`M${leftEye - 3} 27q3-2 6 0M${rightEye - 3} 27q3-2 6 0`} fill="none" stroke={traits.hair} strokeLinecap="round" strokeWidth="1.3" opacity=".72" />
      <circle cx={leftEye} cy="31" r="1.45" fill="#292524" />
      <circle cx={rightEye} cy="31" r="1.45" fill="#292524" />
      <path d="M32 31l-1 5 2 1" fill="none" stroke="#8A5843" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".48" strokeWidth="1.2" />
      <path d={mouth} fill="none" stroke="#8D3E46" strokeLinecap="round" strokeWidth="1.4" />
      {traits.glasses && <g fill="none" stroke="#38343D" strokeWidth="1.35">
        <rect x="21" y="27.5" width="10" height="7" rx="3" />
        <rect x="33" y="27.5" width="10" height="7" rx="3" />
        <path d="M31 30h2M19 29l2 1M43 30l2-1" />
      </g>}
      <path d="M23 47c3 4 15 4 18 0" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
    </svg>
  )
}
