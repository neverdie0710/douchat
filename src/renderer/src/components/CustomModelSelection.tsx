import { t, tr } from '../preferences'
import type { CustomModelConfig } from '../../../shared/customModels'
import type { ModelOption } from '../../../shared/types'

export function CustomModelSelection({ config, cloudModels, providerId, model, disabled, onChange }: {
  config: CustomModelConfig
  cloudModels: ModelOption[]
  providerId: string
  model: string
  disabled?: boolean
  onChange: (providerId: string, model: string) => void
}) {
  const provider = config.providers.find(item => item.id === providerId)
  const cloud = providerId === 'cloud'
  const available = cloud ? model === 'douchat-default' || cloudModels.some(item => item.model === model) : provider?.models.includes(model)
  return <div className="custom-model-selection">
    <label className="field-row"><span>{t("Provider")}</span><select aria-label={t("Custom model provider")} value={providerId} disabled={disabled} onChange={event => {
      const id = event.target.value
      onChange(id, id === 'cloud' ? 'douchat-default' : config.providers.find(item => item.id === id)?.models[0] ?? '')
    }}><option value="cloud">Douchat Cloud</option>{!cloud && !provider && <option value={providerId}>{tr('{name} (unavailable)', { name: providerId })}</option>}{config.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="field-row"><span>{t('Model')}</span><select aria-label={t("Custom model")} value={model} disabled={disabled || (!cloud && !provider?.models.length)} onChange={event => onChange(providerId, event.target.value)}>
      {!available && <option value={model}>{tr('{name} (unavailable)', { name: model || t('Choose a model') })}</option>}
      {cloud ? <><option value="douchat-default">Douchat Default</option>{cloudModels.filter(item => item.model !== 'douchat-default').map(item => <option key={`${item.provider}/${item.model}`} value={item.model}>{item.label}</option>)}</> : provider?.models.map(item => <option key={item} value={item}>{provider.modelLabels?.[item] || item}</option>)}
    </select></label>
  </div>
}
