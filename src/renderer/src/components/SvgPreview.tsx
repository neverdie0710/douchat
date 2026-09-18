import DOMPurify from 'dompurify'
import { memo, useMemo, type ReactElement } from 'react'
import type { CustomRendererProps } from 'streamdown'
import { t } from '../preferences'

const forbiddenUrl = /(?:data|https?|javascript|vbscript|file):/i
const cssUrl = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

/**
 * Model-authored SVG is treated as an image format, not as arbitrary HTML.
 * DOMPurify removes executable markup first; the second pass prevents the
 * surviving SVG from loading remote resources through presentation attrs.
 */
export function sanitizeSvgMarkup(source: string): string | null {
  if (typeof window === 'undefined' || typeof DOMPurify.sanitize !== 'function') return null

  const parsedSource = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsedSource.documentElement.localName !== 'svg' || parsedSource.querySelector('parsererror')) return null

  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['a', 'embed', 'foreignObject', 'iframe', 'image', 'object', 'script', 'style', 'use'],
    FORBID_ATTR: ['href', 'src', 'style', 'xlink:href']
  })
  const sanitizedDocument = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  const svg = sanitizedDocument.documentElement
  if (svg.localName !== 'svg' || sanitizedDocument.querySelector('parsererror')) return null

  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      let unsafe = name.startsWith('on') || forbiddenUrl.test(value)
      cssUrl.lastIndex = 0
      for (const match of value.matchAll(cssUrl)) {
        if (!match[2].trim().startsWith('#')) unsafe = true
      }
      if (unsafe) element.removeAttribute(attribute.name)
    }
  }

  svg.setAttribute('role', 'img')
  svg.setAttribute('focusable', 'false')
  return new XMLSerializer().serializeToString(svg)
}

function SvgPreviewComponent({ code }: CustomRendererProps): ReactElement {
  const markup = useMemo(() => sanitizeSvgMarkup(code), [code])

  return (
    <figure className="svg-preview" data-streamdown="svg-block">
      <figcaption>SVG</figcaption>
      {markup
        ? <div className="svg-preview-canvas" aria-label={t('SVG image')} dangerouslySetInnerHTML={{ __html: markup }} />
        : <div className="diagram-error" role="alert">{t('SVG could not be rendered safely. Check the code format.')}</div>}
      <details className="diagram-source">
        <summary>{t('View source')}</summary>
        <pre><code>{code}</code></pre>
      </details>
    </figure>
  )
}

export const SvgPreview = memo(SvgPreviewComponent)
