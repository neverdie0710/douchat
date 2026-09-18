import { memo, type ReactElement } from 'react'
import { Streamdown, type Components, type ControlsConfig, type MermaidErrorComponentProps, type PluginConfig } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { mermaid } from '@streamdown/mermaid'
import { SvgPreview } from './SvgPreview'
import { CodeArtifact, codeArtifactLanguages } from './CodeArtifact'
import { t } from '../preferences'

// Use semantic elements styled by the chat theme, without introducing a
// global Tailwind reset or Streamdown's document-sized controls into bubbles.
const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
  a: ({ children, href, title }) =>
    href && /^(https?:|mailto:)/i.test(href)
      ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>
}
export const messageMarkdownPlugins: PluginConfig = {
  cjk,
  mermaid,
  renderers: [
    { language: ['svg', 'xml-svg'], component: SvgPreview },
    { language: codeArtifactLanguages, component: CodeArtifact }
  ]
}
export const messageMarkdownControls = {
  code: false,
  table: false,
  image: false,
  mermaid: { copy: false, download: false, fullscreen: true, panZoom: true }
} satisfies ControlsConfig
const noRawHtmlPlugins: [] = []

function MermaidError({ chart, error, retry }: MermaidErrorComponentProps): ReactElement {
  return (
    <div className="diagram-error" role="alert">
      <strong>{t('Mermaid diagram could not be rendered')}</strong>
      <span>{error}</span>
      <button type="button" onClick={retry}>{t('Retry')}</button>
      <details className="diagram-source">
        <summary>{t('View source')}</summary>
        <pre><code>{chart}</code></pre>
      </details>
    </div>
  )
}

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return <Streamdown
    className="message-markdown"
    mode="static"
    plugins={messageMarkdownPlugins}
    mermaid={{
      config: {
        securityLevel: 'strict',
        suppressErrorRendering: true,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        flowchart: { useMaxWidth: true },
        sequence: { useMaxWidth: true },
        themeVariables: { fontSize: '16px' }
      },
      errorComponent: MermaidError
    }}
    translations={{
      viewFullscreen: t('Enlarge diagram'),
      exitFullscreen: t('Close enlarged diagram'),
      zoomIn: t('Zoom in'),
      zoomOut: t('Zoom out'),
      resetView: t('Reset view')
    }}
    components={components}
    controls={messageMarkdownControls}
    skipHtml
    rehypePlugins={noRawHtmlPlugins}
  >{text}</Streamdown>
})
