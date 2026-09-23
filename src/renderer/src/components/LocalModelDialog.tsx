import { useEffect, useRef, useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import type { AgentConfig, ModelOption } from '../../../shared/types'
import { CustomModelSelection } from './CustomModelSelection'
import { configurableLocalAgents, localModelId, type LocalModelList } from '../../../shared/localModels'
import type { CustomModelConfig } from '../../../shared/customModels'
import { t } from '../preferences'
import { NativeDialog } from './NativeDialog'
import { localAgentDisplayName } from './common'

export function LocalModelDialog({ agent, cloudModels = [], onModelSettings, onCreditsSettings, onClose, onSave }: {
  agent: AgentConfig; cloudModels?: ModelOption[]; onModelSettings?: () => void; onCreditsSettings?: () => void; onClose: () => void; onSave: (model: string, provider?: string) => Promise<void>
}): ReactElement {
  const [model, setModel] = useState(agent.systemRole === 'admin' && !agent.userOverrides?.modelBinding ? 'douchat-default' : agent.model && agent.model !== 'default' ? agent.model : agent.localAgentId ? '' : 'douchat-default')
  const [manualModel, setManualModel] = useState(false)
  const [list, setList] = useState<LocalModelList>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const custom = !agent.localAgentId
  const [customModels, setCustomModels] = useState<CustomModelConfig>()
  const [customProviderId, setCustomProviderId] = useState(agent.followDefaultModel ? '@default' : agent.provider?.startsWith('custom:') ? agent.provider.slice('custom:'.length) : 'cloud')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!custom) return
    let active = true
    setLoading(true)
    window.douchat.getCustomModels().then(result => { if (active) setCustomModels(result) })
      .catch(() => { if (active) setError(t("Could not load custom models. Try again in Settings.")) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [custom])
  useEffect(() => {
    if (custom) return
    let active = true
    setLoading(true); setError('')
    window.douchat.listLocalAgentModels(agent.id).then(result => { if (active) setList(result) })
      .catch(() => { if (active) setError(t('Could not load models. Retry or enter a model ID.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [agent.id, revision, custom])
  const supported = configurableLocalAgents.includes(agent.localAgentId || '')
  const selectedProvider = customModels?.providers.find(provider => provider.id === customProviderId)
  const validSelection = customProviderId === '@default' ? Boolean(customModels?.defaultModel) : customProviderId === 'cloud' ? model === 'douchat-default' || cloudModels.some(item => item.model === model) : selectedProvider?.models.includes(model)
  const localModels = list?.models ?? []
  return <NativeDialog width={560} className="modal-backdrop" onClose={() => !saving && onClose()}>
    <form className="agent-modal agent-permissions-modal local-model-modal" role="dialog" aria-modal="true" aria-labelledby="local-model-title" onSubmit={async event => {
      event.preventDefault()
      if (saving || (custom && (loading || !validSelection))) return
      try {
        const selected = custom ? model : localModelId(model) ?? 'default'
        setSaving(true); setError('')
        await (custom ? onSave(selected, customProviderId === 'cloud' ? 'cloud' : `custom:${customProviderId}`) : onSave(selected))
        if (alive.current) onClose()
      } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : t('Could not save changes')) }
      finally { if (alive.current) setSaving(false) }
    }}>
      <header className="edit-contact-heading"><h2 id="local-model-title">{t('Configure model')}</h2>
        <button type="button" className="icon-button" aria-label={t('Close')} disabled={saving} onClick={onClose}><X size={20} /></button></header>
      <div className="permission-body local-model-body">
      <p className="permission-agent-name">{agent.name}</p>
      {custom ? <>
        <CustomModelSelection config={customModels ?? { providers: [], defaultModel: '' }} cloudModels={cloudModels} providerId={customProviderId} model={model} disabled={saving || loading} onChange={(providerId, value) => { setCustomProviderId(providerId); setModel(value) }} />
        {loading && <p role="status">{t("Loading model settings…")}</p>}
        <p className="settings-note">{customProviderId === 'cloud' ? t("Use Douchat cloud models with pay-as-you-go credits.") : t("Use your own API key. Your model provider handles billing.")} <button type="button" className="local-settings-link" disabled={saving} onClick={customProviderId === 'cloud' ? onCreditsSettings : onModelSettings}>{customProviderId === 'cloud' ? t("View credits") : t("Configure model")}</button></p>
      </> : <>
        <div className="custom-model-selection">
          <label className="field-row"><span>{t('Local agent')}</span><select aria-label={t('Local agent')} value={agent.localAgentId} disabled><option value={agent.localAgentId}>{agent.localAgentName || localAgentDisplayName(agent.localAgentId!)}</option></select></label>
          <label className="field-row"><span>{t('Model')}</span><select aria-label={t('Model')} value={manualModel ? '__manual__' : model} disabled={saving || loading || !supported} onChange={event => {
            const value = event.target.value
            setManualModel(value === '__manual__')
            if (value !== '__manual__') setModel(value)
          }}>
            <option value="">{t('Use agent default')}</option>
            {model && !localModels.some(item => item.id === model) && <option value={model}>{model}</option>}
            {localModels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            {supported && <option value="__manual__">{t("Enter a model ID manually")}</option>}
          </select></label>
        </div>
        {supported && manualModel && <label className="local-model-custom">{t('Model ID')}<input autoFocus value={model} disabled={saving} placeholder={t('Leave empty to use agent default')} onChange={event => setModel(event.target.value)} /></label>}
        <p className="settings-note">{loading ? t('Loading models…') : t("Use the local agent’s model configuration.")} <button type="button" className="local-settings-link" disabled={saving || loading} onClick={() => setRevision(n => n + 1)}>{t('Refresh')}</button></p>
      </>}
      {!custom && !supported && <p className="local-model-note">{t('This tool does not support a per-conversation model override.')}</p>}
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
      <footer className="edit-contact-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>{t('Cancel')}</button><button className="primary-button" disabled={saving || (!custom && !supported && Boolean(model)) || (custom && (loading || !validSelection))}>{t(saving ? 'Saving…' : 'Done')}</button></footer>
    </form>
  </NativeDialog>
}
