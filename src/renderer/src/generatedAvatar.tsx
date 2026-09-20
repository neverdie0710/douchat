import type { CSSProperties, ReactElement } from 'react'

const HUE_STEPS = 36
const TONES = [
  { saturation: 42, background: 96, surface: 86, accent: 58, ink: 24 },
  { saturation: 48, background: 95, surface: 83, accent: 55, ink: 22 },
  { saturation: 54, background: 94, surface: 80, accent: 52, ink: 20 }
] as const

export interface GeneratedAvatarTraits {
  background: string
  surface: string
  accent: string
  ink: string
  shape: number
  decoration: number
  tilt: number
  winkSide: 0 | 1
  winkDelay: number
  motionDelay: number
}

function generatedPalette(value: number): Pick<GeneratedAvatarTraits, 'background' | 'surface' | 'accent' | 'ink'> {
  // Thirty-six evenly spaced hues and three tone levels make 108 lively but
  // stable combinations, so a long contact list still feels varied.
  const hue = (value % HUE_STEPS) * (360 / HUE_STEPS)
  const tone = TONES[(value >>> 8) % TONES.length]
  const shiftedHue = (hue + 12) % 360
  return {
    background: `hsl(${hue} ${tone.saturation - 18}% ${tone.background}%)`,
    surface: `hsl(${shiftedHue} ${tone.saturation - 4}% ${tone.surface}%)`,
    accent: `hsl(${hue} ${tone.saturation}% ${tone.accent}%)`,
    ink: `hsl(${hue} ${tone.saturation - 10}% ${tone.ink}%)`
  }
}

function seedNumber(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/** Turn the persisted random seed into one stable pocket sprite. Existing
 * seeds need no migration when the illustration language changes. */
export function generatedAvatarTraits(seed: string): GeneratedAvatarTraits {
  let state = seedNumber(seed) || 0x9e3779b9
  const next = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  const palette = generatedPalette(next())
  return {
    ...palette,
    shape: next() % 5,
    decoration: next() % 4,
    tilt: (next() % 5) - 2,
    winkSide: (next() % 2) as 0 | 1,
    winkDelay: -((next() % 5200) / 1000),
    motionDelay: -((next() % 4200) / 1000)
  }
}

function SpriteSilhouette({ traits }: { traits: GeneratedAvatarTraits }): ReactElement {
  if (traits.shape === 1) {
    return <>
      <path d="M32 12V7" fill="none" stroke={traits.ink} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="5.5" r="2.8" fill={traits.background} stroke={traits.ink} strokeWidth="2" />
      <rect x="10" y="10" width="44" height="44" rx="11" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
    </>
  }
  if (traits.shape === 2) {
    return <>
      <circle cx="19" cy="14" r="7" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
      <circle cx="45" cy="14" r="7" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
      <circle cx="19" cy="14" r="2.2" fill={traits.accent} opacity=".45" />
      <circle cx="45" cy="14" r="2.2" fill={traits.accent} opacity=".45" />
      <rect x="10" y="10" width="44" height="44" rx="11" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
    </>
  }
  if (traits.shape === 3) {
    return <>
      <rect x="10" y="10" width="44" height="44" rx="11" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
      <path d="M53 30c4.5-.8 6.5 2 4.2 6" fill="none" stroke={traits.ink} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="56.5" cy="37" r="2.2" fill={traits.accent} />
    </>
  }
  if (traits.shape === 4) {
    return <>
      <path d="M10 21c0-7 5-11 12-11h20c7 0 12 4 12 11v23c0 6-4.5 10-10 10-4.5 0-8-2-12-5-4 3-7.5 5-12 5-5.5 0-10-4-10-10z" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M25 10c1-3.5 3.5-5.5 7-5.5s6 2 7 5.5" fill="none" stroke={traits.ink} strokeWidth="2.2" strokeLinecap="round" />
    </>
  }
  return <>
    <rect x="10" y="10" width="44" height="44" rx="11" fill={traits.surface} stroke={traits.ink} strokeWidth="2.2" />
    <path d="M22 11c3-2.5 6.5-3.5 10-3.5s7 1 10 3.5" fill="none" stroke={traits.ink} strokeWidth="2.2" strokeLinecap="round" />
  </>
}

function SpriteDecoration({ traits }: { traits: GeneratedAvatarTraits }): ReactElement {
  if (traits.decoration === 1) {
    return <path d="M26 47h12v6H26z" fill="none" stroke={traits.accent} strokeWidth="1.8" strokeLinejoin="round" opacity=".75" />
  }
  if (traits.decoration === 2) {
    return <>
      <circle cx="18" cy="45" r="1.8" fill={traits.accent} />
      <circle cx="46" cy="19" r="1.8" fill={traits.accent} />
    </>
  }
  if (traits.decoration === 3) {
    return <path d="M28 47l4 3 4-3" fill="none" stroke={traits.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
  }
  return <path d="M43 18c2.5.8 4.2 2.5 5 5" fill="none" stroke={traits.accent} strokeWidth="1.8" strokeLinecap="round" opacity=".75" />
}

export function GeneratedAgentAvatar({ seed }: { seed: string }): ReactElement {
  const traits = generatedAvatarTraits(seed)
  const faceY = [24, 24, 25, 24, 23][traits.shape]
  const style = {
    '--avatar-wink-delay': `${traits.winkDelay}s`,
    '--avatar-motion-delay': `${traits.motionDelay}s`
  } as CSSProperties

  return (
    <svg className="generated-agent-avatar-art" viewBox="0 0 64 64" role="presentation" focusable="false" style={style}>
      <g className="avatar-sprite">
        <g transform={`rotate(${traits.tilt} 32 34)`}>
          <SpriteSilhouette traits={traits} />
          <SpriteDecoration traits={traits} />
          <g className="avatar-sprite-face">
            <circle cx="20" cy={faceY + 12} r="2.5" fill={traits.accent} opacity=".22" />
            <circle cx="44" cy={faceY + 12} r="2.5" fill={traits.accent} opacity=".22" />
            <rect
              className={`avatar-sprite-eye${traits.winkSide === 0 ? ' avatar-eye-wink' : ''}`}
              x="24"
              y={faceY}
              width="4"
              height="9"
              rx="2"
              fill={traits.ink}
            />
            <rect
              className={`avatar-sprite-eye${traits.winkSide === 1 ? ' avatar-eye-wink' : ''}`}
              x="36"
              y={faceY}
              width="4"
              height="9"
              rx="2"
              fill={traits.ink}
            />
            <path d={`M29 ${faceY + 15}c2 1.7 4 1.7 6 0`} fill="none" stroke={traits.ink} strokeWidth="1.6" strokeLinecap="round" opacity=".72" />
          </g>
        </g>
      </g>
    </svg>
  )
}
