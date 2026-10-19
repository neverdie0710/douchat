import { describe, expect, it } from 'vitest'
import { dataUrlBlob } from './webApi'

describe('dataUrlBlob', () => {
  it('decodes a base64 image without fetching it', async () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]
    const blob = dataUrlBlob(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`)
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual(bytes)
  })

  it('rejects anything that is not a base64 data URL', () => {
    expect(() => dataUrlBlob('https://example.com/a.png')).toThrow('This image could not be read')
  })
})
