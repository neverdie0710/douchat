import { describe, expect, it } from 'vitest'
import { parseProducts, productLink } from './products'

describe('products', () => {
  it('keeps only well-formed entries from a /api/products answer', () => {
    const good = { id: 'termany', name: 'Termany', url: 'https://termany.sh', icon: 'javascript:alert(1)', summary: { en: 'Terminal', zh: '终端' } }
    expect(parseProducts({ data: { products: [good, { id: 'x', name: 'X', url: 'ftp://x', summary: { en: 'a', zh: 'b' } }, { name: 'No id' }] } }))
      .toEqual([{ id: 'termany', name: 'Termany', url: 'https://termany.sh', summary: { en: 'Terminal', zh: '终端' } }])
    expect(parseProducts({ data: { products: [] } })).toBeUndefined()
    expect(parseProducts(null)).toBeUndefined()
  })

  it('tags links with the visit source, replacing an earlier one', () => {
    const product = { id: 'a', name: 'A', url: 'https://a.ai/?utm_source=old&ref=1', summary: { en: '', zh: '' } }
    expect(productLink(product, 'douchat-web')).toBe('https://a.ai/?utm_source=douchat-web&ref=1')
  })
})
