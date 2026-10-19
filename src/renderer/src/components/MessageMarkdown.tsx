import { ChatErrorBoundary } from './ChatErrorBoundary'
import { memo, useState, createContext, useContext, isValidElement, cloneElement, type ReactElement, type ReactNode } from 'react'
import { CodeBlock, Streamdown, type Components, type ControlsConfig, type MermaidErrorComponentProps, type PluginConfig } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { mermaid } from '@streamdown/mermaid'
import { Copy, FileText, Laptop, LoaderCircle, TriangleAlert } from 'lucide-react'
import { SvgPreview } from './SvgPreview'
import { CodeArtifact, codeArtifactLanguages } from './CodeArtifact'
import { CodeCopyButton } from './CodeCopyButton'
import { t } from '../preferences'

export const FileConversationContext = createContext<string | undefined>(undefined)

export function localFilePathFromHref(href: string | undefined, platform?: string): string | undefined {
  if (!href?.toLowerCase().startsWith('douchat-file:')) return undefined
  try {
    const url = new URL(href)
    if (url.protocol !== 'douchat-file:') return undefined
    const decoded = decodeURIComponent(url.pathname)
    const currentPlatform = platform ?? (typeof window === 'undefined' ? '' : window.douchat.platform)
    const path = currentPlatform === 'win32' && /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1) : decoded
    return path || undefined
  } catch {
    return undefined
  }
}

function LocalFileLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  const conversationId = useContext(FileConversationContext)
  const path = localFilePathFromHref(href)
  const [state, setState] = useState<'idle' | 'opening' | 'failed'>('idle')
  if (!path) return <span>{children}</span>
  // The web app cannot open a file that lives on the person's computer.
  if (typeof window !== 'undefined' && window.douchat?.desktopAvailability) return <RemoteFileLink path={path} conversationId={conversationId}>{children}</RemoteFileLink>

  const open = async (): Promise<void> => {
    if (state === 'opening') return
    setState('opening')
    try {
      await window.douchat.openLocalFile(path, conversationId)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <button
      type="button"
      className={`message-local-file is-${state}`}
      title={state === 'failed' ? t('This file is no longer available at its saved location.') : path}
      aria-label={`${t('Open local file')}: ${path}`}
      onClick={() => void open()}
    >
      {state === 'opening'
        ? <LoaderCircle className="message-local-file-icon" size={13} aria-hidden="true" />
        : state === 'failed'
          ? <TriangleAlert className="message-local-file-icon" size={13} aria-hidden="true" />
          : <FileText className="message-local-file-icon" size={13} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}

/**
 * A file on the person's computer, seen from the web app: say where it is,
 * offer its path, and open it on that computer while its desktop is online.
 * Red is kept for a file the desktop reports gone.
 */
function RemoteFileLink({ path, conversationId, children }: { path: string; conversationId?: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<{ kind: 'idle' | 'opening' | 'opened' | 'copied' | 'missing' | 'error'; message?: string }>({ kind: 'idle' })
  const online = window.douchat.desktopAvailability?.() === 'online'
  const openOnComputer = async (): Promise<void> => {
    setStatus({ kind: 'opening' })
    try {
      await window.douchat.openLocalFile(path, conversationId)
      setStatus({ kind: 'opened' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(/ENOENT|no such file|not found|does not exist|no longer/i.test(message) ? { kind: 'missing' } : { kind: 'error', message })
    }
  }
  const copyPath = async (): Promise<void> => {
    try { await window.douchat.copyText(path); setStatus({ kind: 'copied' }) } catch { setStatus({ kind: 'error', message: t('Could not copy the path') }) }
  }
  return (
    <span className="message-remote-file">
      <button type="button" className={`message-local-file is-remote${status.kind === 'missing' ? ' is-failed' : ''}`} title={path}
        aria-label={`${t('File on your computer')}: ${path}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {status.kind === 'missing'
          ? <TriangleAlert className="message-local-file-icon" size={13} aria-hidden="true" />
          : <Laptop className="message-local-file-icon" size={13} aria-hidden="true" />}
        <span>{children}</span>
      </button>
      {open && <span className="message-remote-file-popover" role="dialog" aria-label={t('File on your computer')}>
        <strong>{t('This file is on your computer')}</strong>
        <span className="message-remote-file-note">{online
          ? t('The web app cannot open it directly. You can open it on your computer.')
          : t('The web app cannot open it directly. Open the Douchat desktop app to view it on your computer.')}</span>
        <code className="message-remote-file-path">{path}</code>
        {status.kind === 'opened' && <span className="message-remote-file-status">{t('Opened on your computer.')}</span>}
        {status.kind === 'copied' && <span className="message-remote-file-status">{t('Path copied.')}</span>}
        {status.kind === 'missing' && <span className="message-remote-file-status is-error">{t('This file is no longer available at its saved location.')}</span>}
        {status.kind === 'error' && <span className="message-remote-file-status is-error">{status.message}</span>}
        <span className="message-remote-file-actions">
          <button type="button" onClick={() => void copyPath()}><Copy size={13} aria-hidden="true" />{t('Copy path')}</button>
          {online && <button type="button" className="is-primary" disabled={status.kind === 'opening'} onClick={() => void openOnComputer()}>
            {status.kind === 'opening' ? <LoaderCircle size={13} aria-hidden="true" /> : <Laptop size={13} aria-hidden="true" />}{t('Open on computer')}
          </button>}
        </span>
      </span>}
    </span>
  )
}

// Use semantic elements styled by the chat theme, without introducing a
// global Tailwind reset or Streamdown's document-sized controls into bubbles.
const components: Components = {
  pre: ({ children }) => {
    if (!isValidElement<{ className?: string; children?: ReactNode; 'data-block'?: string }>(children)) return <pre>{children}</pre>
    const language = /language-([^\s]+)/.exec(children.props.className ?? '')?.[1] ?? ''
    // Keep specialized diagrams and file artifacts; every other fence still
    // needs the desktop clipboard instead of the browser-only default button.
    if (['mermaid', 'svg', 'xml-svg', ...codeArtifactLanguages].includes(language)) {
      return cloneElement(children, { 'data-block': 'true' })
    }
    const code = String(children.props.children ?? '')
    return <CodeBlock code={code} language={language}><CodeCopyButton code={code} /></CodeBlock>
  },
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
  a: ({ children, href, title }) => {
    if (localFilePathFromHref(href)) return <LocalFileLink href={href!}>{children}</LocalFileLink>
    return href && /^(https?:|mailto:)/i.test(href)
      ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>
  }
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
  return <ChatErrorBoundary fallbackText={text}><Streamdown
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
      copyCode: t('Copy code'),
      copied: t('Copied'),
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
  >{text}</Streamdown></ChatErrorBoundary>
})

// Quotes retain Markdown formatting without embedding full-size artifacts or controls.
const quoteComponents: Components = {
  ...components,
  p: ({ children }) => <span>{children} </span>,
  h1: ({ children }) => <span>{children} </span>,
  h2: ({ children }) => <span>{children} </span>,
  h3: ({ children }) => <span>{children} </span>,
  h4: ({ children }) => <span>{children} </span>,
  h5: ({ children }) => <span>{children} </span>,
  h6: ({ children }) => <span>{children} </span>,
  ul: ({ children }) => <span>{children}</span>,
  ol: ({ children }) => <span>{children}</span>,
  li: ({ children }) => <span>• {children} </span>,
  blockquote: ({ children }) => <span>{children}</span>,
  pre: ({ children }) => <span>{children} </span>,
  code: ({ children }) => <code>{children}</code>,
  img: ({ alt }) => <span>{alt || '[Image]'}</span>,
  table: ({ children }) => <span>{children}</span>,
  thead: ({ children }) => <span>{children}</span>,
  tbody: ({ children }) => <span>{children}</span>,
  tr: ({ children }) => <span>{children} </span>,
  th: ({ children }) => <span>{children} </span>,
  td: ({ children }) => <span>{children} </span>,
  hr: () => <span> · </span>,
  br: () => <span> </span>
}

export const QuoteMarkdown = memo(function QuoteMarkdown({ text }: { text: string }) {
  return <ChatErrorBoundary fallbackText={text}><Streamdown className="quote-markdown" mode="static" plugins={{ cjk }} components={quoteComponents} controls={false} skipHtml rehypePlugins={noRawHtmlPlugins}>{text}</Streamdown></ChatErrorBoundary>
})
