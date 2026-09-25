import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileArchive, Upload, X } from 'lucide-react'
import { MAX_SKILL_BYTES, type AgentSkill } from '../../../shared/agentCustomization'
import { resolveInterfaceLanguage, usePreferences } from '../preferences'

export function SkillUploadDialog({ remaining, onUpload, onClose }: { remaining: number; onUpload: (skills: AgentSkill[]) => void; onClose: () => void }) {
  const preferences = usePreferences()
  const tr = (en: string, zh: string) => resolveInterfaceLanguage(preferences.language) === 'zh-CN' ? zh : en
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const uploading = useRef(false)
  useEffect(() => {
    const element = dialog.current!
    const focused = document.activeElement as HTMLElement | null
    element.showModal()
    return () => { element.close(); focused?.focus() }
  }, [])
  const close = () => { if (!uploading.current) onClose() }
  const select = (files: FileList | null) => {
    if (uploading.current) return
    setError(''); setFile(undefined)
    if (!files?.length) return
    if (files.length !== 1 || !/\.zip$/i.test(files[0].name)) { setError(tr('Choose one .zip archive.', '请选择一个 .zip 压缩包。')); return }
    if (files[0].size > MAX_SKILL_BYTES) { setError(tr('ZIP must be at most 64 MB.', 'ZIP 压缩包不能超过 64 MB。')); return }
    setFile(files[0])
  }
  const upload = async () => {
    if (!file || uploading.current) return
    uploading.current = true; setBusy(true); setError('')
    try {
      const skills = await window.douchat.parseSkillArchive(new Uint8Array(await file.arrayBuffer()))
      if (skills.length > remaining) throw new Error(tr(`This archive contains ${skills.length} skills; only ${remaining} slots remain.`, `压缩包包含 ${skills.length} 个技能，当前还可添加 ${remaining} 个。`))
      onUpload(skills)
      onClose()
    } catch (error) {
      setError(tr('Could not upload skills: ', '上传失败：') + (error instanceof Error ? error.message : String(error)))
    } finally { uploading.current = false; setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="skill-upload-dialog messenger" aria-labelledby="skill-upload-title" onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><h2 id="skill-upload-title">{tr('Upload skills', '上传技能')}</h2><button className="icon-button" aria-label={tr('Close', '关闭')} disabled={busy} onClick={close}><X size={20} /></button></header>
    <button type="button" className={`skill-upload-dropzone${dragging ? ' dragging' : ''}`} disabled={busy} onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); select(event.dataTransfer.files) }}>
      <FileArchive size={42} strokeWidth={1.4} />
      <span>{file ? file.name : tr('Drop a file or click to upload', '拖放文件或点击上传')}</span>
      {file && <small>{(file.size / 1024 / 1024).toFixed(2)} MB · {tr('Click to choose another file', '点击重新选择文件')}</small>}
    </button>
    <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={event => { select(event.target.files); event.target.value = '' }} />
    <div className="skill-upload-requirements"><h3>{tr('File requirements', '文件要求')}</h3><ul>
      <li>{tr('One .zip archive containing one or more skills (up to 64 MB).', '一个 .zip 压缩包，可包含一个或多个技能（最大 64 MB）。')}</li>
      <li>{tr('Each skill folder must contain SKILL.md; a single skill may also be placed at the archive root.', '每个技能目录包含 SKILL.md；单个技能也可直接放在压缩包根目录。')}</li>
      <li>{tr('SKILL.md must declare name and description in YAML frontmatter. Scripts and reference files are included.', 'SKILL.md 顶部使用 YAML 定义 name 和 description，支持附带脚本和参考文件。')}</li>
    </ul></div>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <footer><button className="secondary-button" disabled={busy} onClick={close}>{tr('Cancel', '取消')}</button><button className="primary-button" disabled={!file || busy || remaining <= 0} onClick={() => void upload()}><Upload size={16} />{busy ? tr('Uploading…', '上传中…') : tr('Upload', '上传')}</button></footer>
  </dialog>, document.body)
}
