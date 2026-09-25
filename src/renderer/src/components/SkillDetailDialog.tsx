import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, File, Folder, X } from 'lucide-react'
import { zipSync } from 'fflate'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import { normalizeSkillCallouts, remarkSkillTitles } from './skillMarkdown'
import { SkillSourceCode } from './SkillSourceCode'
import type { AgentSkill } from '../../../shared/agentCustomization'
import { resolveInterfaceLanguage, usePreferences } from '../preferences'

type SkillFile = { path: string; data?: string; content?: string }
type FileNode = { name: string; path: string; children?: FileNode[] }
function fileTree(files: SkillFile[]): FileNode[] {
  const root: FileNode[] = []
  for (const file of files) {
    let level = root
    const parts = file.path.split('/')
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/')
      let node = level.find(item => item.path === path)
      if (!node) { node = { name, path, ...(index < parts.length - 1 ? { children: [] } : {}) }; level.push(node) }
      if (node.children) level = node.children
    })
  }
  return root
}
function decode(file: SkillFile): string | undefined {
  if (file.content !== undefined) return file.content
  try {
    const bytes = Uint8Array.from(atob(file.data ?? ''), char => char.charCodeAt(0))
    if (bytes.length > 1_000_000 || bytes.some(byte => byte === 0)) return undefined
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return undefined }
}

export function SkillDetailDialog({ skill, onClose }: { skill: AgentSkill; onClose: () => void }) {
  const preferences = usePreferences()
  const tr = (en: string, zh: string) => resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? zh : en
  const dialog = useRef<HTMLDialogElement>(null)
  const preview = useRef<HTMLElement>(null)
  const [selected, setSelected] = useState('SKILL.md')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [modeChoice, setModeChoice] = useState<{ path: string; mode: 'preview' | 'source' }>()
  const [downloading, setDownloading] = useState(false)
  const files = useMemo<SkillFile[]>(() => [{ path: 'SKILL.md', content: skill.content }, ...(skill.files ?? [])], [skill])
  const tree = useMemo(() => fileTree(files), [files])
  const file = files.find(item => item.path === selected) ?? files[0]
  const text = useMemo(() => decode(file), [file])
  const markdown = /\.(md|markdown)$/i.test(file.path)
  const imageType = /\.(png|jpe?g|gif|webp)$/i.exec(file.path)?.[1].toLowerCase()
  const canPreview = (markdown && text !== undefined) || Boolean(imageType && file.data)
  const mode = modeChoice?.path === file.path ? modeChoice.mode : canPreview ? 'preview' : 'source'
  const selectFile = (path: string) => { setSelected(path); setModeChoice(undefined) }
  const metadata = markdown && text !== undefined ? /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text) : null
  useEffect(() => {
    const element = dialog.current!
    const focused = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); focused?.focus() }
  }, [])
  useEffect(() => { if (preview.current) preview.current.scrollTop = 0; setNotice('') }, [selected, mode])
  const copy = async (value: string) => {
    try { await window.douchat.copyText(value); setNotice(tr('Copied', '已复制')) }
    catch { setNotice(tr('Could not copy. Try again.', '复制失败，请重试。')) }
  }
  const download = async () => {
    if (downloading) return
    setDownloading(true); setNotice('')
    try {
      const entries = Object.fromEntries(files.map(item => [item.path, item.data !== undefined
        ? Uint8Array.from(atob(item.data), char => char.charCodeAt(0)) : new TextEncoder().encode(item.content ?? '')]))
      // Store entries without compression: no blob workers (blocked by desktop CSP),
      // and no expensive compression on the renderer thread.
      const bytes = zipSync(entries, { level: 0 })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url; link.download = `${skill.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || 'skill'}.zip`
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setNotice(tr('Could not download the skill. Try again.', '下载技能失败，请重试。')) }
    finally { setDownloading(false) }
  }
  const nodes = (items: FileNode[], depth = 0) => items.map(node => <li key={node.path}>
    {node.children ? <><button className="skill-file-row" style={{ paddingLeft: 6 + depth * 10 }} aria-expanded={!collapsed.has(node.path)} title={node.path} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next })}>
      {collapsed.has(node.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<Folder size={17} /><span>{node.name}</span>
    </button>{!collapsed.has(node.path) && <ul>{nodes(node.children, depth + 1)}</ul>}</> : <button className={`skill-file-row${selected === node.path ? ' active' : ''}`} style={{ paddingLeft: 22 + depth * 10 }} title={node.path} aria-current={selected === node.path ? 'page' : undefined} onClick={() => selectFile(node.path)}><File size={17} /><span>{node.name}</span></button>}
  </li>)
  const code = (value: string, language: string) => <div className="skill-source"><div className="skill-source-heading"><span>{language}</span></div><pre><code>{language === 'YAML' ? value.split('\n').map((line, index) => {
    const pair = /^(\s*[\w-]+:)(.*)$/.exec(line)
    return <span key={index}>{pair ? <><span className="skill-yaml-key">{pair[1]}</span><span className="skill-yaml-value">{pair[2]}</span></> : line}{'\n'}</span>
  }) : value}</code></pre></div>
  return createPortal(<dialog ref={dialog} className="skill-detail-dialog messenger" aria-labelledby="skill-detail-title" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header className="skill-detail-header"><div><button className="icon-button" aria-label={tr('Back to skills', '返回技能列表')} onClick={onClose}><ChevronLeft size={22} /></button><h2 id="skill-detail-title">{tr('Skill details', '技能详情')}</h2></div><div>
      <button className="icon-button" aria-label={tr('Download skill ZIP', '下载技能 ZIP')} title={tr('Download skill ZIP', '下载技能 ZIP')} disabled={downloading} onClick={() => void download()}><Download size={20} /></button>
      <button className="icon-button" aria-label={tr('Close skill details', '关闭技能详情')} onClick={onClose}><X size={22} /></button></div></header>
    <div className="skill-detail-layout"><nav className="skill-files" aria-label={tr('Skill files', '技能文件')}><p>{tr('Files', '文件')}</p><ul>{nodes(tree)}</ul></nav>
      <div className="skill-file-viewer"><div className="skill-file-toolbar">
        <span className="skill-file-path" title={file.path}>{file.path}</span>
        <div className="skill-view-modes" role="group" aria-label={tr('View mode', '查看模式')}>
          <button type="button" disabled={!canPreview} aria-pressed={mode === 'preview'} onClick={() => setModeChoice({ path: file.path, mode: 'preview' })}>{tr('Preview', '预览')}</button>
          <button type="button" disabled={text === undefined} aria-pressed={mode === 'source'} onClick={() => setModeChoice({ path: file.path, mode: 'source' })}>{tr('Source', '源码')}</button>
        </div>
        {text !== undefined && <button className="icon-button" aria-label={tr('Copy file', '复制文件')} title={tr('Copy file source', '复制当前文件源码')} onClick={() => void copy(text)}><Copy size={17} /></button>}
      </div><section ref={preview} className={`skill-file-preview${mode === 'source' && text !== undefined ? ' skill-file-source' : ''}`} aria-label={file.path}>
        {notice && <p className="skill-file-notice" role="status">{notice}</p>}
        {mode === 'preview' && imageType && file.data ? <img className="skill-image-preview" src={`data:image/${imageType === 'jpg' ? 'jpeg' : imageType};base64,${file.data}`} alt={file.path} /> : text === undefined ? <div className="skill-file-unavailable"><File size={36} /><h3>{file.path.split('/').at(-1)}</h3><p>{tr('This binary or large file cannot be previewed. Download the skill ZIP to view it locally.', '此文件为二进制文件或体积较大，下载技能 ZIP 后可在本地查看。')}</p></div> : mode === 'preview' && markdown ? <>
          {metadata && code(metadata[1], 'YAML')}
          <Streamdown key={selected} className="skill-markdown" mode="static" controls={false} skipHtml remarkPlugins={[...Object.values(defaultRemarkPlugins), remarkSkillTitles]} rehypePlugins={[]} components={{ strong: ({ children }) => <strong>{children}</strong>, em: ({ children }) => <em>{children}</em>, del: ({ children }) => <del>{children}</del>, table: ({ children }) => <div className="skill-table-scroll"><table>{children}</table></div>, a: ({ children, href }) => href && /^https?:/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt}</span> }}>{normalizeSkillCallouts(metadata ? text.slice(metadata[0].length) : text)}</Streamdown>
        </> : <SkillSourceCode source={text} path={file.path} />}
      </section></div></div>
  </dialog>, document.body)
}
