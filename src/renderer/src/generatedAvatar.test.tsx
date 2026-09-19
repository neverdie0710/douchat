import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GeneratedAgentAvatar, generatedAvatarTraits } from './generatedAvatar'

describe('generated contact avatars', () => {
  it('keeps the same illustrated identity for a persisted seed', () => {
    expect(generatedAvatarTraits('contact-a')).toEqual(generatedAvatarTraits('contact-a'))
    expect(renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />))
      .toBe(renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />))
  })

  it('varies the human portrait between independently seeded contacts', () => {
    expect(generatedAvatarTraits('contact-a')).not.toEqual(generatedAvatarTraits('contact-b'))
  })

  it('renders a self-contained human portrait without a remote image', () => {
    const markup = renderToStaticMarkup(<GeneratedAgentAvatar seed="contact-a" />)
    expect(markup).toContain('<svg')
    expect(markup).toContain('<circle')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('http')
  })
})
