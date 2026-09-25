import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { AgentConfig, UpdateAgentInput } from '../../../shared/types'
import { MAX_SKILL_BYTES } from '../../../shared/agentCustomization'
import { portableAgentFiles, type AgentArchivePreview } from '../../../shared/agentArchive'
import { resolveInterfaceLanguage, usePreferences } from '../preferences'

export function AgentArchivePanel({ agent, onImport, onBusyChange }: {
  agent: AgentConfig; onImport: (input: UpdateAgentInput) => Promise<void>; onBusyChange: (busy: boolean) => void
}) {
  const preferences = usePreferences()
  const tr = (en: string, zh: string) => resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? zh : en
  const input = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const archive = useRef<Uint8Array | undefined>(undefined)
  const [preview, setPreview] = useState<AgentArchivePreview>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const operation = async (fn: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; onBusyChange(true); setError(''); setStatus('')
    try { await fn() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { lock.current = false; onBusyChange(false) }
  }
  const download = () => operation(async () => {
    setExportStatus('')
    const saved = await window.douchat.exportAgentArchive(agent.id)
    if (saved) setExportStatus(tr('Configuration exported.', '已导出配置。'))
  })
  const select = (file?: File) => {
    if (!file) return
    setPreview(undefined)
    void operation(async () => {
      if (!/\.(zip|tar\.gz|tgz)$/i.test(file.name) || file.size > MAX_SKILL_BYTES) throw new Error(tr('Choose a ZIP or TAR.GZ up to 64 MB.', '请选择不超过 64 MB 的 ZIP 或 TAR.GZ 文件。'))
      archive.current = new Uint8Array(await file.arrayBuffer())
      setPreview(await window.douchat.parseAgentArchive(archive.current))
    })
  }
  const apply = async () => {
    if (!preview || preview.candidates || lock.current) return
    // onImport owns the parent save lock; do not acquire it twice.
    lock.current = true; setError(''); setStatus('')
    try {
      await onImport({ systemFiles: preview.systemFiles, skills: preview.skills })
      setPreview(undefined); setStatus(tr('Configuration imported. It applies from the next message.', '已导入配置，从下一条消息开始生效。'))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { lock.current = false }
  }
  return <div className="agent-archive-panel">
    <div className="agent-settings-delete"><div><h2>{tr('Export configuration', '导出配置')}</h2><p>{tr('Download saved profile, custom files and all skills as a ZIP. Excludes model credentials, channels, chat history and personal memory.', '将已保存的资料、自定义文件和全部技能导出为 ZIP。不含模型密钥、渠道、聊天记录和个人记忆。')}</p>{exportStatus && <p className="agent-archive-export-status" role="status">{exportStatus}</p>}</div><button className="secondary-button" onClick={() => void download()}><Download size={16} />{tr('Export ZIP', '导出 ZIP')}</button></div>
    <div className="agent-settings-delete"><div><h2>{tr('Import configuration', '导入配置')}</h2><p>{tr('Supports ZIP, TAR.GZ and TGZ archives. Only custom files and skills are replaced; your profile, model, permissions and memory stay unchanged.', '支持 ZIP、TAR.GZ 和 TGZ 格式的配置包。仅覆盖自定义文件和技能，当前资料、模型、权限和记忆保持不变。')}</p></div><button className="secondary-button" onClick={() => input.current?.click()}><Upload size={16} />{tr('Import archive', '导入配置包')}</button><input ref={input} hidden type="file" accept=".zip,.tar.gz,.tgz,application/zip,application/gzip" onChange={event => { select(event.target.files?.[0]); event.target.value = '' }} /></div>
    {preview && <div className="agent-archive-preview" role="region" aria-label={tr('Import preview', '导入预览')}>
      <h3>{tr('Import preview', '导入预览')}</h3>
      {preview.candidates ? <><label>{tr('Choose an agent from this archive', '选择包中的智能体')}<select defaultValue="__select__" onChange={event => {
        const root = event.target.value
        void operation(async () => { setPreview(await window.douchat.parseAgentArchive(archive.current!, root)) })
      }}><option value="__select__" disabled>{tr('Select…', '请选择…')}</option>{preview.candidates.map(candidate => <option key={candidate.root} value={candidate.root}>{candidate.name}</option>)}</select></label><div className="agent-archive-actions"><button className="secondary-button" onClick={() => setPreview(undefined)}>{tr('Cancel', '取消')}</button></div></> : <>
      {preview.warnings?.map(warning => <p key={warning}>{warning === 'duplicate-skills' ? tr('Duplicate ZIP skills were skipped; unpacked directories take priority.', '已跳过 ZIP 中的同名技能，优先使用解压目录版本。') : tr('Other files are ignored, including model/provider settings, credentials, memory, sessions, MCP, plugins and scheduled tasks. Only custom Markdown files and skills are imported.', '其他文件不会导入，包括模型配置、凭据、记忆、会话、MCP、插件和定时任务。本次只导入自定义 Markdown 文件和技能。')}</p>)}
      <p>{tr('Custom files', '自定义文件')}：{portableAgentFiles.filter(name => preview.systemFiles[name]).join('、') || tr('None', '无')}</p>
      <p>{tr('Skills', '技能')}：{preview.skills.length ? preview.skills.map(skill => `${skill.name}${skill.enabled ? '' : tr(' (disabled)', '（未启用）')}`).join('、') : tr('None', '无')}</p>
      <p>{tr('This replaces all current custom files and skills, including unsaved edits. Missing items will be cleared.', '确认后将替换全部自定义文件和技能，包括尚未保存的修改；包中未包含的项目将被清空。')}</p>
      <div className="agent-archive-actions"><button className="secondary-button" onClick={() => setPreview(undefined)}>{tr('Cancel', '取消')}</button><button className="primary-button" onClick={() => void apply()}>{tr('Confirm replacement', '确认覆盖')}</button></div></>}
    </div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {status && <p className="agent-settings-saved" role="status">{status}</p>}
  </div>
}
