import { useRef, useState } from 'react'
import { Plus, Save, Search, Trash2, Upload } from 'lucide-react'
import { type AgentFileName, type AgentFiles, type AgentSkill } from '../../../shared/agentCustomization'
import type { AgentConfig, UpdateAgentInput } from '../../../shared/types'
import { t, resolveInterfaceLanguage, usePreferences } from '../preferences'

type Props = { agent: AgentConfig; onSave: (input: UpdateAgentInput) => Promise<void>; onDirty: () => void }
const editableFiles = [
  { name: 'SOUL.md', en: 'Soul', zh: '灵魂' },
  { name: 'IDENTITY.md', en: 'Identity', zh: '身份' },
  { name: 'TOOLS.md', en: 'Tools', zh: '工具' },
  { name: 'BOOTSTRAP.md', en: 'Bootstrap', zh: '引导' }
] as const

export function AgentFilesPanel({ agent, onSave, onDirty }: Props) {
  const preferences = usePreferences()
  const tr = (en: string, zh: string) => resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? zh : en
  const [files, setFiles] = useState<AgentFiles>(agent.systemFiles ?? {})
  const [active, setActive] = useState<AgentFileName>('SOUL.md')
  const [error, setError] = useState('')
  return <section className="agent-customize-panel">
    <header className="settings-heading agent-settings-heading"><div><h1>{tr('Customize', '自定义')}</h1></div>
      <button className="primary-button" onClick={async () => { setError(''); try { await onSave({ systemFiles: Object.fromEntries(editableFiles.filter(file => files[file.name] !== undefined).map(file => [file.name, files[file.name]])) }) } catch (e) { setError(String(e instanceof Error ? e.message : e)) } }}>{t('Save')}</button>
    </header>
    <div className="agent-file-tabs" role="tablist" aria-label={tr('Custom files', '自定义文件')}>
      {editableFiles.filter(file => file.name !== 'TOOLS.md').map(({ name, en, zh }) => <button type="button" key={name} role="tab" aria-selected={active === name} aria-controls="agent-file-editor" id={`agent-file-${name}`} onClick={() => setActive(name)}>{tr(en, zh)}</button>)}
    </div>
    <div role="tabpanel" id="agent-file-editor" aria-labelledby={`agent-file-${active}`}>
      <label className="agent-file-label" htmlFor="agent-file-content">{active}</label>
      <textarea id="agent-file-content" className="agent-markdown-editor" value={files[active] ?? ''} spellCheck={false} maxLength={100000} placeholder={`# ${active}\n\n${tr('Write your content here…', '在此编写内容…')}`} onChange={e => { setFiles({ ...files, [active]: e.target.value }); onDirty() }} />
    </div>
    <p className="settings-note">{tr('Saved files apply from the next message.', '保存后从下一条消息开始生效。')}</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>
}

export function AgentSkillsPanel({ agent, onSave, onDirty }: Props) {
  const preferences = usePreferences()
  const tr = (en: string, zh: string) => resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? zh : en
  const [skills, setSkills] = useState<AgentSkill[]>(agent.skills ?? [])
  const [selected, setSelected] = useState<string>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const active = skills.find(skill => skill.id === selected)
  const change = (next: AgentSkill[]) => { setSkills(next); onDirty() }
  const add = (name = '', content = '') => {
    if (skills.length >= 50) { setError(tr('An agent can have up to 50 skills.', '每个智能体最多添加 50 个技能。')); return }
    const skill = { id: crypto.randomUUID(), name, content, enabled: true }
    change([...skills, skill]); setSelected(skill.id)
  }
  return <section>
    <header className="settings-heading agent-settings-heading"><div><h1>{tr('Skills', '技能')}</h1></div>
      <button className="primary-button" disabled={skills.some(skill => !skill.name.trim())} onClick={async () => { setError(''); try { await onSave({ skills }) } catch (e) { setError(String(e instanceof Error ? e.message : e)) } }}><Save size={16} />{t('Save')}</button>
    </header>
    <div className="agent-skills-toolbar"><label><Search size={16} /><input aria-label={tr('Search skills', '搜索技能')} placeholder={tr('Search skills', '搜索技能')} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={16} />{tr('Import SKILL.md', '导入 SKILL.md')}</button>
      <button className="secondary-button" onClick={() => add()}><Plus size={16} />{tr('Add skill', '添加技能')}</button>
      <input ref={fileInput} hidden type="file" accept=".md,text/markdown,text/plain" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
        try {
          if (file.size > 400000) throw new Error(tr('Skill file is too large.', '技能文件过大。'))
          const content = await file.text()
          if (content.length > 100000) throw new Error(tr('Skill exceeds 100,000 characters.', '技能内容不能超过 100,000 字符。'))
          const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(content)?.[1] || file.name.replace(/\.md$/i, '')
          add(name.slice(0, 100), content); setError('')
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
      }} />
    </div>
    <p className="settings-note">{tr('Import a standalone SKILL.md or write a skill here. Enabled skills apply from the next message; supporting scripts and tools must already be available to the agent.', '可导入独立的 SKILL.md 或直接编写技能。启用后从下一条消息开始生效；依赖的脚本和工具需由智能体本身提供。')}</p>
    {!skills.length && <div className="agent-skills-empty">{tr('No skills yet. Add or import your first skill.', '还没有技能，添加或导入第一个技能吧。')}</div>}
    <div className="agent-skills-list">{skills.filter(skill => skill.name.toLowerCase().includes(query.toLowerCase())).map(skill => <article key={skill.id} className={selected === skill.id ? 'selected' : ''}>
      <button className="agent-skill-name" onClick={() => setSelected(skill.id)}><strong>{skill.name || tr('Untitled skill', '未命名技能')}</strong><small>SKILL.md</small></button>
      <label className="agent-skill-toggle"><input type="checkbox" checked={skill.enabled} aria-label={`${tr('Enable', '启用')} ${skill.name}`} onChange={e => change(skills.map(item => item.id === skill.id ? { ...item, enabled: e.target.checked } : item))} />{tr('Enabled', '启用')}</label>
      <button className="icon-button danger" aria-label={`${tr('Delete skill', '删除技能')} ${skill.name}`} onClick={() => { if (!window.confirm(tr('Delete this skill?', '删除这个技能？'))) return; change(skills.filter(item => item.id !== skill.id)); if (selected === skill.id) setSelected(undefined) }}><Trash2 size={16} /></button>
    </article>)}</div>
    {active && <div className="agent-skill-editor"><label className="edit-contact-field"><span>{tr('Skill name', '技能名称')}</span><input maxLength={100} value={active.name} onChange={e => change(skills.map(item => item.id === active.id ? { ...item, name: e.target.value } : item))} /></label>
      <label className="agent-file-label" htmlFor="skill-content">SKILL.md</label><textarea id="skill-content" className="agent-markdown-editor" value={active.content} spellCheck={false} maxLength={100000} onChange={e => change(skills.map(item => item.id === active.id ? { ...item, content: e.target.value } : item))} /></div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>
}
