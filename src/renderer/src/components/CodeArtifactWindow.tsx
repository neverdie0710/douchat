import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Check, Code2, Copy, Eye, FileCode2, RotateCcw } from 'lucide-react'
import type { CodeArtifactInput } from '../../../shared/types'
import { t, usePreferences } from '../preferences'

const previewLanguages = new Set(['html'])
const previewCsp = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'"
].join('; ')

export function secureHtmlDocument(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html')
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() === 'refresh') meta.remove()
  }
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = previewCsp
  document.head.prepend(policy)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

export function CodeArtifactWindow({ artifactId }: { artifactId: string }): ReactElement {
  usePreferences()
  const [artifact, setArtifact] = useState<CodeArtifactInput | null>()
  const [tab, setTab] = useState<'preview' | 'source'>('preview')
  const [frameKey, setFrameKey] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.douchat.getCodeArtifact(artifactId).then((value) => {
      setArtifact(value)
      if (!value || !previewLanguages.has(value.language)) setTab('source')
      if (value) document.title = value.title
    }).catch(() => setArtifact(null))
  }, [artifactId])

  const preview = useMemo(
    () => artifact && previewLanguages.has(artifact.language) ? secureHtmlDocument(artifact.code) : '',
    [artifact]
  )
  const copy = async (): Promise<void> => {
    if (!artifact) return
    await navigator.clipboard.writeText(artifact.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (artifact === undefined) return <main className="artifact-window-state">{t('Loading preview…')}</main>
  if (artifact === null) return <main className="artifact-window-state">{t('This code preview is no longer available.')}</main>

  const canPreview = previewLanguages.has(artifact.language)
  const lines = artifact.code.replace(/\n$/, '').split('\n').length
  return (
    <main className="artifact-window">
      <header className="artifact-window-header">
        <div className="artifact-window-file">
          <span aria-hidden="true"><FileCode2 size={20} /></span>
          <div><strong>{artifact.title}</strong><small>{artifact.language.toUpperCase()} · {lines} {t('lines')}</small></div>
        </div>
        <nav className="artifact-window-tabs" aria-label={t('Code preview views')}>
          {canPreview && <button className={tab === 'preview' ? 'active' : ''} type="button" onClick={() => setTab('preview')}><Eye size={15} />{t('Preview')}</button>}
          <button className={tab === 'source' ? 'active' : ''} type="button" onClick={() => setTab('source')}><Code2 size={15} />{t('Source code')}</button>
        </nav>
        <div className="artifact-window-actions">
          {tab === 'preview' && <button type="button" onClick={() => setFrameKey((value) => value + 1)} title={t('Reload preview')}><RotateCcw size={16} /><span>{t('Reload')}</span></button>}
          <button type="button" onClick={() => void copy()} title={t('Copy source')}>{copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied ? t('Copied') : t('Copy source')}</span></button>
        </div>
      </header>
      <section className="artifact-window-body">
        {tab === 'preview' ? (
          <iframe key={frameKey} className="artifact-render-frame" title={t('Rendered preview')} sandbox="allow-scripts" srcDoc={preview} />
        ) : (
          <pre className="artifact-source"><code>{artifact.code}</code></pre>
        )}
      </section>
    </main>
  )
}
