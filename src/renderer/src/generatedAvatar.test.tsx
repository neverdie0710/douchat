import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GeneratedAgentAvatar, generatedAvatarTraits } from './generatedAvatar'

describe('generated contact avatars', () => {
  it('keeps the same pocket sprite for a persisted seed', () => {
    expect(generatedAvatarTraits('contact-a')).toEqual(generatedAvatarTraits('contact-a'))
    expect(renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />))
      .toBe(renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />))
  })

  it('varies the palette, silhouette, decoration, and animation phase', () => {
    expect(generatedAvatarTraits('contact-a')).not.toEqual(generatedAvatarTraits('contact-b'))
  })

  it('provides a broad stable palette without frequent repeats', () => {
    const palettes = new Set(Array.from({ length: 36 }, (_, index) => {
      const traits = generatedAvatarTraits(`contact-${index}`)
      return `${traits.background}|${traits.surface}|${traits.accent}`
    }))
    expect(palettes.size).toBeGreaterThanOrEqual(30)
  })

  it('uses every original silhouette across a representative seed set', () => {
    const shapes = new Set(Array.from({ length: 48 }, (_, index) => generatedAvatarTraits(`sprite-${index}`).shape))
    expect(shapes).toEqual(new Set([0, 1, 2, 3, 4]))
  })

  it('renders an animated, self-contained character without a remote image', () => {
    const markup = renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />)
    expect(markup).toContain('<svg')
    expect(markup).toContain('avatar-sprite')
    expect(markup).toContain('avatar-eye-wink')
    expect(markup).not.toContain('<text')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('http')
  })
})
