import { useState, type ReactElement } from 'react'
import { CodeBlock, type CustomRendererProps } from 'streamdown'
import { ExternalLink, FileCode2 } from 'lucide-react'
import { t, tr } from '../preferences'

export const codeArtifactLanguages = [
  'html', 'css', 'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx',
  'python', 'py', 'json', 'yaml', 'yml', 'xml', 'shell', 'bash', 'sh',
  'sql', 'java', 'c', 'cpp', 'csharp', 'cs', 'go', 'rust', 'rs', 'swift',
  'kotlin', 'php', 'ruby', 'rb', 'vue', 'svelte', 'markdown', 'md'
]

const extensions: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', shell: 'sh', bash: 'sh',
  csharp: 'cs', rust: 'rs', ruby: 'rb', markdown: 'md', yml: 'yml'
}

const languageNames: Record<string, string> = {
  html: 'HTML', css: 'CSS', javascript: 'JavaScript', js: 'JavaScript',
  typescript: 'TypeScript', ts: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
  python: 'Python', py: 'Python', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  xml: 'XML', shell: 'Shell', bash: 'Bash', sh: 'Shell', sql: 'SQL',
  cpp: 'C++', csharp: 'C#', cs: 'C#', go: 'Go', rust: 'Rust', rs: 'Rust',
  swift: 'Swift', kotlin: 'Kotlin', php: 'PHP', ruby: 'Ruby', rb: 'Ruby',
  vue: 'Vue', svelte: 'Svelte', markdown: 'Markdown', md: 'Markdown'
}

export function isFileSizedCode(code: string, meta?: string): boolean {
  if (/\b(?:filename|file|title)\s*=/.test(meta ?? '')) return true
  const lines = code.replace(/\n$/, '').split('\n').length
  return lines >= 18 || code.length >= 1200
}

export function inferArtifactName(language: string, meta?: string): string {
  const named = /\b(?:filename|file|title)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(meta ?? '')
  const basename = named && (named[1] || named[2] || named[3]).split(/[\\/]/).pop()?.trim()
  if (basename) return basename.slice(0, 120)
  const extension = extensions[language] ?? (language.replace(/[^a-z0-9+#-]/gi, '') || 'txt')
  return `index.${extension}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function CodeArtifact({ code, language, meta, isIncomplete }: CustomRendererProps): ReactElement {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(false)
  if (isIncomplete || !isFileSizedCode(code, meta)) {
    return <CodeBlock code={code} language={language} isIncomplete={isIncomplete} />
  }

  const title = inferArtifactName(language, meta)
  const name = languageNames[language] ?? language.toUpperCase()
  const lines = code.replace(/\n$/, '').split('\n').length
  const bytes = new TextEncoder().encode(code).length
  const open = async (): Promise<void> => {
    if (opening) return
    setOpening(true)
    setError(false)
    try {
      await window.douchat.openCodeArtifact({ title, language, code })
    } catch {
      setError(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="code-artifact-wrap" data-streamdown="code-artifact">
      <button className="code-artifact-card" type="button" onClick={() => void open()} aria-label={tr('Open {name} in a separate window', { name: title })}>
        <span className="code-artifact-icon" aria-hidden="true"><FileCode2 size={23} strokeWidth={1.7} /></span>
        <span className="code-artifact-copy">
          <strong>{title}</strong>
          <small>{name} · {tr('{count} lines', { count: lines })} · {formatBytes(bytes)}</small>
        </span>
        <span className="code-artifact-open">
          {opening ? t('Opening…') : t('Open preview')}
          <ExternalLink size={15} aria-hidden="true" />
        </span>
      </button>
      {error && <span className="code-artifact-error" role="alert">{t('Code preview could not be opened')}</span>}
    </div>
  )
}
